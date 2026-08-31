// A versus room: one Durable Object per code, holding the lobby two players
// meet in and then the board they play on.
//
// The room runs the game. Not one of the two browsers — a browser that decides
// who reached the apple first is a browser that can decide it reached the
// apple first, and its lag becomes the other player's lag. Clients send the
// direction they want to go and draw what comes back, which is the whole
// protocol.
//
// A board step is 85–140 ms, so the round trip to the room is comfortably
// inside one and no prediction is needed to make it feel right. That is the
// same reason browser-to-browser was not worth it: WebRTC would still need a
// signalling server, a TURN relay for the connections that will not traverse,
// and a secure context this page is not allowed to assume — to arrive at the
// same place, with one of the players refereeing.
//
// Two games are played here. A duel puts both snakes on one board and lets
// them ruin each other; a race gives them a board each and sends them up the
// levels. The room does not care which: both models present the same handful
// of methods, so everything below is written once.

import { DurableObject } from "cloudflare:workers"

import { MAX_SEATS, MIN_SEATS, PHASE_LOBBY, PHASE_MATCH_OVER, Versus, validHead } from "../public/snake/Versus.js"
import { Race } from "../public/snake/Race.js"

// Enough for the people not playing to watch, and few enough that a room is
// never a broadcast tower.
const MAX_SPECTATORS = 8
// A message from a client is a direction, a word, or something somebody typed.
const MAX_MESSAGE_BYTES = 1024
// Turns are queued two deep and thrown away after that, so flooding gains
// nothing — this only stops it costing anything either.
const MAX_MESSAGES_PER_SECOND = 40

const MAX_NICK = 16
const MAX_CHAT = 200
// Enough for somebody arriving late to see what they walked in on, and little
// enough that a room holds no more of anyone's words than it needs to.
const CHAT_HISTORY = 40

// A board goes out at most this often. Twenty a second is finer than any board
// step, and a race frame carries two whole games.
const BROADCAST_MS = 50

const SEATS = MAX_SEATS
// How many rounds a match can be. One is a single game; five is a long
// evening. Anything else is not a number of rounds.
const WINS_CHOICES = [1, 2, 3, 4, 5]
// The first is the default, because a race is the mode most people mean by
// two players.
const MODES = ["race", "duel"]

// Names and messages are typed by people and land on another person's screen.
// Control characters are stripped here as well as escaped there: nothing
// downstream should have to think about a newline inside a nickname.
const CONTROL = /[\u0000-\u001f\u007f]/g

