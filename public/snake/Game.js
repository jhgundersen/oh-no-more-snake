// Game rules, board state, level progression and the between-level state
// machine — a direct port of `src/gamemodel.cpp` from the Qt version of
// Omasnake (https://github.com/jhgundersen/omasnake).
//
// Nothing in this file touches the DOM, Canvas or Web Audio, for the same
// reason the original keeps its rules in C++ rather than QML: everything here
// is testable from Node with no browser in sight. Rendering lives in Draw.js,
// browser wiring in web.js.

import { FATALITIES, MERCY } from "./Bosses.js"

export const COLUMNS = 22
export const ROWS = 16

const POINTS_PER_LEVEL = 12

// Five levels to a set: four boards and then a duel. Levels are named for
// where they sit — 1.1 through 1.5, then 2.1 — so the shape of a run is
// legible without counting.
export const LEVELS_PER_SET = 5
export const setOf = level => Math.floor((Math.max(1, level) - 1) / LEVELS_PER_SET) + 1
export const positionInSet = level => ((Math.max(1, level) - 1) % LEVELS_PER_SET) + 1
export const isBossLevel = level => positionInSet(level) === LEVELS_PER_SET
export const bossNumber = level => (isBossLevel(level) ? setOf(level) : 0)
export const levelName = level => `${setOf(level)}.${positionInSet(level)}`

// Accepts a name a player would recognise ("3.2"), the same written with a
// dash, or a plain level number. Returns null for anything else, so a typo
// does nothing.
export function levelFromName(name) {
  const text = String(name ?? "").trim()
  const pair = /^(\d+)\s*[-:.]\s*(\d+)$/.exec(text)
  if (pair) {
    const set = Math.max(1, Number(pair[1]))
    const position = Math.min(LEVELS_PER_SET, Math.max(1, Number(pair[2])))
    return (set - 1) * LEVELS_PER_SET + position
  }
  const absolute = Number(text)
  return Number.isFinite(absolute) && absolute >= 1 ? Math.floor(absolute) : null
}

export function nextBossLevel(from) {
  let level = Math.max(1, Math.floor(from)) + 1
  while (!isBossLevel(level)) ++level
  return level
}

// How far into the run a level is, in sets. Everything that gets harder gets
// harder by this and nothing else.
const difficultyOf = level => setOf(level) - 1

// Which board a level shows, counting past the bosses and past 1-1, which is
// deliberately empty.
const layoutOrdinal = level => level - 2 - Math.floor((level - 1) / LEVELS_PER_SET)

export const BOSS_FIGHT = "fight"
export const BOSS_FINISH = "finish"
export const BOSS_FATALITY = "fatality"
// How close the snake's head has to get before the boss stops dawdling. It
// keeps hunting the tail either way: an earlier version had it turn to face
// the threat instead, which sounds right and plays terribly — a boss cannot
// turn towards something it is already next to, because the cell it would
// have to step into is the thing itself, so it sidles along beside you with
// its head pointed somewhere else.
const BOSS_ALERT_RANGE = 4
const FINISH_WINDOW_MS = 5000
const FATALITY_MS = 2400
// How long two snakes see stars after running into each other head-on, and how
// long the boss spends backing off afterwards.
const DIZZY_MS = 1100
// Once kicked a ball never stops: it rolls until something turns it round or
// it finds the net. It travels faster than a snake, which is what stops the
// snake simply dribbling it — at the same speed the head catches it every tick
// and steers it into the goal with no aim involved.
const BALL_SPEED = 2
export const GOAL_BONUS = 5
const BOSS_FLEE_TICKS = 8
const COMBO_DURATION_MS = 2000
const BEAT_WINDOW_MS = 190
const NEAR_MISS_WINDOW_MS = 900

// The tail is only bitten off a snake longer than this, so a minimum-length
// snake cannot be chewed out of existence.
const MINIMUM_BITEABLE_LENGTH = 3

export const NOWHERE = { x: -1, y: -1 }

const point = (x, y) => ({ x, y })
// Negating a zero gives a negative zero, which compares equal to zero but is
// not it — enough to make a stored direction vector fail a deep comparison.
const flip = value => (value === 0 ? 0 : -value)
const same = (a, b) => a.x === b.x && a.y === b.y
const has = (list, p) => list.some(cell => same(cell, p))

// ---------------------------------------------------------------------------
// Level progression
// ---------------------------------------------------------------------------

export function pointsForLevel(level) {
  return POINTS_PER_LEVEL + Math.floor(difficultyOf(level) / 2)
}

export function scoreForLevel(level) {
  let total = 0
  for (let current = 1; current < level; ++current) total += pointsForLevel(current)
  return total
}

export function levelForScore(score) {
  let result = 1
  while (score >= pointsForLevel(result)) score -= pointsForLevel(result++)
  return result
}

// ---------------------------------------------------------------------------
// Obstacle layouts
// ---------------------------------------------------------------------------

// Twelve boards, each drawn in four orientations, is forty-eight arrangements
// before anything repeats — and by then the gaps have closed and it does not
// look like the same board anyway.
const BASE_LAYOUTS = 12
const ORIENTATIONS = 4

const layoutCache = new Map()

const gapForLevel = level => Math.max(2, 4 - Math.floor(difficultyOf(level) / 3))

// Mirrored horizontally, vertically or both. A layout the player has learned
// comes back the other way round rather than identically.
function orient(cells, orientation) {
  if (!orientation) return cells
  return cells.map(cell => point(
    orientation & 1 ? COLUMNS - 1 - cell.x : cell.x,
    orientation & 2 ? ROWS - 1 - cell.y : cell.y
  ))
}

