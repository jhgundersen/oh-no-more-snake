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

// Four is where the board runs out of corners to be fair with, and where the
// four ways of drawing a snake — two shapes against two theme colours — run
// out too. A duel of two is the same game with two of the four seats empty.
export const MAX_SEATS = 4
export const MIN_SEATS = 2

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

// Bitten below this there is nothing left to be: a snake that is only a head
// has been eaten. It is what finishes a boss, and it finishes a duel the same.
const MINIMUM_LENGTH = 2

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

// Wide, fierce, visor and sleepy: the four that look least like each other.
export const DEFAULT_HEADS = [0, 3, 2, 5]

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

// A rectangle has four symmetries and no more: leaving it alone, turning it
// through half a turn, and reflecting it in each axis. Four spawns placed on
// one orbit of that group are equivalent to each other, which is the whole of
// what "fair" means here — a quarter turn would be fairer still and does not
// exist on a board that is wider than it is tall.
export const mirrorCell = (cell, columns, rows) =>
  point(columns - 1 - cell.x, rows - 1 - cell.y)
export const flipRow = (cell, columns, rows) => point(cell.x, rows - 1 - cell.y)

export function spawnRow(rows) {
  return Math.floor(rows / 3)
}

// Where each seat is placed, as a transform of the first. Seats two and three
// are the first pair reflected top to bottom, so a four-way duel is two facing
// right on the left and two facing left on the right.
const SEAT_PLACEMENT = [
  cell => cell,
  (cell, columns, rows) => mirrorCell(cell, columns, rows),
  (cell, columns, rows) => flipRow(cell, columns, rows),
  (cell, columns, rows) => flipRow(mirrorCell(cell, columns, rows), columns, rows)
]

// The first snake's body, head first, facing right.
export function spawnCells(columns, rows) {
  const y = spawnRow(rows)
  const cells = []
  for (let i = 0; i < SPAWN_LENGTH; ++i) cells.push(point(SPAWN_MARGIN + SPAWN_LENGTH - 1 - i, y))
  return cells
}

// One seat's snake, head first, facing inwards.
export function spawnFor(seat, columns, rows) {
  const place = SEAT_PLACEMENT[seat] || SEAT_PLACEMENT[0]
  return spawnCells(columns, rows).map(cell => place(cell, columns, rows))
}

// Which way a seat sets off: the left-hand pair inwards to the right, the
// right-hand pair inwards to the left.
export const spawnDirection = seat => point(seat === 0 || seat === 2 ? 1 : -1, 0)

// Every cell an obstacle may not use: every snake that could be there, and the
// run each is about to travel. It is closed under the board's symmetries by
// construction, which is what lets the obstacle filter drop a cell without
// having to remember to drop its mirrors.
export function spawnZone(columns, rows, seats = MAX_SEATS) {
  const zone = []
  const y = spawnRow(rows)
  for (let i = 0; i < SPAWN_LENGTH + SPAWN_RUNWAY; ++i) {
    const cell = point(SPAWN_MARGIN + i, y)
    for (let seat = 0; seat < seats; ++seat) {
      zone.push(SEAT_PLACEMENT[seat](cell, columns, rows))
    }
  }
  return zone
}

// Four arrangements, each drawn in one half of the board and then turned
// through half a turn onto the other. Round one is empty on purpose: the first
// thing a new player should have to deal with is the other player.
export function versusObstacles(round, columns = VERSUS_COLUMNS, rows = VERSUS_ROWS, seats = MAX_SEATS) {
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

  const zone = spawnZone(columns, rows, seats)
  const cells = []
  const keep = cell => {
    if (cell.x < 0 || cell.x >= columns || cell.y < 0 || cell.y >= rows) return false
    if (has(zone, cell)) return false
    return !has(cells, cell)
  }
  // With two on the board a half turn is enough to make the two halves equal.
  // With more than two the top and bottom have to match as well, or the seats
  // on one row get a different board from the seats on the other.
  const copies = seats > 2 ? SEAT_PLACEMENT : SEAT_PLACEMENT.slice(0, 2)
  for (const cell of half) {
    for (const place of copies) {
      const copy = place(cell, columns, rows)
      if (keep(copy)) cells.push(copy)
    }
  }
  return cells
}

// --- the model ---------------------------------------------------------------

