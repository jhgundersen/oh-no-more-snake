// Race: a board each, and a set of levels to get through before the other one
// does.
//
// A round is a set. Round one is levels 1.1 to 1.5, round two is 2.1 to 2.5,
// and the round is won by beating the boss waiting at the end of it — the duel
// at the top of every set is the finishing line, fought rather than merely
// arrived at. Crashing costs the set, not the round: the lane goes back to the
// first level of it while the other one keeps going.
//
// Each lane is a real `Game`. That is the whole design. Everything a race
// wants — levels, layouts, bosses, the snake eater, the ball, Party Mode and
// its combos — is already in `Game.js`, tested and ported from the desktop
// version, and a second implementation of any of it would be a second set of
// rules to keep in step with the first. So a lane does not resemble a
// single-player run: it is one.
//
// Nothing crosses between the two lanes. No shared apple, no obstacles sent
// across, no interference of any kind. The pressure is the number on the other
// side of the screen going up faster than yours.
//
// Like `Versus.js` this touches no DOM, no Canvas and no timers, and presents
// the same shape to whatever is driving it.

import { COLUMNS, LEVELS_PER_SET, ROWS, Game, isBossLevel } from "./Game.js"
import { DEFAULT_HEADS, MAX_SEATS, MIN_SEATS, validHead } from "./Versus.js"

export const RACE_COLUMNS = COLUMNS
export const RACE_ROWS = ROWS
export const WINS_NEEDED = 3

export { MAX_SEATS, MIN_SEATS }

export const COUNTDOWN_MS = 2000
export const ROUND_OVER_MS = 3000
// Long enough to see what you hit before the board puts you back at the start
// of the set.
export const CRASH_PAUSE_MS = 1100
// The single-player game fades a cleared level out and the next one in. A lane
// does the same, on its own clock, so a level clear reads as one rather than as
// the board changing under you.
export const LEVEL_FADE_MS = 900

// Two players who never eat never progress, and an online room must not stay
// open for ever on account of it.
const STALEMATE_MS = 5 * 60 * 1000

export const PHASE_LOBBY = "lobby"
export const PHASE_COUNTDOWN = "countdown"
export const PHASE_PLAYING = "playing"
export const PHASE_ROUND_OVER = "roundOver"
export const PHASE_MATCH_OVER = "matchOver"

export const DRAW = -1

// Round one is set one. The boss at the end of it is the finishing line.
export const setStartLevel = round => (Math.max(1, Math.floor(round)) - 1) * LEVELS_PER_SET + 1
export const setBossLevel = round => setStartLevel(round) + LEVELS_PER_SET - 1

// A lane's `Game` gets its own storage and never the player's. A race must not
// be able to write to somebody's best score, and `finish()` saves settings on
// every crash.
function memoryStore() {
  const kept = new Map()
  return {
    getItem: key => (kept.has(key) ? kept.get(key) : null),
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: key => kept.delete(key)
  }
}

function makeLane(seat, wrap) {
  return {
    seat,
    // A seat nobody is sitting in gets no board and no clock. Seats stay where
    // they are so a seat number means the same thing to the room, the boards
    // and the person sitting in it.
    present: seat < MIN_SEATS,
    game: new Game({ store: memoryStore() }),
    // Four faces as far apart as the roster allows, so a race nobody chose
    // anything for still has snakes that can be told apart.
    head: DEFAULT_HEADS[seat % DEFAULT_HEADS.length],
    wins: 0,
    crashMs: 0,
    crashes: 0,
    transitionMs: 0,
    prepared: false,
    finished: false,
    reason: null,
    accumulator: 0,
    wrap
  }
}

export class Race {
  constructor({ wrap = true, winsNeeded = WINS_NEEDED, present = null } = {}) {
    this.columns = RACE_COLUMNS
    this.rows = RACE_ROWS
    this.wrap = wrap
    this.winsNeeded = winsNeeded
    this.listeners = new Map()

    this.players = [0, 1, 2, 3].map(seat => makeLane(seat, wrap))
    this.players.forEach((lane, seat) => this.watch(lane, seat))
    if (present) this.setPresent(present)

    this.phase = PHASE_LOBBY
    this.phaseMs = 0
    this.round = 0
    this.elapsedMs = 0
    this.roundWinner = null
    this.matchWinner = null
  }