function baseLayout(kind, gap) {
  const cells = []
  const cx = Math.floor(COLUMNS / 2)
  const cy = Math.floor(ROWS / 2)
  const half = Math.floor(gap / 2)
  const hbar = (y, gapX, x0, x1) => {
    for (let x = x0; x <= x1; ++x) if (x < gapX || x >= gapX + gap) cells.push(point(x, y))
  }
  const vbar = (x, gapY, y0, y1) => {
    for (let y = y0; y <= y1; ++y) if (y < gapY || y >= gapY + gap) cells.push(point(x, y))
  }
  const block = (x0, y0, width, height) => {
    for (let x = x0; x < x0 + width; ++x)
      for (let y = y0; y < y0 + height; ++y)
        if (x >= 0 && x < COLUMNS && y >= 0 && y < ROWS) cells.push(point(x, y))
  }

  if (kind === 0) hbar(cy, cx - half, 2, COLUMNS - 3)
  else if (kind === 1) vbar(cx, cy - half, 2, ROWS - 3)
  else if (kind === 2) {
    hbar(Math.floor(ROWS / 3), 2, 2, COLUMNS - 3)
    hbar(Math.floor((ROWS * 2) / 3), COLUMNS - 2 - gap, 2, COLUMNS - 3)
  } else if (kind === 3) {
    hbar(cy, cx - half, 2, COLUMNS - 3)
    vbar(cx, cy - half, 2, ROWS - 3)
  } else if (kind === 4) {
    const y0 = 2, y1 = ROWS - 3, x0 = 3, x1 = COLUMNS - 4
    for (let x = x0; x <= x1; ++x) cells.push(point(x, y0), point(x, y1))
    for (let y = y0 + 1; y < y1; ++y) {
      cells.push(point(x0, y))
      if (y < y1 - gap) cells.push(point(x1, y))
    }
  } else if (kind === 5) {
    for (let i = 0; i < 6; ++i)
      cells.push(point(3 + i, 3 + i), point(COLUMNS - 4 - i, ROWS - 4 - i))
  } else if (kind === 6) {
    for (let x = 3; x <= COLUMNS - 4; x += 3)
      for (let y = 2; y <= ROWS - 3; y += 3) if ((x + y) % 2 === 0) cells.push(point(x, y))
  } else if (kind === 7) {
    hbar(4, 2, 2, 8)
    hbar(ROWS - 5, COLUMNS - 9, 7, COLUMNS - 3)
  } else if (kind === 8) {
    // Blocks in the corners and one in the middle: open, but never straight.
    block(3, 2, 3, 2)
    block(COLUMNS - 6, 2, 3, 2)
    block(3, ROWS - 4, 3, 2)
    block(COLUMNS - 6, ROWS - 4, 3, 2)
    block(cx - 1, cy - 1, 3, 2)
  } else if (kind === 9) {
    // A room with one way in.
    const x0 = 5, x1 = COLUMNS - 6, y0 = 4, y1 = ROWS - 5
    const doorway = cx - half
    for (let x = x0; x <= x1; ++x) {
      if (x < doorway || x >= doorway + gap) cells.push(point(x, y0))
      cells.push(point(x, y1))
    }
    for (let y = y0 + 1; y < y1; ++y) cells.push(point(x0, y), point(x1, y))
  } else if (kind === 10) {
    // A staircase, which is a diagonal you cannot cut.
    for (let i = 0; i < 4; ++i) {
      const x = 3 + i * 5
      const y = 3 + i * 3
      for (let k = 0; k < 4 && x + k <= COLUMNS - 3; ++k) cells.push(point(x + k, y))
      if (y + 1 <= ROWS - 3) cells.push(point(x, y + 1))
    }
  } else {
    // Three uprights with their gaps at different heights.
    vbar(4, 2, 2, ROWS - 3)
    vbar(cx, cy - half, 2, ROWS - 3)
    vbar(COLUMNS - 5, ROWS - 3 - gap, 2, ROWS - 3)
  }
  return cells
}

// The returned array is cached and shared: treat it as read-only.
export function obstacleCells(level) {
  const cached = layoutCache.get(level)
  if (cached) return cached

  // 1-1 is empty on purpose, and a duel is fought in a clear arena.
  const cells = level <= 1 || isBossLevel(level)
    ? []
    : orient(
      baseLayout(layoutOrdinal(level) % BASE_LAYOUTS, gapForLevel(level)),
      Math.floor(layoutOrdinal(level) / BASE_LAYOUTS) % ORIENTATIONS
    )

  layoutCache.set(level, cells)
  return cells
}

// ---------------------------------------------------------------------------
// Party Mode geometry and unlocks
// ---------------------------------------------------------------------------

// A Tailgate is only a Tailgate when the tail actually vacates the cell this
// tick, which growing prevents.
export function qualifiesNearMiss(head, snake, eats) {
  return !eats && snake.length > 3 && same(head, snake[snake.length - 1])
}

export function nextFoodMultiplier(current) {
  return Math.min(10, Math.max(1, current) + 1)
}

const blockedBy = (cell, obstacles, wrap) => {
  const outside = cell.x < 0 || cell.x >= COLUMNS || cell.y < 0 || cell.y >= ROWS
  return (outside && !wrap) || has(obstacles, cell)
}

export function isTightPassage(p, obstacles, wrap) {
  return blockedBy(point(p.x + 1, p.y), obstacles, wrap)
    || blockedBy(point(p.x - 1, p.y), obstacles, wrap)
    || blockedBy(point(p.x, p.y + 1), obstacles, wrap)
    || blockedBy(point(p.x, p.y - 1), obstacles, wrap)
}

export function isNeedlePassage(p, obstacles, wrap) {
  const squeezedHorizontally = blockedBy(point(p.x - 1, p.y), obstacles, wrap)
    && blockedBy(point(p.x + 1, p.y), obstacles, wrap)
  const squeezedVertically = blockedBy(point(p.x, p.y - 1), obstacles, wrap)
    && blockedBy(point(p.x, p.y + 1), obstacles, wrap)
  return squeezedHorizontally || squeezedVertically
}

export const SNAKE_EATER_REWARD = 2
export const scoreAfterSnakeBite = score => Math.max(0, score - 1)
export const hasSnakeEater = (level, endless) => !endless && level >= 4
export const hasReverseVenom = level => level >= 6
export const hasFoodFrenzy = level => level >= 8

// A ball and a goal turn up from the third set, on boards rather than in
// arenas — a duel has enough going on.
export const hasBall = level => !isBossLevel(level) && setOf(level) >= 3

