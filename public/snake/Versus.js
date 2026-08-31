// Versus: two snakes, one board, one apple.
//
// A third mode beside Levels and Endless, and deliberately its own model
// rather than a second snake bolted into `Game.js`. Everything a duel wants —
// a bigger board, a shared apple, rounds — is something the level machinery
// would have to be taught to ignore, and everything the level machinery
// already does — bosses, party events, the snake eater, progression by score —
// is something a duel does not want. Two small models beat one that is
// pretending.
//
// Like `Game.js` this touches no DOM, no Canvas and no timers, which is what
// lets Node test it and, more to the point here, lets the Durable Object in
// `src/room.js` run the very rules the browser draws instead of a second copy
// of them that drifts.

// A duel needs room. 22x16 is a single-player board — two snakes growing on it
// meet before either has had a chance to be clever.
export const VERSUS_COLUMNS = 32
export const VERSUS_ROWS = 22

export const WINS_NEEDED = 3

export const PHASE_LOBBY = "lobby"
export const PHASE_COUNTDOWN = "countdown"
export const PHASE_PLAYING = "playing"
export const PHASE_ROUND_OVER = "roundOver"
export const PHASE_MATCH_OVER = "matchOver"

// Long enough to find the keys, short enough not to be a wait. The whole
// countdown happens again every round, so it is paid for repeatedly.
export const COUNTDOWN_MS = 2000
export const ROUND_OVER_MS = 2600

// Rounds start brisk and get brisker, and every apple eaten speeds the board
// up for both players — the one at the back is being hurried along by the one
// in front, which is the pressure the mode runs on.
const START_INTERVAL = 140
const ROUND_SPEEDUP = 10
const SLOWEST_ROUND_INTERVAL = 90
const APPLE_SPEEDUP = 4
const FASTEST_INTERVAL = 70

// Two players who never eat never speed each other up, and an online room
// where nobody moves toward anything must not stay open for ever. Three
// minutes of mutual politeness is a draw.
const STALEMATE_TICKS = 1800

// Neither of them. Used for a round where both crashed on the same tick with
// the same number of apples, and for the match if that somehow decides it.
export const DRAW = -1

// The faces a player can pick before a match. The roster lives here rather
// than in `Draw.js` because a head travels on the wire and a room has to be
// able to refuse one it does not recognise; how each is painted is the view's
// business, exactly as a boss's roster and a boss's portrait are kept apart.
//
// All six differ in the eyes alone. Horns and crests read as a bump at ten
// pixels a side, which is the size a head actually is, and the point of
// picking one is that the other player can see which snake is yours.
export const HEADS = [
  { id: "wide", name: "Wide" },
  { id: "slit", name: "Slit" },
  { id: "visor", name: "Visor" },
  { id: "fierce", name: "Fierce" },
  { id: "cyclops", name: "Cyclops" },
  { id: "sleepy", name: "Sleepy" }
]

// Anything that is not one of them is the first one. A head arrives from a
// browser, so it is not to be trusted to be a number, let alone one in range.
export function validHead(index) {
  const value = Math.floor(Number(index))
  return Number.isFinite(value) ? ((value % HEADS.length) + HEADS.length) % HEADS.length : 0
}

const point = (x, y) => ({ x, y })
const same = (a, b) => a.x === b.x && a.y === b.y
const has = (list, p) => list.some(cell => same(cell, p))

export const NOWHERE = { x: -1, y: -1 }

// --- the board ---------------------------------------------------------------

// Where each snake is born: three cells long, facing the middle, a third of
// the way down its own side. The second spawn is the first turned through half
// a turn, which is the only arrangement in which neither player can be said to
// have the better half of the board.
export const SPAWN_MARGIN = 3
export const SPAWN_LENGTH = 3
// How far ahead of each snake is kept clear, so nobody is born facing a wall.
const SPAWN_RUNWAY = 6

