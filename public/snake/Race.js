// Race: a board each, and the first one to reach level 5 takes the round.
//
// The other two-player mode. Where `Versus.js` puts both snakes on one board
// and lets them ruin each other, this one puts them on boards that never touch
// and lets them watch each other's progress instead. Nothing crosses between
// the two lanes — no shared apple, no obstacles sent over, no interference of
// any kind. The pressure is entirely the number on the other side of the
// screen going up faster than yours.
//
// The levels are the single-player game's own: `obstacleCells` from `Game.js`
// draws 1.1 through 1.4, so a race is played on boards a player already knows
// rather than on four new ones invented for the occasion. Level 5 is where a
// run would meet a boss, and reaching it is what wins the round — so the duel
// at the top of the set is the finishing line rather than a fight.
//
// Like `Versus.js` this touches no DOM, no Canvas and no timers, and presents
// the same shape to whatever is driving it: the room and the browser handle
// both models through one interface.

import { COLUMNS, ROWS, obstacleCells } from "./Game.js"
import { validHead } from "./Versus.js"

export const RACE_COLUMNS = COLUMNS
export const RACE_ROWS = ROWS

// Reaching level five is the finish. A single-player run needs twelve points a
// level, which over four levels is a round of about four minutes — far too
// long for a best-of-three. Five apples a level makes a round something like
// forty seconds, which is the length a race wants to be.
export const TARGET_LEVEL = 5
export const APPLES_PER_LEVEL = 5
export const WINS_NEEDED = 3

export const COUNTDOWN_MS = 2000
export const ROUND_OVER_MS = 2600
// Long enough to see what you hit before the board puts you back at the start.
export const CRASH_PAUSE_MS = 900

// Both lanes run off one clock, which is the only arrangement that is
// obviously fair. It quickens as the race does, following whichever of them is
// further ahead — so closing a gap gets harder for the same reason opening one
// does.
const START_INTERVAL = 140
const LEVEL_SPEEDUP = 8
const FASTEST_INTERVAL = 85

// Two players who never eat never progress, and an online room must not stay
// open for ever on account of it.
const STALEMATE_TICKS = 1800

export const PHASE_LOBBY = "lobby"
export const PHASE_COUNTDOWN = "countdown"
export const PHASE_PLAYING = "playing"
export const PHASE_ROUND_OVER = "roundOver"
export const PHASE_MATCH_OVER = "matchOver"

export const DRAW = -1

const point = (x, y) => ({ x, y })
const same = (a, b) => a.x === b.x && a.y === b.y
const has = (list, p) => list.some(cell => same(cell, p))

export const NOWHERE = { x: -1, y: -1 }

// The single-player game's own spawn rule, which is what makes a race board
// behave like a level rather than like a new thing that looks like one: three
// cells long facing right, as near the middle row as a clear run allows, and
// a fixed fallback so a crowded layout still gets a snake.
export function findSpawn(obstacles, columns = RACE_COLUMNS, rows = RACE_ROWS) {
  const preferred = Math.floor(rows / 2)
  for (let run = 10; run >= 4; run -= 2) {
    for (let offset = 0; offset < rows; ++offset) {
      const y = preferred + (offset % 2 === 0 ? offset / 2 : -(offset + 1) / 2)
      if (y < 0 || y >= rows) continue
      for (let x = 2; x <= columns - run - 1; ++x) {
        let clear = true
        for (let k = 0; k < run; ++k) {
          if (has(obstacles, point(x + k, y))) {
            clear = false
            break
          }
        }
        if (clear) return point(x, y)
      }
    }
  }
  return point(2, preferred)
}

function makeLane(seat) {
  return {
    seat,
    snake: [],
    direction: point(1, 0),
    turnQueue: [],
    level: 1,
    apples: 0,
    food: { ...NOWHERE },
    wins: 0,
    // Two different faces to begin with, so a race nobody chose anything for
    // still has two snakes that can be told apart.
    head: seat === 0 ? 0 : 3,
    // A lane is only ever briefly not alive: a crash is a setback here, not an
    // ending, and the flag exists so the board can show the crash before the
    // restart wipes it.
    alive: true,
    crashAt: null,
    crashMs: 0,
    crashes: 0,
    reason: null,
    finished: false
  }
}