// Greedy one-step chase towards the tail. It never enters an obstacle or the
// snake's body, but the target cell itself is always fair game — that is the
// bite.
export function nextSnakeEaterStep(enemy, target, obstacles, snake, wrap) {
  const directions = [point(1, 0), point(-1, 0), point(0, 1), point(0, -1)]
  let best = enemy
  let bestDistance = Infinity
  for (const direction of directions) {
    const candidate = point(enemy.x + direction.x, enemy.y + direction.y)
    if (wrap) {
      candidate.x = (candidate.x + COLUMNS) % COLUMNS
      candidate.y = (candidate.y + ROWS) % ROWS
    } else if (candidate.x < 0 || candidate.x >= COLUMNS || candidate.y < 0 || candidate.y >= ROWS) {
      continue
    }
    if (has(obstacles, candidate)) continue
    if (has(snake, candidate) && !same(candidate, target)) continue
    const dx = Math.abs(candidate.x - target.x)
    const dy = Math.abs(candidate.y - target.y)
    const distance = wrap
      ? Math.min(dx, COLUMNS - dx) + Math.min(dy, ROWS - dy)
      : dx + dy
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// The duel
// ---------------------------------------------------------------------------

// A boss is longer every time, up to a length that already fills most of a row.
export const bossLength = number => Math.min(16, 6 + Math.max(1, number) * 2)

const DIRECTION_NAMES = new Map([
  ["0,-1", "up"],
  ["0,1", "down"],
  ["-1,0", "left"],
  ["1,0", "right"]
])

export const directionName = (dx, dy) => DIRECTION_NAMES.get(`${dx},${dy}`) || null

// Matched against the end of what was pressed, so a fumbled start costs
// nothing — only the last four inputs have to be right.
export function matchFatality(inputs) {
  for (const fatality of FATALITIES) {
    const tail = inputs.slice(-fatality.keys.length)
    if (tail.length === fatality.keys.length && tail.every((key, i) => key === fatality.keys[i]))
      return fatality
  }
  return null
}

export function boardDistanceBetween(a, b, wrap) {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  return wrap
    ? Math.min(dx, COLUMNS - dx) + Math.min(dy, ROWS - dy)
    : dx + dy
}

// Away from whatever it has just headbutted, for as long as it is still
// seeing stars about it. Same rules as a chase, opposite objective.
export function nextBossFleeStep(boss, from, blocked, wrap) {
  if (!boss.length) return null
  const neck = boss[1]
  const body = boss.slice(0, Math.max(0, boss.length - 1))
  let best = null
  let bestDistance = -Infinity
  for (const direction of [point(1, 0), point(-1, 0), point(0, 1), point(0, -1)]) {
    const candidate = point(boss[0].x + direction.x, boss[0].y + direction.y)
    if (wrap) {
      candidate.x = (candidate.x + COLUMNS) % COLUMNS
      candidate.y = (candidate.y + ROWS) % ROWS
    } else if (candidate.x < 0 || candidate.x >= COLUMNS || candidate.y < 0 || candidate.y >= ROWS) {
      continue
    }
    if (neck && same(candidate, neck)) continue
    if (has(body, candidate)) continue
    if (has(blocked, candidate)) continue
    const distance = boardDistanceBetween(candidate, from, wrap)
    if (distance > bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

// One step of the boss towards its target. It will not doubled back through
// its own neck, will not walk into a body, and holds still when boxed in
// rather than dying on the spot.
export function nextBossStep(boss, target, blocked, wrap) {
  if (!boss.length) return null
  const head = boss[0]
  const neck = boss[1]
  const body = boss.slice(0, Math.max(0, boss.length - 1))
  let best = null
  let bestDistance = Infinity
  for (const direction of [point(1, 0), point(-1, 0), point(0, 1), point(0, -1)]) {
    const candidate = point(head.x + direction.x, head.y + direction.y)
    if (wrap) {
      candidate.x = (candidate.x + COLUMNS) % COLUMNS
      candidate.y = (candidate.y + ROWS) % ROWS
    } else if (candidate.x < 0 || candidate.x >= COLUMNS || candidate.y < 0 || candidate.y >= ROWS) {
      continue
    }
    if (neck && same(candidate, neck)) continue
    if (has(body, candidate)) continue
    if (has(blocked, candidate)) continue
    const dx = Math.abs(candidate.x - target.x)
    const dy = Math.abs(candidate.y - target.y)
    const distance = wrap
      ? Math.min(dx, COLUMNS - dx) + Math.min(dy, ROWS - dy)
      : dx + dy
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

// QSettings on the desktop, localStorage here. Node has neither, so tests and
// tools fall back to a store that forgets everything.
function defaultStore() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.getItem("omasnake/probe")
      return localStorage
    }
  } catch {
    // Private windows and file:// origins can throw on access alone.
  }
  const memory = new Map()
  return {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value))
  }
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

export class Game {
  // `random` and `store` are injectable so tests can pin either one down.
  constructor({ random = Math.random, store = defaultStore() } = {}) {
    this.random = random
    this.store = store
    this.listeners = new Map()

    this.snake = []
    this.turnQueue = []
    this.direction = point(1, 0)
    this.food = { ...NOWHERE }
    this.discoBall = { ...NOWHERE }
    this.snakeEater = { ...NOWHERE }
    this.reverseVenom = { ...NOWHERE }
    this.frenzyPickup = { ...NOWHERE }
    this.frenzyFoods = []
    this.ball = { ...NOWHERE }
    this.ballDirection = { x: 0, y: 0 }
    this.goal = { ...NOWHERE }

    this.boss = []
    // Pieces bitten off the middle of a boss. They have no head, so they
    // wander, and every one of them is edible.
    this.husks = []
    this.bossPhase = "none"
    this.bossStartLength = 0
    this.bossPace = 0
    this.finishRemainingMs = 0
    this.fatalityRemainingMs = 0
    this.dizzyMs = 0
    this.bossFleeTicks = 0
    this.finisherInputs = []
    this.fatality = null

    this.score = 0
    this.bestLevels = 0
    this.bestEndless = 0
    this.elapsedSeconds = 0
    this.totalSeconds = 0
    this.foodStyleIndex = 0
    this.foodMultiplier = 1
    this.comboRemainingMs = 0
    this.pendingGrowth = 0
    this.beatWindowMs = 0
    this.nearMissWindowMs = 0
    this.bonusCooldownMs = 0
    this.tightTurnStreak = 0
    this.onBeatFoodStreak = 0
    this.danceTurnStreak = 0
    this.lastTurnSign = 0
    this.snakeEaterPhase = 0
    this.snakeEaterRespawnTicks = 0
    this.reverseVenomSpawnMs = 0
    this.reverseVenomRemainingMs = 0
    this.frenzySpawnMs = 0
    this.frenzyRemainingMs = 0
    this.running = false
    this.gameOver = false
    this.levelTransition = false
    this.completedLevel = 0
    this.displayedLevel = 1
    this.endlessMode = false
    this.wallsWrap = false
    this.discoBallEnabled = true
    this.partyMode = false
    // A run that was dropped onto a level did not earn its way there, so it
    // never counts: not for the best score, and not for the charts.
    this.practiceRun = false

    this.loadSettings()
    this.reset()
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

  get level() {
    if (this.endlessMode) return 1
    // A boss level is cleared by winning, not by scoring, so the level it
    // shows is pinned until the fight is over. Without this a lucky run of
    // apples mid-duel would start the next level on top of the boss.
    if (this.bossPhase !== "none") return this.displayedLevel
    return Math.max(this.displayedLevel, levelForScore(this.score))
  }

  get bossLevel() {
    return isBossLevel(this.displayedLevel)
  }

  // What is left of the boss, for the bar that is otherwise level progress.
  get bossHealth() {
    if (!this.bossStartLength) return 0
    return Math.max(0, (this.boss.length - 1) / Math.max(1, this.bossStartLength - 1))
  }

  findHusk(cell) {
    for (let husk = 0; husk < this.husks.length; ++husk) {
      const index = this.husks[husk].cells.findIndex(part => same(part, cell))
      if (index >= 0) return { husk, cell: index }
    }
    return null
  }

  get huskCells() {
    return this.husks.flatMap(husk => husk.cells)
  }

  boardDistance(a, b) {
    const dx = Math.abs(a.x - b.x)
    const dy = Math.abs(a.y - b.y)
    return this.wallsWrap
      ? Math.min(dx, COLUMNS - dx) + Math.min(dy, ROWS - dy)
      : dx + dy
  }

  // Whether it has noticed the thing creeping up on it, and whether that thing
  // is close enough to be worth turning round for.
  get bossThreat() {
    if (this.bossPhase !== BOSS_FIGHT || this.boss.length < 2 || !this.snake.length) return 0
    return this.boardDistance(this.boss[0], this.snake[0])
  }

  get bossAlert() {
    const threat = this.bossThreat
    return threat > 0 && threat <= BOSS_ALERT_RANGE
  }

  // Which way the boss is looking, taken from its own neck. Wrapping makes the
  // raw difference large, so a step across the edge is read as the step it is.
  get bossFacing() {
    if (this.boss.length < 2) return { x: -1, y: 0 }
    let dx = this.boss[0].x - this.boss[1].x
    let dy = this.boss[0].y - this.boss[1].y
    if (this.wallsWrap) {
      if (dx > 1) dx -= COLUMNS
      if (dx < -1) dx += COLUMNS
      if (dy > 1) dy -= ROWS
      if (dy < -1) dy += ROWS
    }
    return { x: Math.sign(dx), y: Math.sign(dy) }
  }

  // Going for the head is the fast way to win and the fast way to lose. Taken
  // from the side or from behind it is a kill; taken head-on it is a meal, and
  // which of the two it will be is written on its face.
  facesHeadOn(direction) {
    const facing = this.bossFacing
    return facing.x === -direction.x && facing.y === -direction.y
  }

  get bossTail() {
    return this.boss.length > 1 ? this.boss[this.boss.length - 1] : { ...NOWHERE }
  }

  get best() {
    return this.endlessMode ? this.bestEndless : this.bestLevels
  }

  get levelProgress() {
    if (this.endlessMode) return 1
    return Math.max(0, this.score - scoreForLevel(this.level)) / pointsForLevel(this.level)
  }

  // Endless keeps one speed. Levels quickens by a cycle, never past 55 ms.
  get tickInterval() {
    return this.endlessMode ? 140 : Math.max(55, 140 - difficultyOf(this.level) * 5)
  }

  get comboProgress() {
    return this.comboRemainingMs / COMBO_DURATION_MS
  }

  get reverseVenomActive() {
    return this.reverseVenomRemainingMs > 0
  }

  get foodFrenzyActive() {
    return this.frenzyRemainingMs > 0
  }

  get obstacles() {
    return this.endlessMode ? [] : obstacleCells(this.displayedLevel)
  }

  isObstacle(p) {
    return !this.endlessMode && has(obstacleCells(this.displayedLevel), p)
  }

  // --- spawning ---

  bounded(low, high) {
    return low + Math.floor(this.random() * (high - low))
  }

  pick(cells) {
    return cells.length ? cells[Math.floor(this.random() * cells.length)] : { ...NOWHERE }
  }

  // Every cell holding nothing at all. `except` drops one more occupant, which
  // is how food can respawn onto the cell a disco ball is being replaced on.
  freeCells(except = null) {
    const free = []
    for (let y = 0; y < ROWS; ++y) {
      for (let x = 0; x < COLUMNS; ++x) {
        const p = point(x, y)
        if (this.isObstacle(p) || has(this.snake, p) || has(this.boss, p)) continue
        if (this.husks.length && has(this.huskCells, p)) continue
        if (same(p, this.ball) || same(p, this.goal)) continue
        if (except !== "food" && same(p, this.food)) continue
        if (except !== "discoBall" && same(p, this.discoBall)) continue
        if (same(p, this.snakeEater) || same(p, this.reverseVenom) || same(p, this.frenzyPickup)) continue
        if (has(this.frenzyFoods, p)) continue
        free.push(p)
      }
    }
    return free
  }

  spawnFood() {
    const free = this.freeCells("food")
    if (!free.length) {
      this.finish()
      return
    }
    this.food = this.pick(free)
  }

  spawnDiscoBall() {
    if (!this.discoBallEnabled) {
      this.discoBall = { ...NOWHERE }
      return
    }
    this.discoBall = this.pick(this.freeCells("discoBall"))
  }

  randomFreeCell() {
    return this.pick(this.freeCells())
  }

  // The snake spawns three cells long facing right, as close to the middle row
  // as a clear run allows. Shorter runs are accepted before giving up.
  findSpawn() {
    const preferred = Math.floor(ROWS / 2)
    for (let run = 10; run >= 4; run -= 2) {
      for (let offset = 0; offset < ROWS; ++offset) {
        const y = preferred + (offset % 2 === 0 ? offset / 2 : -(offset + 1) / 2)
        if (y < 0 || y >= ROWS) continue
        for (let x = 2; x <= COLUMNS - run - 1; ++x) {
          let clear = true
          for (let k = 0; k < run; ++k) {
            if (this.isObstacle(point(x + k, y))) {
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

  placeSnake() {
    const start = this.findSpawn()
    this.snake = [point(start.x + 2, start.y), point(start.x + 1, start.y), point(start.x, start.y)]
    this.direction = point(1, 0)
    this.turnQueue = []
  }

  spawnSnakeEater() {
    // One enemy at a time. A boss level is the boss.
    if (this.bossLevel || !hasSnakeEater(this.displayedLevel, this.endlessMode) || !this.snake.length) {
      this.snakeEater = { ...NOWHERE }
      return
    }
    // It arrives as far from the tail as the board allows, so the first hunt is
    // a long one.
    const tail = this.snake[this.snake.length - 1]
    let free = []
    let farthest = -1
    for (let y = 0; y < ROWS; ++y) {
      for (let x = 0; x < COLUMNS; ++x) {
        const p = point(x, y)
        if (this.isObstacle(p) || has(this.snake, p) || same(p, this.food) || same(p, this.discoBall)) continue
        const distance = Math.abs(p.x - tail.x) + Math.abs(p.y - tail.y)
        if (distance > farthest) {
          free = []
          farthest = distance
        }
        if (distance === farthest) free.push(p)
      }
    }
    this.snakeEater = this.pick(free)
    this.snakeEaterPhase = 0
  }

  // The ball goes somewhere central-ish and the goal well away from it, so
  // there is a shot to line up rather than a tap-in.
  spawnBall() {
    this.ball = { ...NOWHERE }
    this.goal = { ...NOWHERE }
    this.ballDirection = { x: 0, y: 0 }
    if (this.endlessMode || !hasBall(this.displayedLevel)) return

    const free = this.freeCells()
    if (free.length < 2) return
    this.ball = free[Math.floor(this.random() * free.length)]
    const far = free.filter(cell => this.boardDistance(cell, this.ball) >= 8)
    const options = far.length ? far : free
    this.goal = options[Math.floor(this.random() * options.length)]
    if (same(this.goal, this.ball)) this.goal = { ...NOWHERE }
  }

  get ballRolling() {
    return this.ball.x >= 0 && (this.ballDirection.x !== 0 || this.ballDirection.y !== 0)
  }

  // Kicked in whatever direction the snake was going, which is the only way to
  // change where it is headed: catch it side-on and it turns.
  kickBall(direction) {
    this.ballDirection = { x: direction.x, y: direction.y }
    this.emit("ballKicked", this.ball.x, this.ball.y)
  }

  // Two cells a tick, stepped one at a time so a fast ball cannot jump a wall.
  // It never hurts anybody: the worst it does is come back at you.
  moveBall() {
    for (let step = 0; step < BALL_SPEED; ++step) if (!this.rollBall()) return
  }

  // Returns false when the step was spent turning round rather than moving.
  rollBall() {
    if (!this.ballRolling) return false
    const next = point(this.ball.x + this.ballDirection.x, this.ball.y + this.ballDirection.y)
    const offBoard = next.x < 0 || next.x >= COLUMNS || next.y < 0 || next.y >= ROWS
    if (offBoard && !this.wallsWrap) return this.bounceBall()
    if (offBoard) {
      next.x = (next.x + COLUMNS) % COLUMNS
      next.y = (next.y + ROWS) % ROWS
    }
    // The head is a boot, not a wall: stand in the ball's way and it leaves
    // the way you are going, which is how a rolling ball gets turned at all.
    if (this.snake.length && same(next, this.snake[0])) {
      this.kickBall(this.direction)
      return false
    }

    const inTheWay = this.isObstacle(next)
      || has(this.snake, next)
      || has(this.boss, next)
      || has(this.huskCells, next)
    if (inTheWay) return this.bounceBall()

    this.ball = next

    if (this.goal.x >= 0 && same(this.ball, this.goal)) {
      const at = { ...this.goal }
      this.ball = { ...NOWHERE }
      this.goal = { ...NOWHERE }
      this.ballDirection = { x: 0, y: 0 }
      this.awardPoints(GOAL_BONUS)
      this.emit("goalScored", at.x, at.y, GOAL_BONUS)
      return false
    }
    return true
  }

  // Nothing here moves diagonally, so every surface is square on and a bounce
  // is simply the way it came.
  bounceBall() {
    this.ballDirection = { x: flip(this.ballDirection.x), y: flip(this.ballDirection.y) }
    this.emit("ballBounced", this.ball.x, this.ball.y)
    return false
  }

  spawnBoss() {
    this.boss = []
    // Pieces bitten off the middle of a boss. They have no head, so they
    // wander, and every one of them is edible.
    this.husks = []
    this.bossPhase = "none"
    this.bossStartLength = 0
    this.bossPace = 0
    this.finishRemainingMs = 0
    this.fatalityRemainingMs = 0
    this.dizzyMs = 0
    this.bossFleeTicks = 0
    this.finisherInputs = []
    this.fatality = null
    if (!this.bossLevel || this.endlessMode) return

    // Laid out along a row of its own, near the top and facing left, with its
    // tail at the wall — the far end of the board from where the snake starts.
    const number = bossNumber(this.displayedLevel)
    const length = bossLength(number)
    const row = 2
    const tailX = COLUMNS - 3
    for (let i = 0; i < length; ++i) this.boss.push(point(tailX - (length - 1 - i), row))
    this.bossStartLength = length
    this.bossPhase = BOSS_FIGHT
    this.emit("bossArrived", number)
  }

  // The boss hunts the snake's tail exactly as the snake hunts the boss's,
  // until the snake gets close enough to be the more pressing problem.
  moveBoss() {
    if (this.bossPhase !== BOSS_FIGHT || this.boss.length < 2 || !this.snake.length) return
    if (this.dizzyMs > 0) return
    const alert = this.bossAlert
    const number = bossNumber(this.displayedLevel)
    ++this.bossPace

    // Slow bosses stop giving a tick back once something is at their neck, and
    // quick ones find an extra step. Standing still with a snake behind you is
    // what made walking up to one so easy.
    let steps = 1
    if (!alert && number <= 2 && this.bossPace % 3 === 0) steps = 0
    else if (alert && number > 2 && this.bossPace % 3 === 0) steps = 2

    for (let step = 0; step < steps; ++step) if (!this.stepBoss()) break
  }

  // One move. Returns false when there was nowhere to go or the run ended.
  stepBoss() {
    const tail = this.snake[this.snake.length - 1]
    // It eats from the tail and only from the tail. The rest of the snake,
    // head included, is something to go around — otherwise moving in to bite
    // its head is fatal by construction: the boss gets a move after yours, and
    // stepping onto your head would usually be its shortest way to your tail.
    const blocked = [...this.snake.slice(0, Math.max(0, this.snake.length - 1)), ...this.huskCells]
    // Still shaking it off: it wants distance rather than dinner.
    const step = this.bossFleeTicks > 0
      ? nextBossFleeStep(this.boss, this.snake[0], blocked, this.wallsWrap)
      : nextBossStep(this.boss, tail, blocked, this.wallsWrap)
    if (this.bossFleeTicks > 0) --this.bossFleeTicks
    if (!step) return false

    this.boss.unshift(step)
    // It never grows: the threat is losing your own length, not out-massing it.
    this.boss.pop()
    if (!same(step, tail)) return true

    // The last block is the head, so being eaten down to nothing ends here.
    if (this.snake.length <= 1) {
      this.emit("snakeBitten", step.x, step.y)
      this.emit("eatenByBoss", step.x, step.y)
      this.finish()
      return false
    }
    const bitten = this.snake.pop()
    this.score = scoreAfterSnakeBite(this.score)
    this.pendingGrowth = Math.max(0, this.pendingGrowth - 1)
    this.emit("snakeBitten", bitten.x, bitten.y)
    this.emit("scoreChanged")
    return true
  }

  biteBoss(head, index = this.boss.length - 1) {
    if (this.gameOver || this.boss.length < 2 || index <= 0) return
    const behind = this.boss.slice(index + 1)
    this.boss = this.boss.slice(0, index)
    if (behind.length) this.addHusk(behind)
    this.awardPoints(1)
    this.emit("bossBitten", head.x, head.y, this.boss.length, behind.length > 0)
    if (this.boss.length <= 1) this.beginFinish()
  }

  // Getting to the head ends the fight there and then: whatever was still
  // attached to it sloughs off, and the finish begins.
  takeBossHead(at) {
    if (this.gameOver || !this.boss.length) return
    const behind = this.boss.slice(1)
    this.boss = [this.boss[0]]
    if (behind.length) this.addHusk(behind)
    this.awardPoints(1)
    this.emit("bossBitten", at.x, at.y, 1, behind.length > 0)
    this.beginFinish()
  }

  // Both stop where they are; when it wears off the boss wants to be
  // somewhere else for a while, which is what separates them.
  collideHeads(at) {
    this.dizzyMs = DIZZY_MS
    this.bossFleeTicks = BOSS_FLEE_TICKS
    this.turnQueue = []
    this.emit("headsCollided", at.x, at.y)
    this.emit("statusChanged")
  }

  get dizzy() {
    return this.dizzyMs > 0
  }

  beginFinish() {
    this.bossPhase = BOSS_FINISH
    this.finishRemainingMs = FINISH_WINDOW_MS
    this.finisherInputs = []
    this.emit("bossFinishReady")
    this.emit("statusChanged")
  }

  addHusk(cells) {
    if (!cells.length) return
    this.husks.push({ cells, direction: this.randomDirection(), pace: 0 })
  }

  randomDirection() {
    const directions = [point(1, 0), point(-1, 0), point(0, 1), point(0, -1)]
    return directions[Math.floor(this.random() * directions.length)]
  }

  // A husk is all body, so any part of it can be taken, and taking a middle
  // one splits it again.
  biteHusk(head, huskIndex, cellIndex) {
    if (this.gameOver) return
    const husk = this.husks[huskIndex]
    const front = husk.cells.slice(0, cellIndex)
    const behind = husk.cells.slice(cellIndex + 1)
    this.husks.splice(huskIndex, 1)
    if (front.length) this.addHusk(front)
    if (behind.length) this.addHusk(behind)
    this.awardPoints(1)
    this.emit("bossBitten", head.x, head.y, this.boss.length, false)
  }

  // Headless and aimless: it keeps going until something is in the way, then
  // tries another direction. Half speed, so it reads as drifting.
  moveHusks() {
    if (!this.husks.length) return
    const solid = [...this.boss, ...this.snake]
    for (const husk of this.husks) {
      if (++husk.pace % 2 !== 0) continue
      const options = [husk.direction, ...this.shuffledDirections()]
      for (const direction of options) {
        const next = point(husk.cells[0].x + direction.x, husk.cells[0].y + direction.y)
        if (this.wallsWrap) {
          next.x = (next.x + COLUMNS) % COLUMNS
          next.y = (next.y + ROWS) % ROWS
        } else if (next.x < 0 || next.x >= COLUMNS || next.y < 0 || next.y >= ROWS) {
          continue
        }
        if (this.isObstacle(next) || has(solid, next)) continue
        if (has(husk.cells.slice(0, husk.cells.length - 1), next)) continue
        husk.direction = direction
        husk.cells.unshift(next)
        husk.cells.pop()
        break
      }
    }
  }

  shuffledDirections() {
    const directions = [point(1, 0), point(-1, 0), point(0, 1), point(0, -1)]
    for (let i = directions.length - 1; i > 0; --i) {
      const j = Math.floor(this.random() * (i + 1))
      const swap = directions[i]
      directions[i] = directions[j]
      directions[j] = swap
    }
    return directions
  }

  // A direction pressed while the boss is down is a finisher input, not
  // steering. Only the last few are kept, so a wrong start is recoverable.
  pressFinisher(dx, dy) {
    const name = directionName(dx, dy)
    if (!name) return
    this.finisherInputs.push(name)
    while (this.finisherInputs.length > 6) this.finisherInputs.shift()
    const fatality = matchFatality(this.finisherInputs)
    if (fatality) this.performFatality(fatality)
  }

  performFatality(fatality) {
    if (this.bossPhase !== BOSS_FINISH) return
    this.fatality = fatality
    this.bossPhase = BOSS_FATALITY
    this.fatalityRemainingMs = FATALITY_MS
    this.emit("bossFatality", fatality.name, fatality.flavour)
    this.emit("statusChanged")
  }

  // Clocks that only run during a duel: the window to finish it, and the
  // length of the finish itself.
  advanceBoss(milliseconds) {
    if (milliseconds <= 0) return
    if (this.dizzyMs > 0) {
      this.dizzyMs = Math.max(0, this.dizzyMs - milliseconds)
      if (this.dizzyMs === 0) this.emit("statusChanged")
      return
    }
    if (this.bossPhase === BOSS_FINISH) {
      this.finishRemainingMs = Math.max(0, this.finishRemainingMs - milliseconds)
      if (this.finishRemainingMs === 0) this.performFatality(MERCY)
      return
    }
    if (this.bossPhase === BOSS_FATALITY) {
      this.fatalityRemainingMs = Math.max(0, this.fatalityRemainingMs - milliseconds)
      if (this.fatalityRemainingMs === 0) this.defeatBoss()
    }
  }

  // Winning a boss level tops the score up to whatever the next level needs,
  // which is what starts the ordinary transition. Anything scored during the
  // fight is kept.
  defeatBoss() {
    const cleared = this.displayedLevel
    this.boss = []
    this.husks = []
    // Pieces bitten off the middle of a boss. They have no head, so they
    // wander, and every one of them is edible.
    this.husks = []
    this.bossPhase = "none"
    this.score = Math.max(this.score, scoreForLevel(cleared + 1))
    this.pendingGrowth = 0
    this.completedLevel = cleared
    this.levelTransition = true
    this.emit("bossDefeated", cleared)
    this.emit("levelCompleted", cleared)
    this.emit("scoreChanged")
    this.emit("statusChanged")
  }

  get finishProgress() {
    return this.finishRemainingMs / FINISH_WINDOW_MS
  }

  // Runs 0 to 1 across the finishing move, which is what the animation for it
  // is drawn from.
  get fatalityProgress() {
    return 1 - this.fatalityRemainingMs / FATALITY_MS
  }

  moveSnakeEater() {
    if (!hasSnakeEater(this.displayedLevel, this.endlessMode) || !this.snake.length) return
    if (this.snakeEater.x < 0) {
      if (this.snakeEaterRespawnTicks > 0) --this.snakeEaterRespawnTicks
      else this.spawnSnakeEater()
      return
    }
    // Half the snake's speed, so it is a threat rather than a death sentence.
    if (++this.snakeEaterPhase % 2 !== 0) return
    this.snakeEater = nextSnakeEaterStep(
      this.snakeEater,
      this.snake[this.snake.length - 1],
      obstacleCells(this.displayedLevel),
      this.snake,
      this.wallsWrap
    )
    if (same(this.snakeEater, this.snake[this.snake.length - 1]) && this.snake.length > MINIMUM_BITEABLE_LENGTH) {
      const bitten = this.snake.pop()
      this.score = scoreAfterSnakeBite(this.score)
      this.pendingGrowth = Math.max(0, this.pendingGrowth - 1)
      this.emit("snakeBitten", bitten.x, bitten.y)
      this.emit("scoreChanged")
    }
  }

  // --- party events ---

  resetPartyEvents() {
    this.frenzyFoods = []
    this.reverseVenom = { ...NOWHERE }
    this.frenzyPickup = { ...NOWHERE }
    this.reverseVenomRemainingMs = 0
    this.frenzyRemainingMs = 0
    this.reverseVenomSpawnMs = this.partyMode ? this.bounded(7000, 15001) : 0
    this.frenzySpawnMs = this.partyMode ? this.bounded(10000, 20001) : 0
    this.emit("partyEventChanged")
    this.emit("boardChanged")
  }

  startFoodFrenzy() {
    this.frenzyFoods = []
    for (let i = 0; i < 10; ++i) {
      const p = this.randomFreeCell()
      if (p.x >= 0) this.frenzyFoods.push(p)
    }
    this.frenzyRemainingMs = 8000
  }

  advancePartyEvents(ms) {
    // Gates, venom and frenzies would all be in the way of a duel that is
    // already about reading the board.
    if (this.bossLevel) return
    if (hasReverseVenom(this.displayedLevel)) {
      if (this.reverseVenomRemainingMs > 0) {
        this.reverseVenomRemainingMs = Math.max(0, this.reverseVenomRemainingMs - ms)
        if (this.reverseVenomRemainingMs === 0) this.reverseVenomSpawnMs = this.bounded(9000, 18001)
      } else if (this.reverseVenom.x < 0 && this.reverseVenomSpawnMs > 0) {
        this.reverseVenomSpawnMs = Math.max(0, this.reverseVenomSpawnMs - ms)
        if (this.reverseVenomSpawnMs === 0) this.reverseVenom = this.randomFreeCell()
      }
    }
    if (hasFoodFrenzy(this.displayedLevel)) {
      if (this.frenzyRemainingMs > 0) {
        this.frenzyRemainingMs = Math.max(0, this.frenzyRemainingMs - ms)
        if (this.frenzyRemainingMs === 0) {
          this.frenzyFoods = []
          this.frenzySpawnMs = this.bounded(12000, 24001)
        }
      } else if (this.frenzyPickup.x < 0 && this.frenzySpawnMs > 0) {
        this.frenzySpawnMs = Math.max(0, this.frenzySpawnMs - ms)
        if (this.frenzySpawnMs === 0) this.frenzyPickup = this.randomFreeCell()
      }
    }
    this.emit("partyEventChanged")
    this.emit("boardChanged")
  }

  // --- the loop ---

  reset() {
    this.practiceRun = false
    this.score = 0
    this.elapsedSeconds = 0
    this.gameOver = false
    this.levelTransition = false
    this.completedLevel = 0
    this.displayedLevel = 1
    this.running = true
    this.foodMultiplier = 1
    this.comboRemainingMs = 0
    this.pendingGrowth = 0
    this.beatWindowMs = 0
    this.nearMissWindowMs = 0
    this.bonusCooldownMs = 0
    this.tightTurnStreak = 0
    this.onBeatFoodStreak = 0
    this.danceTurnStreak = 0
    this.lastTurnSign = 0
    this.placeSnake()
    this.spawnBoss()
    this.spawnBall()
    this.spawnFood()
    this.spawnDiscoBall()
    this.spawnSnakeEater()
    this.resetPartyEvents()
    this.emit("boardChanged")
    this.emit("scoreChanged")
    this.emit("statusChanged")
    this.emit("timeChanged")
    this.emit("comboChanged")
    // A fresh run, which is the moment its clock should start.
    this.emit("runStarted")
  }

  tick() {
    if (!this.running || this.gameOver || this.levelTransition || !this.snake.length) return
    // Everything holds still while the boss is down and the finish is being
    // decided. That is the whole drama of it — and again, more briefly, while
    // the two of them are seeing stars.
    if (this.bossPhase === BOSS_FINISH || this.bossPhase === BOSS_FATALITY) return
    if (this.dizzyMs > 0) return

    const previousDirection = this.direction
    if (this.turnQueue.length) this.direction = this.turnQueue.shift()
    const turned = !same(this.direction, previousDirection)

    const head = point(this.snake[0].x + this.direction.x, this.snake[0].y + this.direction.y)
    if (head.x < 0 || head.x >= COLUMNS || head.y < 0 || head.y >= ROWS) {
      if (!this.wallsWrap) {
        this.finish()
        return
      }
      head.x = (head.x + COLUMNS) % COLUMNS
      head.y = (head.y + ROWS) % ROWS
    }

    const eats = same(head, this.food)
    // Any part of the boss is worth reaching. A bite through the middle cuts
    // it in two; reaching the head finishes the fight outright.
    const bossIndex = this.boss.findIndex(cell => same(cell, head))
    const bitesBoss = bossIndex > 0
    const meetsBossHead = bossIndex === 0
    const headButt = meetsBossHead && this.boss.length > 1 && this.facesHeadOn(this.direction)
    const takesBossHead = meetsBossHead && !headButt
    const huskHit = this.findHusk(head)
    const kicksBall = this.ball.x >= 0 && same(head, this.ball)
    const hitsDiscoBall = same(head, this.discoBall)
    const hitsSnakeEater = same(head, this.snakeEater)
    const hitsReverseVenom = same(head, this.reverseVenom)
    const hitsFrenzyPickup = same(head, this.frenzyPickup)
    const frenzyFoodIndex = this.frenzyFoods.findIndex(cell => same(cell, head))
    const growsThisTick = eats || this.pendingGrowth > 0
    const tailNearMiss = this.partyMode && qualifiesNearMiss(head, this.snake, growsThisTick)

    // Moving into the tail is legal when that tail moves away this tick.
    const collisionLength = this.snake.length - (growsThisTick ? 0 : 1)
    let hitsSelf = false
    for (let i = 0; i < collisionLength; ++i) {
      if (same(this.snake[i], head)) {
        hitsSelf = true
        break
      }
    }
    if (this.isObstacle(head) || hitsSelf) {
      this.finish()
      return
    }

    // Two snakes going for the same cell nose first. Nobody wins that, and
    // nobody dies of it either: they both see stars and back off.
    if (headButt) {
      this.collideHeads(head)
      return
    }

    this.snake.unshift(head)

    if (kicksBall) this.kickBall(this.direction)
    if (takesBossHead) this.takeBossHead(head)
    else if (bitesBoss) this.biteBoss(head, bossIndex)
    else if (huskHit) this.biteHusk(head, huskHit.husk, huskHit.cell)

    if (hitsSnakeEater) {
      this.snakeEater = { ...NOWHERE }
      this.snakeEaterRespawnTicks = 24
      this.awardPoints(SNAKE_EATER_REWARD)
      this.emit("snakeEaterDefeated", head.x, head.y)
    }
    if (hitsReverseVenom) {
      this.reverseVenom = { ...NOWHERE }
      this.reverseVenomRemainingMs = 5000
      this.emit("partyEvent", "REVERSE VENOM", head.x, head.y)
      this.emit("partyEventChanged")
    }
    if (hitsFrenzyPickup) {
      this.frenzyPickup = { ...NOWHERE }
      this.startFoodFrenzy()
      this.emit("partyEvent", "FOOD FRENZY", head.x, head.y)
      this.emit("partyEventChanged")
    }
    if (frenzyFoodIndex >= 0) {
      this.frenzyFoods.splice(frenzyFoodIndex, 1)
      this.awardPoints(1)
      this.emit("foodEaten", head.x, head.y, 1)
    }

    if (this.partyMode && turned) {
      if (isTightPassage(head, this.obstacles, this.wallsWrap)) {
        if (++this.tightTurnStreak >= 3 && this.bonusCooldownMs === 0) {
          this.awardPartyBonus("CORNER CUTTING", 1, head)
          this.tightTurnStreak = 0
        }
      } else this.tightTurnStreak = 0

      // Alternating left/right turns landing inside the beat window is a dance.
      const turnSign = previousDirection.x * this.direction.y - previousDirection.y * this.direction.x
      if (this.beatWindowMs > 0 && turnSign === -this.lastTurnSign) ++this.danceTurnStreak
      else this.danceTurnStreak = this.beatWindowMs > 0 ? 1 : 0
      this.lastTurnSign = turnSign
      if (this.danceTurnStreak >= 4 && this.bonusCooldownMs === 0) {
        this.awardPartyBonus("DANCE FLOOR", 2, head)
        this.danceTurnStreak = 0
      }
    }
    if (this.partyMode && isNeedlePassage(head, this.obstacles, this.wallsWrap) && this.bonusCooldownMs === 0)
      this.awardPartyBonus("THREAD THE NEEDLE", 2, head)

    if (hitsDiscoBall) this.emit("discoBallEaten", head.x, head.y)

    if (eats) {
      const points = this.partyMode ? this.foodMultiplier : 1
      this.emit("foodEaten", head.x, head.y, points)
      this.awardPoints(points)
      if (this.partyMode) {
        if (this.nearMissWindowMs > 0) this.awardPartyBonus("SNAKE BYTE", 2, head)
        if (this.beatWindowMs > 0) {
          this.awardPartyBonus("BEAT EATER", 1, head)
          if (++this.onBeatFoodStreak >= 3) {
            this.awardPartyBonus("PERFECT TIMING", 3, head)
            this.onBeatFoodStreak = 0
          }
        } else this.onBeatFoodStreak = 0
        this.nearMissWindowMs = 0
        this.foodMultiplier = nextFoodMultiplier(this.foodMultiplier)
        this.comboRemainingMs = COMBO_DURATION_MS
        this.emit("comboChanged")
      }
      --this.pendingGrowth // This tick already added the first scored block.
      if (!this.levelTransition) this.spawnFood()
    } else {
      if (this.pendingGrowth > 0) --this.pendingGrowth
      else this.snake.pop()
      if (tailNearMiss) {
        this.awardPoints(1)
        this.nearMissWindowMs = NEAR_MISS_WINDOW_MS
        this.emit("nearMiss", head.x, head.y)
      }
    }

    if (!this.levelTransition) {
      this.moveSnakeEater()
      this.moveBoss()
      this.moveHusks()
      this.moveBall()
    }
    this.emit("boardChanged")
  }

  awardPartyBonus(name, points, at) {
    this.awardPoints(points)
    this.emit("partyBonus", name, points, at.x, at.y)
    this.bonusCooldownMs = 240
  }

  // Every point scored is also a block the snake grows over the following
  // ticks, and the point that crosses a level boundary starts the transition.
  awardPoints(points) {
    const previousLevel = this.level
    this.score += points
    this.pendingGrowth += points
    if (this.level !== previousLevel) {
      this.completedLevel = previousLevel
      this.levelTransition = true
      this.emit("levelCompleted", previousLevel)
    }
    this.emit("scoreChanged")
    this.emit("statusChanged")
  }

  // Two turns may be queued, so a fast double tap around a corner survives a
  // tick boundary.
  turn(dx, dy) {
    if (Math.abs(dx) + Math.abs(dy) !== 1) return
    if (this.bossPhase === BOSS_FINISH) {
      this.pressFinisher(dx, dy)
      return
    }
    if (this.gameOver || !this.running || this.turnQueue.length >= 2) return
    if (this.reverseVenomRemainingMs > 0) {
      // A quarter turn clockwise. The `dy === 0` arm only exists to keep a
      // negative zero out of the queue, where it reads as a different vector.
      const steered = { x: dy === 0 ? 0 : -dy, y: dx }
      dx = steered.x
      dy = steered.y
    }
    const next = point(dx, dy)
    const last = this.turnQueue.length ? this.turnQueue[this.turnQueue.length - 1] : this.direction
    if (same(next, last) || same(next, point(-last.x, -last.y))) return
    this.turnQueue.push(next)
  }

  togglePause() {
    if (this.levelTransition) return
    if (this.gameOver) {
      this.reset()
      return
    }
    this.running = !this.running
    this.emit("statusChanged")
  }

  toggleMode() {
    if (this.levelTransition) return
    this.endlessMode = !this.endlessMode
    this.reset()
  }

  toggleWallsWrap() {
    this.wallsWrap = !this.wallsWrap
    this.saveSettings()
    this.emit("statusChanged")
  }

  cycleFoodStyle(count) {
    this.foodStyleIndex = (this.foodStyleIndex + 1) % Math.max(1, count)
    this.saveSettings()
    this.emit("foodStyleIndexChanged")
  }

  setFoodStyle(index, count) {
    this.foodStyleIndex = ((index % Math.max(1, count)) + Math.max(1, count)) % Math.max(1, count)
    this.saveSettings()
    this.emit("foodStyleIndexChanged")
  }

  setDiscoBallEnabled(enabled) {
    if (this.discoBallEnabled === enabled) return
    this.discoBallEnabled = enabled
    this.spawnDiscoBall()
    this.emit("boardChanged")
  }

  // The disco ball is the invitation to Party Mode, so it leaves once the party
  // has started.
  setPartyMode(enabled) {
    this.partyMode = enabled
    this.foodMultiplier = 1
    this.comboRemainingMs = 0
    this.beatWindowMs = 0
    this.nearMissWindowMs = 0
    this.bonusCooldownMs = 0
    this.tightTurnStreak = 0
    this.onBeatFoodStreak = 0
    this.danceTurnStreak = 0
    this.lastTurnSign = 0
    this.setDiscoBallEnabled(!enabled)
    this.resetPartyEvents()
    this.emit("comboChanged")
  }

  registerStrongBeat(strength) {
    if (this.partyMode && strength >= 0.35) this.beatWindowMs = BEAT_WINDOW_MS
  }

  advanceCombo(milliseconds) {
    if (!this.partyMode || milliseconds <= 0) return
    this.beatWindowMs = Math.max(0, this.beatWindowMs - milliseconds)
    this.nearMissWindowMs = Math.max(0, this.nearMissWindowMs - milliseconds)
    this.bonusCooldownMs = Math.max(0, this.bonusCooldownMs - milliseconds)
    this.advancePartyEvents(milliseconds)
    if (this.comboRemainingMs > 0) {
      this.comboRemainingMs = Math.max(0, this.comboRemainingMs - milliseconds)
      if (this.comboRemainingMs === 0) this.foodMultiplier = 1
      this.emit("comboChanged")
    }
  }

  advanceClock() {
    if (!this.running || this.gameOver || this.levelTransition) return
    ++this.elapsedSeconds
    ++this.totalSeconds
    this.emit("timeChanged")
  }

  completeLevelTransition() {
    if (!this.levelTransition) return
    this.levelTransition = false
    this.emit("statusChanged")
  }

  // Drops the run straight onto a level, for trying one out without playing
  // up to it. Nothing calls this during normal play, and web.js refuses to
  // send a run that used it to the charts.
  jumpToLevel(target) {
    if (this.endlessMode) return
    this.practiceRun = true
    this.score = scoreForLevel(target)
    this.displayedLevel = target
    this.gameOver = false
    this.running = true
    this.levelTransition = false
    this.completedLevel = 0
    this.elapsedSeconds = 0
    this.pendingGrowth = 0
    this.placeSnake()
    this.spawnBoss()
    this.spawnBall()
    this.spawnFood()
    this.spawnDiscoBall()
    this.spawnSnakeEater()
    this.resetPartyEvents()
    this.emit("boardChanged")
    this.emit("scoreChanged")
    this.emit("statusChanged")
    this.emit("runStarted")
  }

  // Called while the board is invisible, halfway through the level fade.
  prepareNextLevel() {
    if (!this.levelTransition) return
    this.displayedLevel = this.level
    this.placeSnake()
    this.spawnBoss()
    this.spawnBall()
    this.spawnFood()
    this.spawnDiscoBall()
    this.spawnSnakeEater()
    this.resetPartyEvents()
    this.emit("boardChanged")
  }

  finish() {
    this.gameOver = true
    this.running = false
    if (!this.practiceRun) {
      if (this.endlessMode) this.bestEndless = Math.max(this.bestEndless, this.score)
      else this.bestLevels = Math.max(this.bestLevels, this.score)
    }
    this.saveSettings()
    this.emit("statusChanged")
    this.emit("scoreChanged")
  }

  // --- settings ---

  loadSettings() {
    const number = (key, fallback) => {
      const raw = this.store.getItem(key)
      const value = Number(raw)
      return raw === null || Number.isNaN(value) ? fallback : value
    }
    this.bestLevels = number("omasnake/scores/levels", 0)
    this.bestEndless = number("omasnake/scores/endless", 0)
    this.totalSeconds = number("omasnake/play/totalSeconds", 0)
    this.foodStyleIndex = number("omasnake/appearance/foodStyle", 0)
    // Wrapping is the friendlier first run, and unlike the desktop version
    // this one is usually somebody's first. A stored "false" is still a
    // decision, so only the absence of one becomes a wrap.
    const wrap = this.store.getItem("omasnake/play/wrapBorders")
    this.wallsWrap = wrap === null ? true : wrap === "true"
  }

  saveSettings() {
    try {
      this.store.setItem("omasnake/scores/levels", this.bestLevels)
      this.store.setItem("omasnake/scores/endless", this.bestEndless)
      this.store.setItem("omasnake/play/totalSeconds", this.totalSeconds)
      this.store.setItem("omasnake/appearance/foodStyle", this.foodStyleIndex)
      this.store.setItem("omasnake/play/wrapBorders", String(this.wallsWrap))
    } catch {
      // A storage quota or a locked-down origin is not worth losing a run over.
    }
  }
}