export const mirrorCell = (cell, columns, rows) =>
  point(columns - 1 - cell.x, rows - 1 - cell.y)

export function spawnRow(rows) {
  return Math.floor(rows / 3)
}

// The first snake's body, head first, facing right.
export function spawnCells(columns, rows) {
  const y = spawnRow(rows)
  const cells = []
  for (let i = 0; i < SPAWN_LENGTH; ++i) cells.push(point(SPAWN_MARGIN + SPAWN_LENGTH - 1 - i, y))
  return cells
}

// Every cell an obstacle may not use: both snakes, and the run each of them is
// about to travel. It is symmetric under a half turn by construction, because
// the second half of it is the first half turned — which is what lets the
// obstacle filter drop a cell without having to remember to drop its twin.
export function spawnZone(columns, rows) {
  const zone = []
  const y = spawnRow(rows)
  for (let i = 0; i < SPAWN_LENGTH + SPAWN_RUNWAY; ++i) {
    const cell = point(SPAWN_MARGIN + i, y)
    zone.push(cell)
    zone.push(mirrorCell(cell, columns, rows))
  }
  return zone
}

// Four arrangements, each drawn in one half of the board and then turned
// through half a turn onto the other. Round one is empty on purpose: the first
// thing a new player should have to deal with is the other player.
export function versusObstacles(round, columns = VERSUS_COLUMNS, rows = VERSUS_ROWS) {
  const shape = (Math.max(1, Math.floor(round)) - 1) % 4
  const half = []
  const put = (x, y) => half.push(point(Math.round(x), Math.round(y)))
  const bar = (x, y, dx, dy, length) => {
    for (let i = 0; i < length; ++i) put(x + dx * i, y + dy * i)
  }

  const midX = (columns - 1) / 2
  const midY = (rows - 1) / 2
  const short = Math.max(3, Math.round(rows * 0.22))
  const long = Math.max(4, Math.round(columns * 0.2))

  if (shape === 1) {
    // Posts: a wall on each flank, offset so the board reads as a pinwheel
    // rather than a corridor.
    bar(columns * 0.31, rows * 0.09, 0, 1, short)
    bar(columns * 0.13, rows * 0.68, 1, 0, long)
  } else if (shape === 2) {
    // A pair of rails either side of the middle, leaving the centre open.
    bar(midX - long / 2, midY - rows * 0.16, 1, 0, long)
    bar(columns * 0.72, rows * 0.09, 0, 1, short)
  } else if (shape === 3) {
    // Corner blocks: the outside of the board gets tighter, the middle stays
    // the place worth fighting over.
    bar(columns * 0.14, rows * 0.14, 1, 0, 3)
    bar(columns * 0.14, rows * 0.14, 0, 1, 3)
    bar(columns * 0.62, rows * 0.36, 1, 0, Math.max(3, Math.round(long * 0.7)))
  }

  const zone = spawnZone(columns, rows)
  const cells = []
  const keep = cell => {
    if (cell.x < 0 || cell.x >= columns || cell.y < 0 || cell.y >= rows) return false
    if (has(zone, cell)) return false
    return !has(cells, cell)
  }
  for (const cell of half) {
    const twin = mirrorCell(cell, columns, rows)
    if (keep(cell)) cells.push(cell)
    if (keep(twin)) cells.push(twin)
  }
  return cells
}

// --- the model ---------------------------------------------------------------

function makePlayer(seat) {
  return {
    seat,
    snake: [],
    direction: point(seat === 0 ? 1 : -1, 0),
    turnQueue: [],
    // Two different faces to begin with, so a match nobody chose anything for
    // still has two snakes that can be told apart.
    head: seat === 0 ? 0 : 3,
    // Apples this round, which is also how a round both players lost is
    // decided; apples all match, which is only ever flavour.
    score: 0,
    total: 0,
    wins: 0,
    alive: true,
    reason: null,
    // The cell it was heading for when it died, which is not where its head
    // is: a snake is left standing where it crashed so the last frame of a
    // round shows what it ran into.
    crashAt: null
  }
}