function clean(value, limit) {
  return String(value ?? "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
}

export class VersusRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    // Deliberately memory only. A match is worth exactly as long as its two
    // players are connected: writing a snake to storage ten times a second to
    // survive an eviction that cannot happen while a socket is open would be a
    // great deal of work to preserve something nobody would come back to.
    this.sockets = new Map()
    this.match = null
    this.mode = MODES[0]
    this.winsNeeded = 3
    // What is on the playlist, so everybody in the room hears the same song.
    // Only which one: where it is up to is nobody's business but the browser
    // playing it, and syncing that would be a clock problem for no gain.
    this.track = null
    this.chat = []
    this.timer = null
    this.lastAt = 0
    this.broadcastAt = 0
  }

  // A WebSocket upgrade is the one thing that still has to be a fetch. The
  // sockets are accepted rather than hibernated: hibernation evicts the object
  // between messages, and an evicted object has no clock to run a board on.
  async fetch(request) {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("expected a websocket", { status: 426 })
    }

    const seats = this.takenSeats()
    if (seats.length >= SEATS && this.spectators() >= MAX_SPECTATORS) {
      return new Response("room is full", { status: 409 })
    }

    // A room that has emptied starts again from nothing.
    if (!this.sockets.size) {
      this.match = null
      this.chat = []
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    const seat = [...Array(SEATS).keys()].find(candidate => !seats.includes(candidate))
    this.sockets.set(server, {
      seat: seat === undefined ? null : seat,
      nick: "",
      // Null until its player says otherwise, so the model's own two default
      // faces hold until somebody actually picks one.
      head: null,
      ready: false,
      budget: 0,
      second: 0
    })

    server.addEventListener("message", event => this.onMessage(server, event))
    server.addEventListener("close", () => this.onGone(server))
    server.addEventListener("error", () => this.onGone(server))

    this.send(server, {
      t: "welcome",
      seat: seat === undefined ? null : seat,
      mode: this.mode,
      seats: SEATS,
      track: this.track
    })
    // What was said before they arrived, so a lobby is not a blank room.
    if (this.chat.length) this.send(server, { t: "chatlog", messages: this.chat })
    this.announceLobby()
    this.broadcastState()

    return new Response(null, { status: 101, webSocket: client })
  }

  // --- who is here ---

  takenSeats() {
    const seats = []
    for (const info of this.sockets.values()) if (info.seat !== null) seats.push(info.seat)
    return seats
  }

  seatInfo(seat) {
    for (const info of this.sockets.values()) if (info.seat === seat) return info
    return null
  }

  spectators() {
    let count = 0
    for (const info of this.sockets.values()) if (info.seat === null) ++count
    return count
  }

  defaultNick(seat) {
    return seat === null ? "Watcher" : `Player ${seat + 1}`
  }

  // The lobby as everybody in the room should see it.
  announceLobby() {
    this.broadcast({
      t: "lobby",
      mode: this.mode,
      winsNeeded: this.winsNeeded,
      seats: SEATS,
      minimum: MIN_SEATS,
      spectators: this.spectators(),
      players: [...Array(SEATS).keys()].map(seat => {
        const info = this.seatInfo(seat)
        return {
          seat,
          here: !!info,
          nick: info?.nick || "",
          head: info?.head,
          ready: !!info?.ready
        }
      })
    })
  }

  // --- starting and stopping ---

  // Who is actually in the match, seat by seat. Seats keep their numbers, so a
  // gap left by somebody who never turned up is a seat nobody is sitting in
  // rather than a renumbering of everybody after it.
  presence() {
    return [...Array(SEATS).keys()].map(seat => !!this.seatInfo(seat))
  }

  makeMatch() {
    const options = { winsNeeded: this.winsNeeded, present: this.presence() }
    return this.mode === "race" ? new Race(options) : new Versus(options)
  }

  // Faces and parties are remembered by the room, not by the board: a match is
  // thrown away whenever somebody leaves, and being made to pick a head again
  // because your opponent's wifi went is not a thing to be made to do.
  applySeats() {
    if (!this.match) return
    for (const info of this.sockets.values()) {
      if (info.seat === null) continue
      if (info.head !== null) this.match.setHead(info.seat, info.head)
    }
  }

  // Both seats filled and both players saying so. Readiness is what makes a
  // lobby a lobby rather than a doorway: nobody is dropped into a countdown
  // they were not looking at.
  startIfReady() {
    // Everybody who is here, and at least two of them. Waiting for all four
    // would mean two people could never start a game.
    const seated = [...this.sockets.values()].filter(info => info.seat !== null)
    if (seated.length < MIN_SEATS) return
    if (seated.some(info => !info.ready)) return
    if (this.match && this.match.phase !== PHASE_LOBBY) return
    this.match = this.makeMatch()
    this.match.startMatch()
    this.applySeats()
    this.lastAt = Date.now()
    this.broadcastState()
    this.schedule()
  }

  // Back to the lobby, with nobody ready: after a match people want to change
  // a face or the mode more often than they want the identical match again.
  toLobby() {
    this.match = null
    for (const info of this.sockets.values()) info.ready = false
    this.stop()
    this.broadcastState()
    this.announceLobby()
  }

  onGone(socket) {
    const info = this.sockets.get(socket)
    if (!info) return
    this.sockets.delete(socket)

    // A match with one player in it is not a match. Rather than freeze it and
    // hope, the room goes back to its lobby, so whoever is left can be joined
    // by somebody else without reloading anything.
    if (info.seat !== null && this.match) {
      this.match = null
      for (const other of this.sockets.values()) other.ready = false
      this.broadcast({ t: "left", seat: info.seat })
      // And say so as a board as well, or everyone still here goes on looking
      // at the last frame of a match that no longer exists.
      this.broadcastState()
    }
    this.announceLobby()
    if (!this.sockets.size) {
      this.match = null
      this.chat = []
      this.stop()
      return
    }
    this.schedule()
  }

  // --- messages in ---

  onMessage(socket, event) {
    const info = this.sockets.get(socket)
    if (!info) return
    const raw = typeof event.data === "string" ? event.data : ""
    if (!raw || raw.length > MAX_MESSAGE_BYTES) return

    const second = Math.floor(Date.now() / 1000)
    if (second !== info.second) {
      info.second = second
      info.budget = 0
    }
    if (++info.budget > MAX_MESSAGES_PER_SECOND) return

    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (!message || typeof message !== "object") return
    this.handle(info, message)
  }

  handle(info, message) {
    // Anybody in the room may talk, seated or not.
    if (message.t === "chat") {
      const text = clean(message.text, MAX_CHAT)
      if (!text) return
      const entry = {
        seat: info.seat,
        nick: info.nick || this.defaultNick(info.seat),
        text,
        at: Date.now()
      }
      this.chat.push(entry)
      if (this.chat.length > CHAT_HISTORY) this.chat.shift()
      this.broadcast({ t: "chat", ...entry })
      return
    }

    // Everything below belongs to somebody with a seat.
    if (info.seat === null) return

    if (message.t === "turn") {
      if (!this.match) return
      this.match.turn(info.seat, Math.sign(Number(message.dx) || 0), Math.sign(Number(message.dy) || 0))
      return
    }

    if (message.t === "nick") {
      info.nick = clean(message.nick, MAX_NICK)
      this.announceLobby()
      return
    }

    // A beat can only be heard by the browser playing the music, so it is
    // reported rather than measured. It opens a window on that seat's lane and
    // on nothing else, which is the most it could be trusted with anyway.
    // A new song. Passed on as it is, with the size of the playlist it came
    // from: somebody who dropped their own music has a different list, and
    // being moved to the wrong song is worse than staying on your own.
    if (message.t === "track") {
      const index = Math.floor(Number(message.index))
      const count = Math.floor(Number(message.count))
      if (!Number.isFinite(index) || index < 0 || !Number.isFinite(count) || count < 1) return
      this.track = { index, count }
      this.broadcast({ t: "track", index, count, seat: info.seat })
      return
    }

    if (message.t === "beat") {
      this.match?.registerBeat?.(info.seat, Number(message.strength) || 0)
      return
    }

    if (message.t === "head") {
      info.head = validHead(message.head)
      // Refused while the board is moving, which is the model's rule and not
      // this one's — so the answer to a refusal is simply the board as it is.
      if (this.match) this.match.setHead(info.seat, info.head)
      this.announceLobby()
      this.broadcastState()
      return
    }

    if (message.t === "wins") {
      // How many rounds the match is. One decision for the room, so the first
      // seat makes it, and changing it is a reason to look again before
      // starting.
      if (this.match || info.seat !== 0) return
      const wanted = Math.floor(Number(message.wins))
      if (!WINS_CHOICES.includes(wanted)) return
      this.winsNeeded = wanted
      for (const other of this.sockets.values()) other.ready = false
      this.announceLobby()
      return
    }

    if (message.t === "mode") {
      // Only in the lobby, and only from the first seat: the mode is one
      // decision for the room, and somebody has to be the one making it.
      if (this.match || info.seat !== 0) return
      if (!MODES.includes(message.mode)) return
      this.mode = message.mode
      // Changing the game is a reason to look again before starting it.
      for (const other of this.sockets.values()) other.ready = false
      this.announceLobby()
      return
    }

    if (message.t === "ready") {
      if (this.match) return
      info.ready = !!message.ready
      this.announceLobby()
      this.startIfReady()
      return
    }

    if (message.t === "rematch") {
      if (!this.match || this.match.phase !== PHASE_MATCH_OVER) return
      // Whoever turned up while the last match was running plays this one.
      // Without this they would keep a seat they could not use until somebody
      // took the room back to its lobby.
      this.match.setPresent(this.presence())
      this.match.startMatch()
      this.applySeats()
      this.lastAt = Date.now()
      this.broadcastState()
      this.schedule()
      return
    }

    if (message.t === "tolobby") {
      if (this.match && this.match.phase !== PHASE_MATCH_OVER) return
      this.toLobby()
    }
  }

  // --- messages out ---

  send(socket, message) {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // A socket that has gone away is about to tell us so through its close
      // handler; losing one frame to it is not worth unwinding the tick for.
    }
  }

  broadcast(message) {
    const text = JSON.stringify(message)
    for (const socket of this.sockets.keys()) {
      try {
        socket.send(text)
      } catch {
        // As above.
      }
    }
  }

  broadcastState() {
    this.broadcastAt = Date.now()
    this.broadcast(this.match
      ? { t: "state", mode: this.mode, state: this.match.snapshot() }
      : { t: "state", mode: this.mode, state: null })
  }

  // --- the clock ---

  stop() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  // The next wake-up is the next thing that has to happen, rather than a fixed
  // heartbeat: a lobby, or a finished match, has nothing to do and should cost
  // nothing to leave open.
  schedule() {
    this.stop()
    if (!this.sockets.size || !this.match) return
    const phase = this.match.phase
    if (phase === PHASE_LOBBY || phase === PHASE_MATCH_OVER) return
    this.timer = setTimeout(() => this.loop(), this.match.pace)
  }

  loop() {
    this.timer = null
    if (!this.match || !this.sockets.size) return

    const now = Date.now()
    // A room that was starved of its timer catches up by a few steps, never by
    // a hundred: two snakes teleporting across the board is worse than a hitch.
    const delta = Math.min(500, Math.max(0, now - this.lastAt))
    this.lastAt = now

    this.match.step(delta)

    // A race is two whole games and its frames are bigger, so the board is
    // sent on its own cadence rather than once per step. Twenty a second is
    // finer than any board step it could be carrying.
    if (now - this.broadcastAt >= BROADCAST_MS) this.broadcastState()
    this.schedule()
  }
}
