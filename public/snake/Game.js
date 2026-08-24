// Game rules, board state, level progression and the between-level state
// machine — a direct port of `src/gamemodel.cpp` from the Qt version of
// Omasnake (https://github.com/jhgundersen/omasnake).
//
// Nothing in this file touches the DOM, Canvas or Web Audio, for the same
// reason the original keeps its rules in C++ rather than QML: everything here
// is testable from Node with no browser in sight. Rendering lives in Draw.js,
// browser wiring in web.js.

export const COLUMNS = 22
export const ROWS = 16

const POINTS_PER_LEVEL = 12
const LAYOUTS_PER_CYCLE = 8
const COMBO_DURATION_MS = 2000
const BEAT_WINDOW_MS = 190
const NEAR_MISS_WINDOW_MS = 900

// The tail is only bitten off a snake longer than this, so a minimum-length
// snake cannot be chewed out of existence.
const MINIMUM_BITEABLE_LENGTH = 3

export const NOWHERE = { x: -1, y: -1 }

const point = (x, y) => ({ x, y })
const same = (a, b) => a.x === b.x && a.y === b.y
const has = (list, p) => list.some(cell => same(cell, p))

// ---------------------------------------------------------------------------
// Level progression
// ---------------------------------------------------------------------------

// Every eighth level the board gets one more apple to clear, one narrower gap,
// and one faster tick. `cycle` is how many full sets of layouts have passed.
const cycleOf = level => (level <= 1 ? 0 : Math.floor((level - 2) / LAYOUTS_PER_CYCLE))

export function pointsForLevel(level) {
  return POINTS_PER_LEVEL + cycleOf(level)
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

const layoutCache = new Map()

// Eight layouts that repeat, with the gaps closing by one cell per cycle. The
// returned array is cached and shared: treat it as read-only.
export function obstacleCells(level) {
  const cached = layoutCache.get(level)
  if (cached) return cached

  const cells = []
  if (level > 1) {
    const cx = Math.floor(COLUMNS / 2)
    const cy = Math.floor(ROWS / 2)
    const gap = Math.max(2, 4 - cycleOf(level))
    const kind = (level - 2) % LAYOUTS_PER_CYCLE
    const hbar = (y, gapX, x0, x1) => {
      for (let x = x0; x <= x1; ++x) if (x < gapX || x >= gapX + gap) cells.push(point(x, y))
    }
    const vbar = (x, gapY, y0, y1) => {
      for (let y = y0; y <= y1; ++y) if (y < gapY || y >= gapY + gap) cells.push(point(x, y))
    }
    const half = Math.floor(gap / 2)

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
    } else {
      hbar(4, 2, 2, 8)
      hbar(ROWS - 5, COLUMNS - 9, 7, COLUMNS - 3)
    }
  }

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
export const hasBeatGates = level => level >= 6
export const beatGateCount = level => (level < 6 ? 0 : Math.min(4, 1 + Math.floor((level - 6) / 3)))
export const hasReverseVenom = level => level >= 6
export const hasFoodFrenzy = level => level >= 8

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
    this.beatGates = []
    this.reverseVenom = { ...NOWHERE }
    this.frenzyPickup = { ...NOWHERE }
    this.frenzyFoods = []

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
    this.gateSpawnMs = 0
    this.gateLifetimeMs = 0
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
    return this.endlessMode ? 1 : Math.max(this.displayedLevel, levelForScore(this.score))
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
    return this.endlessMode ? 140 : Math.max(55, 140 - cycleOf(this.level) * 7)
  }

  get comboProgress() {
    return this.comboRemainingMs / COMBO_DURATION_MS
  }

  get beatGatesOpen() {
    return this.beatWindowMs > 0
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
        if (this.isObstacle(p) || has(this.snake, p)) continue
        if (except !== "food" && same(p, this.food)) continue
        if (except !== "discoBall" && same(p, this.discoBall)) continue
        if (same(p, this.snakeEater) || same(p, this.reverseVenom) || same(p, this.frenzyPickup)) continue
        if (has(this.beatGates, p) || has(this.frenzyFoods, p)) continue
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
    if (!hasSnakeEater(this.displayedLevel, this.endlessMode) || !this.snake.length) {
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
    this.beatGates = []
    this.frenzyFoods = []
    this.reverseVenom = { ...NOWHERE }
    this.frenzyPickup = { ...NOWHERE }
    this.gateLifetimeMs = 0
    this.reverseVenomRemainingMs = 0
    this.frenzyRemainingMs = 0
    this.gateSpawnMs = this.partyMode ? this.bounded(2500, 6501) : 0
    this.reverseVenomSpawnMs = this.partyMode ? this.bounded(7000, 15001) : 0
    this.frenzySpawnMs = this.partyMode ? this.bounded(10000, 20001) : 0
    this.emit("partyEventChanged")
    this.emit("boardChanged")
  }

  spawnBeatGates() {
    this.beatGates = []
    for (let i = 0; i < beatGateCount(this.displayedLevel); ++i) {
      const p = this.randomFreeCell()
      if (p.x >= 0) this.beatGates.push(p)
    }
    this.gateLifetimeMs = 10000
    if (this.beatGates.length)
      this.emit("partyEvent", "BEAT GATES", this.beatGates[0].x, this.beatGates[0].y)
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
    if (hasBeatGates(this.displayedLevel)) {
      if (this.gateLifetimeMs > 0) {
        this.gateLifetimeMs = Math.max(0, this.gateLifetimeMs - ms)
        if (this.gateLifetimeMs === 0) {
          this.beatGates = []
          this.gateSpawnMs = this.bounded(5000, 10001)
        }
      } else if (this.gateSpawnMs > 0) {
        this.gateSpawnMs = Math.max(0, this.gateSpawnMs - ms)
        if (this.gateSpawnMs === 0) this.spawnBeatGates()
      }
    }
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
    this.spawnFood()
    this.spawnDiscoBall()
    this.spawnSnakeEater()
    this.resetPartyEvents()
    this.emit("boardChanged")
    this.emit("scoreChanged")
    this.emit("statusChanged")
    this.emit("timeChanged")
    this.emit("comboChanged")
  }

  tick() {
    if (!this.running || this.gameOver || this.levelTransition || !this.snake.length) return

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
    if (this.isObstacle(head) || (!this.beatGatesOpen && has(this.beatGates, head)) || hitsSelf) {
      this.finish()
      return
    }

    this.snake.unshift(head)

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

    if (!this.levelTransition) this.moveSnakeEater()
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
    if (this.gameOver || !this.running || Math.abs(dx) + Math.abs(dy) !== 1 || this.turnQueue.length >= 2) return
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

  // Called while the board is invisible, halfway through the level fade.
  prepareNextLevel() {
    if (!this.levelTransition) return
    this.displayedLevel = this.level
    this.placeSnake()
    this.spawnFood()
    this.spawnDiscoBall()
    this.spawnSnakeEater()
    this.resetPartyEvents()
    this.emit("boardChanged")
  }

  finish() {
    this.gameOver = true
    this.running = false
    if (this.endlessMode) this.bestEndless = Math.max(this.bestEndless, this.score)
    else this.bestLevels = Math.max(this.bestLevels, this.score)
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
    this.wallsWrap = this.store.getItem("omasnake/play/wrapBorders") === "true"
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
