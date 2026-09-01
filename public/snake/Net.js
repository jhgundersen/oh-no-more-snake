// The half of a versus match that leaves the machine.
//
// It is deliberately thin: the room in `src/room.js` runs the game, so all
// this does is carry a direction one way and a board the other. Nothing here
// decides anything about the match, which is what stops the two browsers ever
// disagreeing about it.

// No `i`, `l`, `o`, `0` or `1`. A room code gets read out loud or typed from a
// screenshot, and those are the five characters that get it wrong.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
const CODE_LENGTH = 6

// `crypto.randomUUID` and `crypto.subtle` do not exist outside a secure
// context — which is exactly the assumption that once broke posting a score —
// but `getRandomValues` does, and it is the only one of the three this needs.
function randomBytes(count) {
  const bytes = new Uint8Array(count)
  if (globalThis.crypto?.getRandomValues) {
    crypto.getRandomValues(bytes)
    return bytes
  }
  for (let i = 0; i < count; ++i) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

export function newRoomCode() {
  // A byte modulo 31 is very slightly biased towards the first few letters.
  // For a code whose job is to be hard to guess over the space of rooms
  // actually open at any moment, that is not a bias worth a rejection loop.
  return [...randomBytes(CODE_LENGTH)].map(byte => ALPHABET[byte % ALPHABET.length]).join("")
}

export const validCode = code => /^[a-z0-9]{4,12}$/.test(String(code || "").toLowerCase())

// What the other player needs. A link rather than a code, because a link can
// be pasted into a chat window and a code has to be explained.
export function roomLink(code) {
  const url = new URL(location.href)
  url.hash = ""
  url.search = `?room=${encodeURIComponent(code)}`
  return url.toString()
}

export class Net {
  constructor(handlers = {}) {
    this.handlers = handlers
    this.socket = null
    this.code = ""
    this.seat = null
    this.status = "idle"
  }

  get connected() {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  get spectating() {
    return this.connected && this.seat === null
  }

  connect(code) {
    this.close()
    this.code = String(code).toLowerCase()
    this.seat = null
    this.setStatus("connecting")

    // ws where the page is http and wss where it is https, worked out from the
    // page rather than assumed: the game has to keep working on a plain
    // local server, and a hardcoded wss:// there fails with nothing to read.
    const scheme = location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${scheme}//${location.host}/api/room/${encodeURIComponent(this.code)}`

    let socket
    try {
      socket = new WebSocket(url)
    } catch {
      this.setStatus("failed")
      return
    }
    this.socket = socket

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return
      this.setStatus("waiting")
    })

    socket.addEventListener("message", event => {
      if (this.socket !== socket) return
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      this.receive(message)
    })

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return
      this.socket = null
      // A room that closed on us is a room to be rejoined by hand. Rejoining
      // on its behalf would quietly take a seat in a match that has already
      // been abandoned, which looks far more like a bug than a button does.
      this.setStatus(this.status === "idle" ? "idle" : "dropped")
    })

    socket.addEventListener("error", () => {
      if (this.socket !== socket) return
      this.setStatus("failed")
    })
  }

  receive(message) {
    if (!message || typeof message !== "object") return
    if (message.t === "welcome") {
      this.seat = message.seat
      this.setStatus(message.seat === null ? "watching" : "waiting")
      this.handlers.onWelcome?.(message)
      return
    }
    if (message.t === "track") {
      this.handlers.onTrack?.(message)
      return
    }
    if (message.t === "lobby") {
      this.handlers.onLobby?.(message)
      return
    }
    if (message.t === "state") {
      this.setStatus(message.state ? "playing" : "waiting")
      this.handlers.onState?.(message.state, message.mode)
      return
    }
    if (message.t === "chat") {
      this.handlers.onChat?.(message)
      return
    }
    if (message.t === "chatlog") {
      this.handlers.onChatLog?.(Array.isArray(message.messages) ? message.messages : [])
      return
    }
    if (message.t === "closed") {
      this.setStatus("closed")
      this.handlers.onClosed?.(message.reason)
      return
    }
    if (message.t === "left") {
      this.setStatus("waiting")
      this.handlers.onLeft?.(message.seat)
    }
  }

  setStatus(status) {
    if (this.status === status) return
    this.status = status
    this.handlers.onStatus?.(status)
  }

  send(message) {
    if (!this.connected) return
    try {
      this.socket.send(JSON.stringify(message))
    } catch {
      // The close handler is about to say the same thing more usefully.
    }
  }

  turn(dx, dy) {
    this.send({ t: "turn", dx, dy })
  }

  setHead(head) {
    this.send({ t: "head", head })
  }

  setNick(nick) {
    this.send({ t: "nick", nick })
  }

  setMode(mode) {
    this.send({ t: "mode", mode })
  }

  setWins(wins) {
    this.send({ t: "wins", wins })
  }

  beat(strength) {
    this.send({ t: "beat", strength })
  }

  setTrack(index, count) {
    this.send({ t: "track", index, count })
  }

  setReady(ready) {
    this.send({ t: "ready", ready })
  }

  chat(text) {
    this.send({ t: "chat", text })
  }

  toLobby() {
    this.send({ t: "tolobby" })
  }

  close() {
    const socket = this.socket
    this.socket = null
    this.seat = null
    this.status = "idle"
    if (socket) {
      try {
        socket.close()
      } catch {
        // Already gone, which is where we were trying to get to.
      }
    }
  }
}
