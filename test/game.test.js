// Model regression tests, ported from `tests/tst_omasnake.cpp` in the Qt
// version and extended where the browser port introduced its own risk.
//
//   npm test

import test from "node:test"
import assert from "node:assert/strict"

import {
  COLUMNS,
  ROWS,
  Game,
  beatGateCount,
  hasBeatGates,
  hasFoodFrenzy,
  hasReverseVenom,
  hasSnakeEater,
  isNeedlePassage,
  isTightPassage,
  levelForScore,
  nextFoodMultiplier,
  nextSnakeEaterStep,
  obstacleCells,
  pointsForLevel,
  qualifiesNearMiss,
  scoreAfterSnakeBite,
  scoreForLevel,
  SNAKE_EATER_REWARD
} from "../public/snake/Game.js"

// Node has no localStorage, and the built-in fallback is per-instance memory.
// Passing an explicit one keeps every test's best scores to itself.
const fresh = (options = {}) => {
  const memory = new Map()
  return new Game({
    store: {
      getItem: key => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, String(value))
    },
    ...options
  })
}

// Restarts until the food happens to land straight ahead of the head, which is
// how the original test drives a scripted meal without touching private state.
function gameWithFoodAhead(options = {}) {
  const game = fresh(options)
  for (let attempt = 0; attempt < 500; ++attempt) {
    game.setPartyMode(true)
    const head = game.snake[0]
    if (game.food.y === head.y && game.food.x > head.x) return game
    game.reset()
  }
  assert.fail("food never spawned ahead of the snake in 500 resets")
}

test("level thresholds", () => {
  assert.equal(levelForScore(0), 1)
  assert.equal(levelForScore(11), 1)
  assert.equal(levelForScore(12), 2)
  assert.equal(scoreForLevel(3), 24)
  assert.equal(pointsForLevel(10), 13)
})

test("obstacle layouts stay in bounds", () => {
  for (let level = 1; level < 80; ++level) {
    for (const cell of obstacleCells(level)) {
      assert.ok(cell.x >= 0 && cell.x < COLUMNS, `x ${cell.x} out of bounds on level ${level}`)
      assert.ok(cell.y >= 0 && cell.y < ROWS, `y ${cell.y} out of bounds on level ${level}`)
    }
  }
})

test("every layout leaves the spawn run clear", () => {
  // findSpawn falls back to a fixed cell when no clear run exists, which would
  // bury the snake in a wall on its first tick.
  for (let level = 2; level < 40; ++level) {
    const game = fresh()
    game.displayedLevel = level
    game.placeSnake()
    for (const cell of game.snake) assert.ok(!game.isObstacle(cell), `level ${level} spawns inside a wall`)
  }
})

test("starts playable", () => {
  const game = fresh()
  assert.equal(game.snake.length, 3)
  assert.ok(game.running)
  assert.ok(!game.gameOver)
  assert.equal(game.score, 0)
})

test("disco ball can be toggled", () => {
  const game = fresh()
  assert.ok(game.discoBall.x >= 0 && game.discoBall.x < COLUMNS)
  assert.ok(game.discoBall.y >= 0 && game.discoBall.y < ROWS)
  assert.notDeepEqual(game.food, game.discoBall)

  game.setDiscoBallEnabled(false)
  assert.equal(game.discoBall.x, -1)
  game.setDiscoBallEnabled(true)
  assert.ok(game.discoBall.x >= 0)
})

test("near miss requires vacating tail", () => {
  const snake = [{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 2 }]
  assert.ok(qualifiesNearMiss({ x: 2, y: 2 }, snake, false))
  assert.ok(!qualifiesNearMiss({ x: 3, y: 3 }, snake, false))
  assert.ok(!qualifiesNearMiss({ x: 2, y: 2 }, snake, true))
  assert.ok(!qualifiesNearMiss({ x: 2, y: 2 }, snake.slice(0, 3), false))
})

test("moving into the vacating tail is survivable", () => {
  const game = fresh()
  game.endlessMode = true
  game.reset()
  game.snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }]
  game.direction = { x: -1, y: 0 }
  game.food = { x: 20, y: 1 }
  game.discoBall = { x: 20, y: 2 }
  game.pendingGrowth = 0
  game.tick()
  assert.ok(!game.gameOver, "the tail had moved away; that is a legal cell")
  assert.deepEqual(game.snake[0], { x: 4, y: 5 })
})

test("party combo expires", () => {
  const game = gameWithFoodAhead()
  while (game.score === 0) game.tick()
  assert.equal(game.foodMultiplier, 2)
  assert.equal(game.comboProgress, 1)
  game.advanceCombo(1999)
  assert.equal(game.foodMultiplier, 2)
  assert.ok(game.comboProgress > 0)
  game.advanceCombo(1)
  assert.equal(game.foodMultiplier, 1)
  assert.equal(game.comboProgress, 0)
})

test("scored points become snake blocks", () => {
  const game = gameWithFoodAhead()
  while (game.score === 0) game.tick()
  assert.equal(game.snake.length, 4)
})

test("party combo caps at ten", () => {
  assert.equal(nextFoodMultiplier(1), 2)
  assert.equal(nextFoodMultiplier(9), 10)
  assert.equal(nextFoodMultiplier(10), 10)
  assert.equal(nextFoodMultiplier(99), 10)
})

test("party passage bonuses use board geometry", () => {
  const walls = [{ x: 4, y: 3 }, { x: 6, y: 3 }]
  assert.ok(isTightPassage({ x: 5, y: 3 }, walls, false))
  assert.ok(isNeedlePassage({ x: 5, y: 3 }, walls, false))
  assert.ok(!isNeedlePassage({ x: 5, y: 4 }, walls, false))
  assert.ok(isTightPassage({ x: 0, y: 5 }, [], false))
  assert.ok(!isTightPassage({ x: 0, y: 5 }, [], true))
})