export class Versus {
  constructor({
    random = Math.random,
    columns = VERSUS_COLUMNS,
    rows = VERSUS_ROWS,
    wrap = true,
    winsNeeded = WINS_NEEDED
  } = {}) {
    this.random = random
    this.columns = columns
    this.rows = rows
    this.wrap = wrap
    this.winsNeeded = winsNeeded
    this.listeners = new Map()

    this.players = [makePlayer(0), makePlayer(1)]
    this.obstacles = []
    this.food = { ...NOWHERE }
    this.phase = PHASE_LOBBY
    this.phaseMs = 0
    this.round = 0
    this.tickNumber = 0
    this.apples = 0
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

  // Whole seconds left, so the board can count "3, 2, 1" without knowing the
  // countdown's length.
  get countdownSeconds() {
    return Math.max(0, Math.ceil(this.phaseMs / 1000))
  }

  get tickInterval() {
    const base = Math.max(SLOWEST_ROUND_INTERVAL, START_INTERVAL - (this.round - 1) * ROUND_SPEEDUP)
    return Math.max(FASTEST_INTERVAL, base - this.appleCount * APPLE_SPEEDUP)
  }

  // Apples eaten this round, by either of them.
  get appleCount() {
    return this.players[0].score + this.players[1].score
  }

  isObstacle(p) {
    return has(this.obstacles, p)
  }

  occupied(p) {
    if (this.isObstacle(p)) return true
    return this.players.some(player => has(player.snake, p))
  }

  freeCells() {
    const free = []
    for (let y = 0; y < this.rows; ++y) {
      for (let x = 0; x < this.columns; ++x) {
        const p = point(x, y)
        if (this.occupied(p) || same(p, this.food)) continue
        free.push(p)
      }
    }
    return free
  }

  // --- starting ---

  startMatch() {
    for (const player of this.players) {
      player.wins = 0
      player.total = 0
    }
    this.round = 0
    this.apples = 0
    this.matchWinner = null
    this.startRound()
    this.emit("matchStarted")
  }

  startRound() {
    ++this.round
    this.tickNumber = 0
    this.roundWinner = null
    this.obstacles = versusObstacles(this.round, this.columns, this.rows)

    const cells = spawnCells(this.columns, this.rows)
    this.players.forEach((player, seat) => {
      player.snake = seat === 0
        ? cells.map(cell => ({ ...cell }))
        : cells.map(cell => mirrorCell(cell, this.columns, this.rows))
      player.direction = point(seat === 0 ? 1 : -1, 0)
      player.turnQueue = []
      player.score = 0
      player.alive = true
      player.reason = null
      player.crashAt = null
    })

    this.food = { ...NOWHERE }
    this.spawnFood()
    this.phase = PHASE_COUNTDOWN
    this.phaseMs = COUNTDOWN_MS
    this.emit("roundStarted", this.round)
    this.emit("boardChanged")
    this.emit("phaseChanged")
  }

  spawnFood() {
    const free = this.freeCells()
    if (!free.length) {
      this.food = { ...NOWHERE }
      return
    }
    this.food = { ...free[Math.floor(this.random() * free.length)] }
  }

  // Purely a face, but not while the board is moving: a snake that changes
  // expression mid-round is a thing to look at during the one moment there is
  // something else to look at.
  setHead(seat, index) {
    const player = this.players[seat]
    if (!player || this.phase === PHASE_PLAYING) return false
    player.head = validHead(index)
    this.emit("boardChanged")
    return true
  }

  // --- input ---

  // The same two-turn queue the single-player game has, for the same reason: a
  // fast double tap around a corner has to survive a tick boundary. It matters
  // more here, because online the tick boundary is somebody else's.
  turn(seat, dx, dy) {
    const player = this.players[seat]
    if (!player || !player.alive) return false
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false
    if (this.phase !== PHASE_PLAYING && this.phase !== PHASE_COUNTDOWN) return false
    if (player.turnQueue.length >= 2) return false
    const next = point(dx, dy)
    const last = player.turnQueue.length
      ? player.turnQueue[player.turnQueue.length - 1]
      : player.direction
    if (same(next, last) || same(next, point(-last.x, -last.y))) return false
    player.turnQueue.push(next)
    return true
  }

  // --- the clock ---

  // Drives the phases that pass on their own. The caller drives `tick()`
  // separately, at `tickInterval`, because a board step is not a wall-clock
  // event: the browser runs them off an accumulator and the room off a timer.
  advance(ms) {
    if (this.phase !== PHASE_COUNTDOWN && this.phase !== PHASE_ROUND_OVER) return
    this.phaseMs = Math.max(0, this.phaseMs - ms)
    if (this.phaseMs > 0) return

    if (this.phase === PHASE_COUNTDOWN) {
      this.phase = PHASE_PLAYING
      this.emit("phaseChanged")
      return
    }

    const champion = this.players.findIndex(player => player.wins >= this.winsNeeded)
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
      this.endRound(["stalemate", "stalemate"])
      return
    }

    const heads = []
    const offBoard = []
    const eats = []

    this.players.forEach(player => {
      if (player.turnQueue.length) player.direction = player.turnQueue.shift()
      const head = point(player.snake[0].x + player.direction.x, player.snake[0].y + player.direction.y)
      let off = false
      if (head.x < 0 || head.x >= this.columns || head.y < 0 || head.y >= this.rows) {
        if (this.wrap) {
          head.x = (head.x + this.columns) % this.columns
          head.y = (head.y + this.rows) % this.rows
        } else off = true
      }
      heads.push(head)
      offBoard.push(off)
      eats.push(!off && same(head, this.food))
    })

    // What each body will still be covering once it has moved. Dropping the
    // tail of a snake that is not growing is what makes following your own
    // tail — or somebody else's — legal, exactly as it is in single player.
    const bodies = this.players.map((player, seat) =>
      player.snake.slice(0, player.snake.length - (eats[seat] ? 0 : 1)))

    const deaths = [null, null]
    this.players.forEach((player, seat) => {
      const other = 1 - seat
      const head = heads[seat]
      if (offBoard[seat]) deaths[seat] = "wall"
      else if (this.isObstacle(head)) deaths[seat] = "wall"
      else if (has(bodies[seat], head)) deaths[seat] = "self"
      // Two heads into the same cell is nobody's fault and nobody's win. It is
      // also the only way both of them can reach the apple on the same tick,
      // which is why the apple never has to be argued over.
      else if (same(head, heads[other])) deaths[seat] = "head-on"
      else if (has(bodies[other], head)) deaths[seat] = "rival"
    })

    let eaten = false
    this.players.forEach((player, seat) => {
      if (deaths[seat]) {
        // Left where it crashed rather than moved into the wall: the last
        // frame of a round should show whose fault it was.
        player.crashAt = heads[seat]
        this.emit("crashed", seat, heads[seat].x, heads[seat].y, deaths[seat])
        return
      }
      player.snake.unshift(heads[seat])
      if (eats[seat]) {
        ++player.score
        ++player.total
        ++this.apples
        eaten = true
        this.emit("apple", seat, heads[seat].x, heads[seat].y)
      } else player.snake.pop()
    })

    if (deaths[0] || deaths[1]) {
      this.endRound(deaths)
      return
    }
    if (eaten) this.spawnFood()
    this.emit("boardChanged")
  }