function makePlayer(seat) {
  return {
    seat,
    // A seat nobody is sitting in is on the board's books and on nothing else:
    // not drawn, not collided with, not counted when a round is decided.
    present: seat < MIN_SEATS,
    snake: [],
    direction: spawnDirection(seat),
    turnQueue: [],
    // Four faces as far apart as the roster allows, so a match nobody chose
    // anything for still has snakes that can be told apart.
    head: DEFAULT_HEADS[seat % DEFAULT_HEADS.length],
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
    winsNeeded = WINS_NEEDED,
    present = null
  } = {}) {
    this.random = random
    this.columns = columns
    this.rows = rows
    this.wrap = wrap
    this.winsNeeded = winsNeeded
    this.listeners = new Map()

    this.players = [makePlayer(0), makePlayer(1), makePlayer(2), makePlayer(3)]
    if (present) this.setPresent(present)
    // What has been bitten off somebody. It lies where it fell and anybody can
    // eat it, which is what makes taking a chunk out of a rival worth doing
    // rather than merely rude.
    this.scraps = []
    this.obstacles = []
    this.scraps = []
    this.food = { ...NOWHERE }
    this.phase = PHASE_LOBBY
    this.phaseMs = 0
    this.round = 0
    this.tickNumber = 0
    this.apples = 0
    this.roundWinner = null
    this.matchWinner = null
    // How much of a board step has gone by. It lives on the model so that the
    // room and the browser drive a match the same way: one `step(ms)` call.
    this.accumulator = 0
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

  // Who is actually playing. Seats are 0 to 3 and stay where they are; this is
  // what says which of them are occupied, so a seat number means the same
  // thing to the room, the board and the person sitting in it.
  setPresent(present) {
    this.players.forEach((player, seat) => { player.present = !!present[seat] })
  }

  get seated() {
    return this.players.filter(player => player.present)
  }

  get alive() {
    return this.players.filter(player => player.present && player.alive)
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
    return this.seated.reduce((total, player) => total + player.score, 0)
  }

  isObstacle(p) {
    return has(this.obstacles, p)
  }

  occupied(p) {
    if (this.isObstacle(p)) return true
    if (has(this.scraps, p)) return true
    return this.players.some(player => player.present && has(player.snake, p))
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
    this.obstacles = versusObstacles(this.round, this.columns, this.rows, this.seated.length)
    this.scraps = []

    this.players.forEach((player, seat) => {
      player.snake = player.present ? spawnFor(seat, this.columns, this.rows) : []
      player.direction = spawnDirection(seat)
      player.turnQueue = []
      player.score = 0
      player.alive = player.present
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
    if (!player || !player.present || !player.alive) return false
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

  // How soon this wants to be stepped again.
  get pace() {
    return this.phase === PHASE_PLAYING
      ? Math.max(10, this.tickInterval - this.accumulator)
      : 100
  }

  // One call does everything: the phases that pass on their own, and the board
  // steps due since last time. `Race` presents the same method, so nothing
  // driving a match has to know which of the two it has.
  step(ms) {
    this.advance(ms)
    if (this.phase !== PHASE_PLAYING) {
      this.accumulator = 0
      return
    }
    this.accumulator += ms
    let steps = 0
    while (this.accumulator >= this.tickInterval && steps++ < 5 && this.phase === PHASE_PLAYING) {
      this.accumulator -= this.tickInterval
      this.tick()
    }
  }

  // --- a board step ---

  tick() {
    if (this.phase !== PHASE_PLAYING) return
    if (++this.tickNumber > STALEMATE_TICKS) {
      for (const player of this.alive) {
        player.alive = false
        player.reason = "stalemate"
      }
      this.roundWinner = DRAW
      this.settleRound()
      return
    }

    // A snake that died last tick is off the board. It is left where it fell
    // for the frame that killed it — the round has to show whose fault it was
    // — and then it goes, because a body nobody can crash into but everybody
    // can see is worse than no body at all.
    for (const player of this.players) {
      if (player.present && !player.alive && player.snake.length) player.snake = []
    }

    const running = this.players.filter(player => player.present && player.alive)
    const heads = new Map()
    const offBoard = new Map()
    const eats = new Map()

    for (const player of running) {
      if (player.turnQueue.length) player.direction = player.turnQueue.shift()
      const head = point(player.snake[0].x + player.direction.x, player.snake[0].y + player.direction.y)
      let off = false
      if (head.x < 0 || head.x >= this.columns || head.y < 0 || head.y >= this.rows) {
        if (this.wrap) {
          head.x = (head.x + this.columns) % this.columns
          head.y = (head.y + this.rows) % this.rows
        } else off = true
      }
      heads.set(player, head)
      offBoard.set(player, off)
      // An apple, or a piece somebody bit off somebody else. Both grow you.
      eats.set(player, !off && (same(head, this.food) || has(this.scraps, head)))
    }

    // What each body will still be covering once it has moved. Dropping the
    // tail of a snake that is not growing is what makes following your own
    // tail — or somebody else's — legal, exactly as it is in single player.
    const bodies = new Map()
    for (const player of running) {
      bodies.set(player, player.snake.slice(0, player.snake.length - (eats.get(player) ? 0 : 1)))
    }

    const deaths = new Map()
    for (const player of running) {
      const head = heads.get(player)
      if (offBoard.get(player)) deaths.set(player, "wall")
      else if (this.isObstacle(head)) deaths.set(player, "wall")
      else if (has(bodies.get(player), head)) deaths.set(player, "self")
      // Two or more heads into the same cell is nobody's fault and nobody's
      // win. It is also the only way two of them can reach the apple on the
      // same tick, which is why the apple never has to be argued over.
      else if (running.some(other => other !== player && same(head, heads.get(other)))) {
        deaths.set(player, "head-on")
      }
      // Running into a rival is not fatal any more. It is a bite, and it is
      // resolved below, once everybody has moved.
    }

    let eaten = false
    for (const player of running) {
      const head = heads.get(player)
      if (deaths.has(player)) {
        // Left where it crashed rather than moved into the wall: the frame
        // that ends a snake should show what ended it.
        player.alive = false
        player.reason = deaths.get(player)
        player.crashAt = head
        this.emit("crashed", player.seat, head.x, head.y, player.reason)
        continue
      }
      player.snake.unshift(head)
      if (eats.get(player)) {
        const scrap = this.scraps.findIndex(cell => same(cell, head))
        if (scrap >= 0) this.scraps.splice(scrap, 1)
        else eaten = true
        ++player.score
        ++player.total
        ++this.apples
        this.emit("apple", player.seat, head.x, head.y)
      } else player.snake.pop()
    }

    this.resolveBites(running, deaths)

    // A round runs until one of them is left. With two on the board that is
    // the first death; with four it is the third.
    if (this.alive.length <= 1) {
      this.settleRound()
      return
    }
    if (eaten) this.spawnFood()
    this.emit("boardChanged")
  }

  // A snake whose head has landed in somebody else's body has bitten it, the
  // way a snake bites a boss: everything behind the bite comes off and lies
  // there to be eaten. Reaching far enough forward to leave a rival with
  // nothing but a head eats it outright — the same rule that finishes a boss,
  // and the only reason chasing anybody is worth the risk.
  //
  // Resolved after everybody has moved, so a bite is decided against where the
  // bodies ended up rather than where they set off from.
  resolveBites(running, deaths) {
    const bites = new Map()
    for (const biter of running) {
      if (deaths.has(biter)) continue
      const head = biter.snake[0]
      for (const victim of running) {
        if (victim === biter || deaths.has(victim)) continue
        const index = victim.snake.findIndex((cell, at) => at > 0 && same(cell, head))
        if (index <= 0) continue
        // Two mouthfuls out of one snake on one tick: the nearer the head, the
        // worse it is, and the worse one is what happens.
        const worst = bites.get(victim)
        if (!worst || index < worst.index) bites.set(victim, { index, biter })
      }
    }

    for (const [victim, { index, biter }] of bites) {
      // The cell the biter's head is on belongs to the biter now, so what
      // comes off is everything behind it.
      const cut = victim.snake.slice(index + 1)
      victim.snake = victim.snake.slice(0, index)
      for (const cell of cut) this.scraps.push({ ...cell })

      ++biter.score
      ++biter.total
      this.emit("bitten", biter.seat, victim.seat, cut.length)

      if (victim.snake.length < MINIMUM_LENGTH) {
        victim.alive = false
        victim.reason = "eaten"
        victim.crashAt = victim.snake[0] ? { ...victim.snake[0] } : null
        this.emit("eaten", victim.seat, biter.seat)
      }
    }
  }

  // Who took the round. The last one standing, or — when the last of them went
  // together — whoever had eaten the most, which is the one place racing for
  // the apple pays off directly.
  settleRound() {
    const standing = this.alive
    if (standing.length === 1) this.roundWinner = standing[0].seat
    else if (this.roundWinner !== DRAW) {
      const best = Math.max(...this.seated.map(player => player.score))
      const leaders = this.seated.filter(player => player.score === best)
      this.roundWinner = leaders.length === 1 ? leaders[0].seat : DRAW
    }
    this.endRound()
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

  // Back to waiting for people. An online room that loses a player throws its
  // match away rather than freezing it, and this is what the browser watching
  // that room pours in when the room says there is nothing to show.
  toLobby() {
    const kept = this.players.map(player => ({ head: player.head, present: player.present }))
    this.players = [makePlayer(0), makePlayer(1), makePlayer(2), makePlayer(3)]
    this.players.forEach((player, seat) => {
      player.head = kept[seat].head
      player.present = kept[seat].present
    })
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
      scraps: this.scraps.map(cell => this.indexOf(cell)),
      food: this.indexOf(this.food),
      roundWinner: this.roundWinner,
      matchWinner: this.matchWinner,
      seats: this.seated.length,
      players: this.players.map(player => ({
        present: player.present,
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
    this.scraps = (state.scraps || []).map(index => this.cellAt(index))
    this.food = this.cellAt(state.food)
    this.roundWinner = state.roundWinner
    this.matchWinner = state.matchWinner
    state.players.forEach((incoming, seat) => {
      const player = this.players[seat]
      player.present = incoming.present
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
