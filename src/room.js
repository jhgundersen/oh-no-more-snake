// A versus room: one Durable Object per match, holding the board both players
// are looking at.
//
// The room runs the game. Not one of the two browsers — a browser that decides
// who reached the apple first is a browser that can decide it reached the
// apple first, and its lag becomes the other player's lag. Clients send the
// direction they want to go and draw what comes back, which is the whole
// protocol.
//
// A board step is 70–140 ms, so the round trip to the room is comfortably
// inside one and no prediction is needed to make it feel right. That is the
// same reason browser-to-browser was not worth it: WebRTC would still need a
// signalling server, a TURN relay for the connections that will not traverse,
// and a secure context this page is not allowed to assume — to arrive at the
// same place, with one of the players refereeing.

import { DurableObject } from "cloudflare:workers"

import { PHASE_LOBBY, PHASE_MATCH_OVER, PHASE_PLAYING, Versus, validHead } from "../public/snake/Versus.js"

// Enough for the people not playing to watch, and few enough that a room is
// never a broadcast tower.
const MAX_SPECTATORS = 8
// A message from a client is a direction or a word. Anything longer is not one.
const MAX_MESSAGE_BYTES = 512
// Turns are queued two deep and thrown away after that, so flooding gains
// nothing — this only stops it costing anything either.
const MAX_MESSAGES_PER_SECOND = 40

const SEATS = 2

export class VersusRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    // Deliberately memory only. A match is worth exactly as long as its two
    // players are connected: writing a snake to storage ten times a second to
    // survive an eviction that cannot happen while a socket is open would be a
    // great deal of work to preserve something nobody would come back to.
    this.sockets = new Map()
    this.versus = null
    this.timer = null
    this.lastAt = 0
    this.accumulator = 0
    this.wrap = true
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

    // The first arrival brings the borders with them, because they are the one
    // who chose them; everybody after that plays the room's game.
    if (!this.sockets.size) {
      this.wrap = new URL(request.url).searchParams.get("wrap") !== "0"
      this.versus = null
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    const seat = [0, 1].find(candidate => !seats.includes(candidate))
    // `head` stays null until its player says otherwise, so the model's own
    // two default faces hold until somebody actually picks one.
    this.sockets.set(server, { seat: seat === undefined ? null : seat, budget: 0, second: 0, head: null })

    server.addEventListener("message", event => this.onMessage(server, event))
    server.addEventListener("close", () => this.onGone(server))
    server.addEventListener("error", () => this.onGone(server))

    this.send(server, {
      t: "welcome",
      seat: seat === undefined ? null : seat,
      wrap: this.wrap
    })
    this.announceSeats()
    this.startIfReady()

    return new Response(null, { status: 101, webSocket: client })
  }

  // --- who is here ---

  takenSeats() {
    const seats = []
    for (const info of this.sockets.values()) if (info.seat !== null) seats.push(info.seat)
    return seats
  }

  spectators() {
    let count = 0
    for (const info of this.sockets.values()) if (info.seat === null) ++count
    return count
  }

  announceSeats() {
    const taken = this.takenSeats()
    this.broadcast({
      t: "seats",
      taken: [taken.includes(0), taken.includes(1)],
      spectators: this.spectators()
    })
  }

  // Faces are remembered by the room, not by the board: a match is thrown away
  // whenever somebody leaves, and being made to pick a head again because your
  // opponent's wifi went is not a thing to be made to do.
  applyHeads() {
    if (!this.versus) return
    for (const info of this.sockets.values()) {
      if (info.seat !== null && info.head !== null) this.versus.setHead(info.seat, info.head)
    }
  }

  startIfReady() {
    const taken = this.takenSeats()
    if (taken.length < SEATS) return
    if (this.versus && this.versus.phase !== PHASE_LOBBY) return
    this.versus = new Versus({ wrap: this.wrap })
    this.versus.startMatch()
    this.applyHeads()
    this.lastAt = Date.now()
    this.accumulator = 0
    this.broadcastState()
    this.schedule()
  }

  onGone(socket) {
    const info = this.sockets.get(socket)
    if (!info) return
    this.sockets.delete(socket)

    // A match with one player in it is not a match. Rather than freeze it and
    // hope, the room goes back to waiting, so whoever is left can be joined by
    // somebody else without reloading anything.
    if (info.seat !== null && this.versus && this.versus.phase !== PHASE_LOBBY) {
      this.versus = null
      this.broadcast({ t: "left", seat: info.seat })
      // And say so as a board as well, or everyone still here goes on looking
      // at the last frame of a match that no longer exists.
      this.broadcastState()
    }
    this.announceSeats()
    if (!this.sockets.size) {
      this.versus = null
      this.stop()
      return
    }
    this.startIfReady()
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

    if (message.t === "turn") {
      if (info.seat === null || !this.versus) return
      this.versus.turn(info.seat, Math.sign(Number(message.dx) || 0), Math.sign(Number(message.dy) || 0))
      return
    }

    if (message.t === "head") {
      if (info.seat === null) return
      info.head = validHead(message.head)
      // Refused while the board is moving, which is the model's rule and not
      // this one's — so the answer to a refusal is simply the board as it is.
      if (this.versus) this.versus.setHead(info.seat, info.head)
      this.broadcastState()
      return
    }

    if (message.t === "rematch") {
      if (info.seat === null || !this.versus) return
      if (this.versus.phase !== PHASE_MATCH_OVER) return
      this.versus.startMatch()
      this.applyHeads()
      this.lastAt = Date.now()
      this.accumulator = 0
      this.broadcastState()
      this.schedule()
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
    this.broadcast(this.versus
      ? { t: "state", state: this.versus.snapshot() }
      : { t: "state", state: null })
  }

  // --- the clock ---

  stop() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  // The next wake-up is the next thing that has to happen, rather than a fixed
  // heartbeat: a board that is waiting for a second player, or sitting on a
  // finished match, has nothing to do and should cost nothing to leave open.
  schedule() {
    this.stop()
    if (!this.sockets.size || !this.versus) return
    const phase = this.versus.phase
    if (phase === PHASE_LOBBY || phase === PHASE_MATCH_OVER) return
    const wait = phase === PHASE_PLAYING
      ? Math.max(10, this.versus.tickInterval - this.accumulator)
      : 100
    this.timer = setTimeout(() => this.loop(), wait)
  }

  loop() {
    this.timer = null
    if (!this.versus || !this.sockets.size) return

    const now = Date.now()
    // A room that was starved of its timer catches up by a few steps, never by
    // a hundred: two snakes teleporting across the board is worse than a hitch.
    const delta = Math.min(500, Math.max(0, now - this.lastAt))
    this.lastAt = now

    this.versus.advance(delta)
    if (this.versus.phase === PHASE_PLAYING) {
      this.accumulator += delta
      let steps = 0
      while (this.accumulator >= this.versus.tickInterval && steps++ < 5 && this.versus.phase === PHASE_PLAYING) {
        this.accumulator -= this.versus.tickInterval
        this.versus.tick()
      }
    } else this.accumulator = 0

    this.broadcastState()
    this.schedule()
  }
}