  endRound(deaths) {
    this.players.forEach((player, seat) => {
      if (!deaths[seat]) return
      player.alive = false
      player.reason = deaths[seat]
    })

    if (deaths[0] && deaths[1]) {
      // Both gone on the same tick. Whoever ate more takes it, which is the
      // one place where racing for the apple pays off directly.
      const [first, second] = this.players
      this.roundWinner = first.score === second.score ? DRAW : first.score > second.score ? 0 : 1
    } else this.roundWinner = deaths[0] ? 1 : 0

    if (this.roundWinner !== DRAW) ++this.players[this.roundWinner].wins
    this.phase = PHASE_ROUND_OVER
    this.phaseMs = ROUND_OVER_MS
    this.emit("roundOver", this.roundWinner)
    this.emit("boardChanged")
    this.emit("phaseChanged")
  }

  // Back to waiting for people. An online room that loses a player throws its
  // match away rather than freezing it, and this is what the browser watching
  // that room pours in when the room says there is nothing to show.
  toLobby() {
    const heads = this.players.map(player => player.head)
    this.players = [makePlayer(0), makePlayer(1)]
    this.players.forEach((player, seat) => { player.head = heads[seat] })
    this.obstacles = []
    this.food = { ...NOWHERE }
    this.phase = PHASE_LOBBY
    this.phaseMs = 0
    this.round = 0
    this.tickNumber = 0
    this.apples = 0
    this.roundWinner = null
    this.matchWinner = null
    this.emit("boardChanged")
    this.emit("phaseChanged")
  }