test("snake eater hunts the tail and costs points", () => {
  assert.ok(!hasSnakeEater(3, false))
  assert.ok(hasSnakeEater(4, false))
  assert.ok(!hasSnakeEater(4, true))
  const snake = [{ x: 8, y: 5 }, { x: 7, y: 5 }, { x: 6, y: 5 }]
  const tail = snake[snake.length - 1]
  assert.deepEqual(nextSnakeEaterStep({ x: 2, y: 5 }, tail, [], snake, false), { x: 3, y: 5 })
  const obstacle = [{ x: 3, y: 5 }]
  assert.notDeepEqual(nextSnakeEaterStep({ x: 2, y: 5 }, tail, obstacle, snake, false), { x: 3, y: 5 })
  assert.equal(scoreAfterSnakeBite(5), 4)
  assert.equal(scoreAfterSnakeBite(0), 0)
  assert.equal(SNAKE_EATER_REWARD, 2)
})

test("party events unlock gradually", () => {
  assert.ok(!hasBeatGates(5))
  assert.ok(hasBeatGates(6))
  assert.equal(beatGateCount(5), 0)
  assert.equal(beatGateCount(6), 1)
  assert.equal(beatGateCount(9), 2)
  assert.equal(beatGateCount(12), 3)
  assert.equal(beatGateCount(15), 4)
  assert.ok(!hasReverseVenom(5))
  assert.ok(hasReverseVenom(6))
  assert.ok(!hasFoodFrenzy(7))
  assert.ok(hasFoodFrenzy(8))
})

test("solid borders end the run and wrapping borders do not", () => {
  const game = fresh()
  game.endlessMode = true
  game.wallsWrap = false // Explicit: the stored default is wrapping.
  game.reset()
  game.snake = [{ x: COLUMNS - 1, y: 5 }, { x: COLUMNS - 2, y: 5 }, { x: COLUMNS - 3, y: 5 }]
  game.direction = { x: 1, y: 0 }
  game.food = { x: 2, y: 12 }
  game.tick()
  assert.ok(game.gameOver)

  game.wallsWrap = true
  game.reset()
  game.snake = [{ x: COLUMNS - 1, y: 5 }, { x: COLUMNS - 2, y: 5 }, { x: COLUMNS - 3, y: 5 }]
  game.direction = { x: 1, y: 0 }
  game.food = { x: 2, y: 12 }
  game.tick()
  assert.ok(!game.gameOver)
  assert.deepEqual(game.snake[0], { x: 0, y: 5 })
})

test("a reversal is refused and two turns may be queued", () => {
  const game = fresh()
  game.direction = { x: 1, y: 0 }
  game.turnQueue = []
  game.turn(-1, 0)
  assert.equal(game.turnQueue.length, 0, "no snake turns straight back into itself")
  game.turn(0, 1)
  game.turn(-1, 0)
  assert.equal(game.turnQueue.length, 2)
  game.turn(0, -1)
  assert.equal(game.turnQueue.length, 2, "the queue holds two turns and no more")
})

test("reverse venom rotates steering", () => {
  const game = fresh()
  game.direction = { x: 1, y: 0 }
  game.turnQueue = []
  game.reverseVenomRemainingMs = 5000
  game.turn(-1, 0) // Left, rotated a quarter turn into up.
  assert.deepEqual(game.turnQueue[0], { x: 0, y: -1 })

  // Up rotates into the direction of travel, which is not a turn at all.
  game.turnQueue = []
  game.turn(0, -1)
  assert.equal(game.turnQueue.length, 0)
})

test("clearing a level starts a transition and the next level respawns", () => {
  const game = fresh()
  const cleared = []
  game.on("levelCompleted", level => cleared.push(level))
  game.awardPoints(pointsForLevel(1))
  assert.deepEqual(cleared, [1])
  assert.ok(game.levelTransition)
  assert.equal(game.completedLevel, 1)
  assert.equal(game.level, 2)

  game.prepareNextLevel()
  assert.equal(game.displayedLevel, 2)
  assert.equal(game.snake.length, 3)
  assert.ok(game.obstacles.length > 0, "level 2 introduces a layout")
  game.completeLevelTransition()
  assert.ok(!game.levelTransition)
})

test("endless mode holds one speed and levels quicken by cycle", () => {
  const game = fresh()
  assert.equal(game.tickInterval, 140)
  game.displayedLevel = 10
  assert.equal(game.tickInterval, 133)
  game.displayedLevel = 18
  assert.equal(game.tickInterval, 126)
  game.endlessMode = true
  assert.equal(game.tickInterval, 140)
})

test("borders wrap until told otherwise", () => {
  const memory = new Map()
  const store = {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value))
  }
  const first = new Game({ store })
  assert.ok(first.wallsWrap, "a first run wraps")

  first.toggleWallsWrap()
  assert.ok(!first.wallsWrap)
  // A stored "false" is a decision, and outlives the default.
  assert.ok(!new Game({ store }).wallsWrap, "solid borders survive a reload")
})

test("best scores are kept apart per mode and survive a reload", () => {
  const memory = new Map()
  const store = {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value))
  }
  const game = new Game({ store })
  game.score = 30
  game.finish()
  assert.equal(game.best, 30)

  game.endlessMode = true
  assert.equal(game.best, 0, "endless keeps its own best")
  game.score = 7
  game.finish()
  assert.equal(game.best, 7)

  const reloaded = new Game({ store })
  assert.equal(reloaded.best, 30)
  reloaded.endlessMode = true
  assert.equal(reloaded.best, 7)
})