export class Race {
  constructor({ random = Math.random, wrap = true, winsNeeded = WINS_NEEDED } = {}) {
    this.random = random
    this.columns = RACE_COLUMNS
    this.rows = RACE_ROWS
    this.wrap = wrap
    this.winsNeeded = winsNeeded
    this.listeners = new Map()

    this.players = [makeLane(0), makeLane(1)]
    this.phase = PHASE_LOBBY
    this.phaseMs = 0
    this.round = 0
    this.tickNumber = 0
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

  // Whoever is further ahead sets the pace for both of them.
  get tickInterval() {
    const front = Math.max(this.players[0].level, this.players[1].level)
    return Math.max(FASTEST_INTERVAL, START_INTERVAL - (front - 1) * LEVEL_SPEEDUP)
  }

  // How far through the race a lane is, as a fraction, for the bar over each
  // board. Levels cleared count for far more than apples within one.
  progressOf(seat) {
    const lane = this.players[seat]
    if (!lane) return 0
    const levels = TARGET_LEVEL - 1
    const done = (lane.level - 1) + Math.min(1, lane.apples / APPLES_PER_LEVEL)
    return Math.max(0, Math.min(1, done / levels))
  }

  obstaclesOf(seat) {
    const lane = this.players[seat]
    return lane ? obstacleCells(lane.level) : []
  }

  laneOccupied(seat, p) {
    const lane = this.players[seat]
    return has(this.obstaclesOf(seat), p) || has(lane.snake, p)
  }

  freeCells(seat) {
    const lane = this.players[seat]
    const free = []
    for (let y = 0; y < this.rows; ++y) {
      for (let x = 0; x < this.columns; ++x) {
        const p = point(x, y)
        if (this.laneOccupied(seat, p) || same(p, lane.food)) continue
        free.push(p)
      }
    }
    return free
  }

  spawnFood(seat) {
    const lane = this.players[seat]
    const free = this.freeCells(seat)
    lane.food = free.length ? { ...free[Math.floor(this.random() * free.length)] } : { ...NOWHERE }
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
    this.tickNumber = 0
    this.roundWinner = null
    this.players.forEach((lane, seat) => {
      lane.level = 1
      lane.crashes = 0
      lane.finished = false
      this.placeLane(seat)
    })
    this.phase = PHASE_COUNTDOWN
    this.phaseMs = COUNTDOWN_MS
    this.emit("roundStarted", this.round)
    this.emit("boardChanged")
    this.emit("phaseChanged")
  }

  // A lane at the start of one of its levels.
  placeLane(seat) {
    const lane = this.players[seat]
    const start = findSpawn(this.obstaclesOf(seat), this.columns, this.rows)
    lane.snake = [
      point(start.x + 2, start.y),
      point(start.x + 1, start.y),
      point(start.x, start.y)
    ]
    lane.direction = point(1, 0)
    lane.turnQueue = []
    lane.apples = 0
    lane.alive = true
    lane.crashAt = null
    lane.crashMs = 0
    lane.food = { ...NOWHERE }
    this.spawnFood(seat)
  }

  // --- input ---

  turn(seat, dx, dy) {
    const lane = this.players[seat]
    if (!lane || !lane.alive || lane.finished) return false
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false
    if (this.phase !== PHASE_PLAYING && this.phase !== PHASE_COUNTDOWN) return false
    if (lane.turnQueue.length >= 2) return false
    const next = point(dx, dy)
    const last = lane.turnQueue.length ? lane.turnQueue[lane.turnQueue.length - 1] : lane.direction
    if (same(next, last) || same(next, point(-last.x, -last.y))) return false
    lane.turnQueue.push(next)
    return true
  }

  setHead(seat, index) {
    const lane = this.players[seat]
    if (!lane || this.phase === PHASE_PLAYING) return false
    lane.head = validHead(index)
    this.emit("boardChanged")
    return true
  }

  // --- the clock ---

  advance(ms) {
    // A crashed lane sits still long enough to be looked at, then goes back to
    // the beginning. The other lane keeps racing throughout, which is the
    // entire cost of crashing. Only while the race is actually running: a lane
    // that crashed on the last step of a round stays crashed, because that is
    // the frame the round ended on.
    if (this.phase === PHASE_PLAYING) {
      let restarted = false
      this.players.forEach((lane, seat) => {
        if (lane.crashMs <= 0) return
        lane.crashMs = Math.max(0, lane.crashMs - ms)
        if (lane.crashMs > 0) return
        lane.level = 1
        this.placeLane(seat)
        restarted = true
      })
      if (restarted) this.emit("boardChanged")
    }

    if (this.phase !== PHASE_COUNTDOWN && this.phase !== PHASE_ROUND_OVER) return
    this.phaseMs = Math.max(0, this.phaseMs - ms)
    if (this.phaseMs > 0) return

    if (this.phase === PHASE_COUNTDOWN) {
      this.phase = PHASE_PLAYING
      this.emit("phaseChanged")
      return
    }

    const champion = this.players.findIndex(lane => lane.wins >= this.winsNeeded)
    if (champion >= 0) {
      this.matchWinner = champion
      this.phase = PHASE_MATCH_OVER
      this.emit("matchOver", champion)
      this.emit("phaseChanged")
      return
    }
    this.startRound()
  }

  // --- a board step ---

  tick() {
    if (this.phase !== PHASE_PLAYING) return
    if (++this.tickNumber > STALEMATE_TICKS) {
      this.roundWinner = DRAW
      this.endRound()
      return
    }

    const finishers = []
    this.players.forEach((lane, seat) => {
      // Nothing moves in a lane that is waiting out a crash, and nothing moves
      // in one that has already reached the finish.
      if (lane.crashMs > 0 || lane.finished) return
      if (this.stepLane(seat)) finishers.push(seat)
    })

    if (finishers.length) {
      this.roundWinner = finishers.length === 2 ? DRAW : finishers[0]
      this.endRound()
      return
    }
    this.emit("boardChanged")
  }

  // One lane's board step. Returns true when this step took it to the finish.
  stepLane(seat) {
    const lane = this.players[seat]
    if (lane.turnQueue.length) lane.direction = lane.turnQueue.shift()

    const head = point(lane.snake[0].x + lane.direction.x, lane.snake[0].y + lane.direction.y)
    let offBoard = false
    if (head.x < 0 || head.x >= this.columns || head.y < 0 || head.y >= this.rows) {
      if (this.wrap) {
        head.x = (head.x + this.columns) % this.columns
        head.y = (head.y + this.rows) % this.rows
      } else offBoard = true
    }

    const eats = !offBoard && same(head, lane.food)
    // Moving into the tail is legal when that tail moves away this step, the
    // same as it is in a single-player run.
    const body = lane.snake.slice(0, lane.snake.length - (eats ? 0 : 1))

    if (offBoard || has(this.obstaclesOf(seat), head) || has(body, head)) {
      this.crash(seat, head, offBoard ? "wall" : has(body, head) ? "self" : "wall")
      return false
    }

    lane.snake.unshift(head)
    if (!eats) {
      lane.snake.pop()
      return false
    }

    ++lane.apples
    this.emit("apple", seat, head.x, head.y)
    if (lane.apples < APPLES_PER_LEVEL) {
      this.spawnFood(seat)
      return false
    }

    // A level cleared. Reaching level five is the finish, so the lane stops
    // there rather than being put on the board a boss would be waiting on.
    ++lane.level
    this.emit("levelReached", seat, lane.level)
    if (lane.level >= TARGET_LEVEL) {
      lane.finished = true
      lane.apples = APPLES_PER_LEVEL
      return true
    }
    this.placeLane(seat)
    return false
  }

  crash(seat, at, reason) {
    const lane = this.players[seat]
    lane.alive = false
    lane.crashAt = at
    lane.crashMs = CRASH_PAUSE_MS
    lane.reason = reason
    ++lane.crashes
    this.emit("crashed", seat, at.x, at.y, reason)
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
    const heads = this.players.map(lane => lane.head)
    this.players = [makeLane(0), makeLane(1)]
    this.players.forEach((lane, seat) => { lane.head = heads[seat] })
    this.phase = PHASE_LOBBY
    this.phaseMs = 0
    this.round = 0
    this.tickNumber = 0
    this.roundWinner = null
    this.matchWinner = null
    this.emit("boardChanged")
    this.emit("phaseChanged")
  }

  // --- the wire ---

  indexOf(cell) {
    if (!cell) return -1
    if (cell.x < 0 || cell.y < 0 || cell.x >= this.columns || cell.y >= this.rows) return -1
    return cell.y * this.columns + cell.x
  }

  cellAt(index) {
    return index < 0 ? { ...NOWHERE } : point(index % this.columns, Math.floor(index / this.columns))
  }

  // The walls are not sent. A lane's layout is `obstacleCells` of its level and
  // nothing else, so both ends work it out from the one number rather than
  // shipping forty cells of it ten times a second.
  snapshot() {
    return {
      mode: "race",
      columns: this.columns,
      rows: this.rows,
      wrap: this.wrap,
      winsNeeded: this.winsNeeded,
      target: TARGET_LEVEL,
      applesPerLevel: APPLES_PER_LEVEL,
      phase: this.phase,
      phaseMs: Math.round(this.phaseMs),
      round: this.round,
      tickNumber: this.tickNumber,
      roundWinner: this.roundWinner,
      matchWinner: this.matchWinner,
      players: this.players.map(lane => ({
        snake: lane.snake.map(cell => this.indexOf(cell)),
        direction: [lane.direction.x, lane.direction.y],
        level: lane.level,
        apples: lane.apples,
        food: this.indexOf(lane.food),
        wins: lane.wins,
        head: lane.head,
        alive: lane.alive,
        crashes: lane.crashes,
        crashMs: Math.round(lane.crashMs),
        reason: lane.reason,
        finished: lane.finished,
        crash: lane.crashAt ? this.indexOf(lane.crashAt) : -1
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
    this.tickNumber = state.tickNumber
    this.roundWinner = state.roundWinner
    this.matchWinner = state.matchWinner
    state.players.forEach((incoming, seat) => {
      const lane = this.players[seat]
      lane.snake = incoming.snake.map(index => this.cellAt(index))
      lane.direction = point(incoming.direction[0], incoming.direction[1])
      lane.level = incoming.level
      lane.apples = incoming.apples
      lane.food = this.cellAt(incoming.food)
      lane.wins = incoming.wins
      lane.head = validHead(incoming.head)
      lane.alive = incoming.alive
      lane.crashes = incoming.crashes
      lane.crashMs = incoming.crashMs
      lane.reason = incoming.reason
      lane.finished = incoming.finished
      lane.crashAt = incoming.crash < 0 ? null : this.cellAt(incoming.crash)
    })
    if (roundChanged) this.emit("roundStarted", this.round)
    if (phaseChanged) this.emit("phaseChanged")
    this.emit("boardChanged")
  }
}