  // --- the wire ---

  // Cells travel as one number each. A snake is the hot part of every frame
  // and there are two of them, sixty times a round; a pair of coordinates per
  // cell would double the message for nothing.
  indexOf(cell) {
    if (!cell) return -1
    // Off the board in either direction is nowhere. Checking only for negatives
    // would send a snake that died one cell past the right-hand wall as an
    // index that decodes to a real cell on the next row down.
    if (cell.x < 0 || cell.y < 0 || cell.x >= this.columns || cell.y >= this.rows) return -1
    return cell.y * this.columns + cell.x
  }

  cellAt(index) {
    return index < 0 ? { ...NOWHERE } : point(index % this.columns, Math.floor(index / this.columns))
  }

  snapshot() {
    return {
      columns: this.columns,
      rows: this.rows,
      wrap: this.wrap,
      winsNeeded: this.winsNeeded,
      phase: this.phase,
      phaseMs: Math.round(this.phaseMs),
      round: this.round,
      tickNumber: this.tickNumber,
      obstacles: this.obstacles.map(cell => this.indexOf(cell)),
      food: this.indexOf(this.food),
      roundWinner: this.roundWinner,
      matchWinner: this.matchWinner,
      players: this.players.map(player => ({
        snake: player.snake.map(cell => this.indexOf(cell)),
        direction: [player.direction.x, player.direction.y],
        score: player.score,
        total: player.total,
        wins: player.wins,
        alive: player.alive,
        reason: player.reason,
        head: player.head,
        crash: player.crashAt ? this.indexOf(player.crashAt) : -1
      }))
    }
  }

  // The other half of `snapshot`. A browser watching an online match holds a
  // `Versus` that is never ticked — the room does that — and is poured into
  // through here, so the renderer only ever knows one shape of board.
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
    this.obstacles = state.obstacles.map(index => this.cellAt(index))
    this.food = this.cellAt(state.food)
    this.roundWinner = state.roundWinner
    this.matchWinner = state.matchWinner
    state.players.forEach((incoming, seat) => {
      const player = this.players[seat]
      player.snake = incoming.snake.map(index => this.cellAt(index))
      player.direction = point(incoming.direction[0], incoming.direction[1])
      player.score = incoming.score
      player.total = incoming.total
      player.wins = incoming.wins
      player.alive = incoming.alive
      player.reason = incoming.reason
      player.head = validHead(incoming.head)
      player.crashAt = incoming.crash < 0 ? null : this.cellAt(incoming.crash)
    })
    if (roundChanged) this.emit("roundStarted", this.round)
    if (phaseChanged) this.emit("phaseChanged")
    this.emit("boardChanged")
  }
}