  // --- events ---

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, [])
    this.listeners.get(event).push(handler)
    return this
  }

  emit(event, ...args) {
    const handlers = this.listeners.get(event)
    if (handlers) for (const handler of handlers) handler(...args)
  }

  // What a lane's own game has to say for itself. The round is decided here
  // and nowhere else: beating the boss at the end of the set is winning it.
  watch(lane, seat) {
    lane.game.on("bossDefeated", () => {
      if (this.phase !== PHASE_PLAYING || lane.finished) return
      lane.finished = true
      if (this.roundWinner === null) this.roundWinner = seat
      this.emit("finished", seat)
      this.endRound()
    })
    lane.game.on("levelCompleted", () => {
      if (lane.finished) return
      lane.transitionMs = LEVEL_FADE_MS
      lane.prepared = false
      this.emit("levelCleared", seat)
    })
    // The party is already on; what the disco ball offers here is the music,
    // which only the browser in front of that player can actually start.
    lane.game.on("discoBallEaten", (x, y) => this.emit("discoBall", seat, x, y))
    lane.game.on("partyBonus", (name, points, x, y) => this.emit("bonus", seat, name, points, x, y))
    lane.game.on("foodEaten", (x, y, points) => this.emit("apple", seat, x, y, points))
  }

  setPresent(present) {
    this.players.forEach((lane, seat) => { lane.present = !!present[seat] })
  }

  get seated() {
    return this.players.filter(lane => lane.present)
  }

  // --- derived state ---

  get running() {
    return this.phase === PHASE_PLAYING
  }

  get over() {
    return this.phase === PHASE_MATCH_OVER
  }

  get countdownSeconds() {
    return Math.max(0, Math.ceil(this.phaseMs / 1000))
  }

  // How soon this wants to be stepped again. A lane on a later level moves
  // quicker than one still on 1.1, so the two run on their own clocks and the
  // driver is told when the nearer of them is next due.
  get pace() {
    if (this.phase !== PHASE_PLAYING) return 100
    let soonest = 100
    for (const lane of this.seated) {
      if (lane.finished || lane.crashMs > 0 || lane.transitionMs > 0) continue
      soonest = Math.min(soonest, Math.max(10, lane.game.tickInterval - lane.accumulator))
    }
    return soonest
  }

  get bossLevel() {
    return setBossLevel(this.round)
  }

  // How far through the set a lane is, for the bar over its board.
  progressOf(seat) {
    const lane = this.players[seat]
    if (!lane) return 0
    if (lane.finished) return 1
    const start = setStartLevel(this.round)
    const done = (lane.game.displayedLevel - start) + Math.min(1, lane.game.levelProgress)
    return Math.max(0, Math.min(1, done / LEVELS_PER_SET))
  }

  // --- starting ---

  startMatch() {
    for (const lane of this.players) lane.wins = 0
    this.round = 0
    this.matchWinner = null
    this.startRound()
    this.emit("matchStarted")
  }

  startRound() {
    ++this.round
    this.elapsedMs = 0
    this.roundWinner = null
    this.players.forEach((lane, seat) => {
      lane.finished = false
      lane.crashes = 0
      lane.reason = null
      if (lane.present) this.placeLane(seat, setStartLevel(this.round))
      else lane.game.snake = []
    })
    this.phase = PHASE_COUNTDOWN
    this.phaseMs = COUNTDOWN_MS
    this.emit("roundStarted", this.round)
    this.emit("boardChanged")
    this.emit("phaseChanged")
  }

  // A lane at the start of a level. `jumpToLevel` is the single-player game's
  // own way of being dropped onto one, and it marks the run as practice, which
  // is exactly right: nothing a race does may reach a best score or the charts.
  placeLane(seat, level) {
    const lane = this.players[seat]
    lane.crashMs = 0
    lane.transitionMs = 0
    lane.prepared = false
    lane.accumulator = 0
    lane.game.wallsWrap = this.wrap
    // Party Mode is simply how a race is played: there is no version of it
    // without the combos, and nothing to be gained by making people ask.
    lane.game.setPartyMode(true)
    // Which would ordinarily take the disco ball away, the party having
    // already started. Here it stays and becomes the way to start the music,
    // which is the one part of a party a room cannot switch on for you.
    lane.game.setDiscoBallEnabled(true)
    lane.game.jumpToLevel(level)
  }

  // --- input ---

  // Straight through to that lane's own game, which is also what makes a boss
  // finisher work: `Game.turn` sends a direction to `pressFinisher` while the
  // boss is down, and a race needs no idea that it does.
  turn(seat, dx, dy) {
    const lane = this.players[seat]
    if (!lane || !lane.present || lane.finished || lane.crashMs > 0) return false
    if (this.phase !== PHASE_PLAYING && this.phase !== PHASE_COUNTDOWN) return false
    lane.game.turn(dx, dy)
    return true
  }

  setHead(seat, index) {
    const lane = this.players[seat]
    if (!lane || this.phase === PHASE_PLAYING) return false
    lane.head = validHead(index)
    this.emit("boardChanged")
    return true
  }

  // A beat can only be heard by the browser playing the music, so it is
  // reported rather than measured here. It opens a window on that lane alone.
  registerBeat(seat, strength) {
    const lane = this.players[seat]
    if (!lane || !lane.present) return false
    lane.game.registerStrongBeat(strength)
    return true
  }

  // --- the clock ---

  // One call does everything: the phases, each lane's own board steps at its
  // own pace, the boss clocks, the combos and the two timers a lane can be
  // sitting in. The driver only has to know how often to call it.
  step(ms) {
    if (this.phase === PHASE_COUNTDOWN || this.phase === PHASE_ROUND_OVER) {
      this.phaseMs = Math.max(0, this.phaseMs - ms)
      if (this.phaseMs > 0) return
      if (this.phase === PHASE_COUNTDOWN) {
        this.phase = PHASE_PLAYING
        this.emit("phaseChanged")
        return
      }
      const champion = this.players.findIndex(lane => lane.present && lane.wins >= this.winsNeeded)
      if (champion >= 0) {
        this.matchWinner = champion
        this.phase = PHASE_MATCH_OVER
        this.emit("matchOver", champion)
        this.emit("phaseChanged")
        return
      }
      this.startRound()
      return
    }

    if (this.phase !== PHASE_PLAYING) return

    this.elapsedMs += ms
    if (this.elapsedMs > STALEMATE_MS) {
      this.roundWinner = DRAW
      this.endRound()
      return
    }

    this.players.forEach((lane, seat) => { if (lane.present) this.stepLane(lane, seat, ms) })
    this.emit("boardChanged")
  }

  stepLane(lane, seat, ms) {
    if (lane.finished) return

    // Sitting in a crash, waiting to be put back at the start of the set.
    if (lane.crashMs > 0) {
      lane.crashMs = Math.max(0, lane.crashMs - ms)
      if (lane.crashMs === 0) this.placeLane(seat, setStartLevel(this.round))
      return
    }

    // A lane whose game has ended is a crash, however it got there. Checking
    // only after a tick would miss one that ended between two of them — being
    // eaten by a boss happens on the boss's clock, not the snake's.
    if (lane.game.gameOver) {
      this.crash(lane, seat)
      return
    }

    // The boss clock and the party clock run while the board is deliberately
    // frozen, which is what the finish and the fatality are made of.
    lane.game.advanceBoss(ms)
    lane.game.advanceCombo(ms)

    // Between levels: fade out, swap while invisible, fade in. The single-
    // player game does this with tweens; a lane does it on a plain timer,
    // because nothing here is drawing.
    if (lane.transitionMs > 0) {
      lane.transitionMs = Math.max(0, lane.transitionMs - ms)
      if (!lane.prepared && lane.transitionMs <= LEVEL_FADE_MS / 2) {
        lane.prepared = true
        lane.game.prepareNextLevel()
      }
      if (lane.transitionMs === 0) {
        lane.game.completeLevelTransition()
        lane.accumulator = 0
      }
      return
    }

    lane.accumulator += ms
    let steps = 0
    while (lane.accumulator >= lane.game.tickInterval && steps++ < 5) {
      lane.accumulator -= lane.game.tickInterval
      lane.game.tick()
      if (lane.game.gameOver) {
        this.crash(lane, seat)
        return
      }
      // A level clear or a boss defeat freezes the board; the timers above
      // take it from here.
      if (lane.transitionMs > 0 || lane.finished) return
    }
  }

  crash(lane, seat) {
    lane.crashMs = CRASH_PAUSE_MS
    lane.transitionMs = 0
    ++lane.crashes
    lane.reason = lane.game.bossPhase === "fight" ? "eaten" : "crashed"
    this.emit("crashed", seat, lane.reason)
    this.emit("boardChanged")
  }

  endRound() {
    if (this.roundWinner !== DRAW && this.roundWinner !== null) {
      ++this.players[this.roundWinner].wins
    }
    this.phase = PHASE_ROUND_OVER
    this.phaseMs = ROUND_OVER_MS
    this.emit("roundOver", this.roundWinner)
    this.emit("boardChanged")
    this.emit("phaseChanged")
  }

  toLobby() {
    const kept = this.players.map(lane => ({ head: lane.head, present: lane.present }))
    this.players = [0, 1, 2, 3].map(seat => makeLane(seat, this.wrap))
    this.players.forEach((lane, seat) => {
      lane.head = kept[seat].head
      lane.present = kept[seat].present
      this.watch(lane, seat)
    })
    this.phase = PHASE_LOBBY
    this.phaseMs = 0
    this.round = 0
    this.roundWinner = null
    this.matchWinner = null
    this.emit("boardChanged")
    this.emit("phaseChanged")
  }

  // --- the wire ---

  snapshot() {
    return {
      mode: "race",
      columns: this.columns,
      rows: this.rows,
      wrap: this.wrap,
      winsNeeded: this.winsNeeded,
      phase: this.phase,
      phaseMs: Math.round(this.phaseMs),
      round: this.round,
      roundWinner: this.roundWinner,
      matchWinner: this.matchWinner,
      seats: this.seated.length,
      players: this.players.map(lane => ({
        present: lane.present,
        head: lane.head,
        wins: lane.wins,
        crashes: lane.crashes,
        crashMs: Math.round(lane.crashMs),
        transitionMs: Math.round(lane.transitionMs),
        finished: lane.finished,
        reason: lane.reason,
        game: lane.game.snapshot()
      }))
    }
  }

  applySnapshot(state) {
    if (!state || !Array.isArray(state.players)) return
    this.columns = state.columns
    this.rows = state.rows
    this.wrap = state.wrap
    this.winsNeeded = state.winsNeeded
    const phaseChanged = this.phase !== state.phase
    const roundChanged = this.round !== state.round
    this.phase = state.phase
    this.phaseMs = state.phaseMs
    this.round = state.round
    this.roundWinner = state.roundWinner
    this.matchWinner = state.matchWinner
    state.players.forEach((incoming, seat) => {
      const lane = this.players[seat]
      lane.present = incoming.present
      lane.head = validHead(incoming.head)
      lane.wins = incoming.wins
      lane.crashes = incoming.crashes
      lane.crashMs = incoming.crashMs
      lane.transitionMs = incoming.transitionMs
      lane.finished = incoming.finished
      lane.reason = incoming.reason
      lane.game.applySnapshot(incoming.game)
    })
    if (roundChanged) this.emit("roundStarted", this.round)
    if (phaseChanged) this.emit("phaseChanged")
    this.emit("boardChanged")
  }
}

export { isBossLevel }
