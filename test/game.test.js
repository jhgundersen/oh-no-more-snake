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
  GOAL_BONUS,
  bossLength,
  bossNumber,
  hasBall,
  levelFromName,
  levelName,
  positionInSet,
  setOf,
  directionName,
  isBossLevel,
  matchFatality,
  nextBossStep,
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
  // A level costs one more apple every second set.
  assert.equal(pointsForLevel(1), 12)
  assert.equal(pointsForLevel(5), 12)
  assert.equal(pointsForLevel(11), 13)
  assert.equal(pointsForLevel(21), 14)
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

test("endless mode holds one speed and levels quicken by set", () => {
  const game = fresh()
  assert.equal(game.tickInterval, 140)
  game.displayedLevel = 5 // still the first set, boss included
  assert.equal(game.tickInterval, 140)
  game.displayedLevel = 6 // 2-1
  assert.equal(game.tickInterval, 135)
  game.displayedLevel = 11 // 3-1
  assert.equal(game.tickInterval, 130)
  game.endlessMode = true
  assert.equal(game.tickInterval, 140)
})

test("levels are named for where they sit in their set", () => {
  assert.deepEqual([1, 4, 5, 6, 10, 11].map(levelName), ["1.1", "1.4", "1.5", "2.1", "2.5", "3.1"])
  assert.equal(setOf(7), 2)
  assert.equal(positionInSet(7), 2)
})

test("a level can be asked for by name", () => {
  // Written the way it is displayed, the way it used to be, or plainly.
  assert.equal(levelFromName("3.2"), 12)
  assert.equal(levelFromName("3-2"), 12)
  assert.equal(levelFromName("12"), 12)
  assert.equal(levelFromName("  4.3 "), 18)
  assert.equal(levelName(levelFromName("1.5")), "1.5")

  // A position past the end of a set is clamped rather than spilling over.
  assert.equal(levelFromName("2.9"), levelFromName("2.5"))

  // And nonsense is nothing at all, so a typo does nothing.
  for (const junk of ["banana", "", "-4", "0", null, undefined])
    assert.equal(levelFromName(junk), null, `accepted ${JSON.stringify(junk)}`)
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

// --- boss fights ------------------------------------------------------------

test("every fifth level is a duel", () => {
  assert.ok(!isBossLevel(1))
  assert.ok(!isBossLevel(4))
  assert.ok(isBossLevel(5))
  assert.ok(!isBossLevel(6))
  assert.ok(isBossLevel(10))
  assert.ok(isBossLevel(15))
  assert.equal(bossNumber(5), 1)
  assert.equal(bossNumber(10), 2)
  assert.equal(bossNumber(6), 0)
})

test("the boards keep changing for a long time", () => {
  // Twelve shapes in four orientations, and the gaps close on top of that.
  // What matters is that a player does not see the same board twice for ages.
  const seen = new Set()
  for (let level = 2; level <= 200; ++level) {
    if (isBossLevel(level)) continue
    seen.add(JSON.stringify(obstacleCells(level)))
  }
  assert.ok(seen.size >= 48, `only ${seen.size} distinct boards in the first 200 levels`)

  // And 1-1 is deliberately empty.
  assert.deepEqual(obstacleCells(1), [])
})

test("a boss arena is empty and a boss gets longer each time", () => {
  assert.deepEqual(obstacleCells(5), [])
  assert.deepEqual(obstacleCells(10), [])
  assert.equal(bossLength(1), 8)
  assert.equal(bossLength(2), 10)
  assert.ok(bossLength(99) <= 16, "and never longer than most of a row")
})

test("finisher inputs are read from the end of what was pressed", () => {
  assert.equal(directionName(0, -1), "up")
  assert.equal(directionName(1, 0), "right")
  assert.equal(directionName(0, 0), null)

  assert.equal(matchFatality(["up", "up", "down", "down"]).name, "KERNEL PANIC")
  // A fumbled start does not spoil the sequence that follows it.
  assert.equal(matchFatality(["left", "up", "up", "down", "down"]).name, "KERNEL PANIC")
  assert.equal(matchFatality(["up", "up", "down"]), null)
  assert.equal(matchFatality([]), null)
})

test("the boss steps towards its target without eating itself", () => {
  const boss = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }]
  // The target is to the left, and left is where it can go.
  assert.deepEqual(nextBossStep(boss, { x: 1, y: 5 }, [], false), { x: 4, y: 5 })
  // Its own neck is never a candidate, even when the target lies through it.
  assert.notDeepEqual(nextBossStep(boss, { x: 9, y: 5 }, [], false), { x: 6, y: 5 })
  // Boxed in on every side, it holds still rather than dying.
  const walled = [{ x: 4, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 6 }]
  assert.equal(nextBossStep(boss, { x: 1, y: 5 }, walled, false), null)
})

test("reaching the boss's head wins the fight outright", () => {
  const game = fresh()
  game.score = scoreForLevel(5)
  game.displayedLevel = 5
  game.prepareNextLevel = () => {}
  game.spawnBoss()
  assert.equal(game.bossPhase, "fight")
  assert.equal(game.boss.length, bossLength(1))
  assert.equal(game.bossHealth, 1)

  // Swim into its jaws on purpose: nothing about a boss is off limits now.
  const bossHead = game.boss[0]
  game.snake = [
    { x: bossHead.x, y: bossHead.y + 1 },
    { x: bossHead.x - 1, y: bossHead.y + 1 },
    { x: bossHead.x - 2, y: bossHead.y + 1 }
  ]
  game.direction = { x: 0, y: -1 }
  game.food = { x: 1, y: 14 }
  game.tick()

  assert.ok(!game.gameOver, "the boss cannot kill you by being touched")
  assert.equal(game.bossPhase, "finish")
  assert.equal(game.boss.length, 1)
  assert.equal(game.husks.length, 1, "everything behind the head comes away")
})

test("the boss eats you down, and the last block is the last block", () => {
  const game = fresh()
  game.displayedLevel = 5
  game.wallsWrap = false
  game.spawnBoss()
  // Boss head one step from the snake's tail, the snake pointing away.
  game.snake = [{ x: 10, y: 8 }, { x: 11, y: 8 }]
  game.boss = [{ x: 12, y: 8 }, { x: 13, y: 8 }]
  game.bossPace = 1 // the next move is a moving one
  game.moveBoss()
  assert.equal(game.snake.length, 1, "the tail goes, however short it already was")
  assert.ok(!game.gameOver)

  // One block left, and being alone is not what kills you — being reached is.
  game.boss = [{ x: 15, y: 2 }, { x: 16, y: 2 }]
  game.bossPace = 1
  game.moveBoss()
  assert.ok(!game.gameOver, "a boss on the far side of the board has not eaten you")

  // Nothing left but the head, and it takes that too.
  game.boss = [{ x: 11, y: 8 }, { x: 12, y: 8 }]
  game.bossPace = 1
  game.moveBoss()
  assert.ok(game.gameOver, "eaten down to nothing is a loss")
})

test("the boss goes around the head and takes the tail", () => {
  const game = fresh()
  game.displayedLevel = 5
  game.wallsWrap = false
  game.spawnBoss()
  // Its head sits beside the snake's head, with the snake's tail beyond.
  game.snake = [{ x: 10, y: 8 }, { x: 10, y: 9 }, { x: 10, y: 10 }, { x: 10, y: 11 }]
  game.boss = [{ x: 9, y: 8 }, { x: 8, y: 8 }]
  game.bossPace = 1
  game.moveBoss()
  assert.ok(!game.gameOver, "a snake with body left cannot be killed by a head-on")
  assert.notDeepEqual(game.boss[0], { x: 10, y: 8 }, "and the head is not somewhere it may step")
})

test("the head is taken from the side; head-on just bounces", () => {
  const setup = () => {
    const game = fresh()
    game.score = scoreForLevel(5)
    game.displayedLevel = 5
    game.wallsWrap = false
    game.prepareNextLevel = () => {}
    game.spawnBoss()
    // Facing left, along a row, and it holds still for the tick being tested.
    game.boss = [{ x: 10, y: 8 }, { x: 11, y: 8 }, { x: 12, y: 8 }, { x: 13, y: 8 }]
    game.bossPace = 2 // the next move is a skipped one
    game.food = { x: 2, y: 14 }
    return game
  }

  // Nose to nose: nobody wins and nobody dies.
  const headOn = setup()
  assert.deepEqual(headOn.bossFacing, { x: -1, y: 0 })
  headOn.snake = [{ x: 9, y: 8 }, { x: 8, y: 8 }, { x: 7, y: 8 }]
  headOn.direction = { x: 1, y: 0 }
  headOn.tick()
  assert.ok(!headOn.gameOver, "a headbutt is not fatal")
  assert.ok(headOn.dizzy, "it is stunning")
  assert.equal(headOn.bossPhase, "fight", "and it wins nothing")
  assert.deepEqual(headOn.snake[0], { x: 9, y: 8 }, "the move is cancelled")

  // The same head, reached from underneath.
  const fromBelow = setup()
  fromBelow.snake = [{ x: 10, y: 9 }, { x: 10, y: 10 }, { x: 10, y: 11 }]
  fromBelow.direction = { x: 0, y: -1 }
  fromBelow.tick()
  assert.ok(!fromBelow.gameOver)
  assert.equal(fromBelow.bossPhase, "finish", "it never saw you coming")
})

test("a headbutt separates them instead of ending anything", () => {
  const game = fresh()
  game.score = scoreForLevel(5)
  game.displayedLevel = 5
  game.wallsWrap = false
  game.prepareNextLevel = () => {}
  game.spawnBoss()
  game.boss = [{ x: 10, y: 8 }, { x: 11, y: 8 }, { x: 12, y: 8 }, { x: 13, y: 8 }]
  game.bossPace = 2
  game.snake = [{ x: 9, y: 8 }, { x: 8, y: 8 }, { x: 7, y: 8 }]
  game.direction = { x: 1, y: 0 }
  game.food = { x: 2, y: 14 }
  let bumped = null
  game.on("headsCollided", (x, y) => (bumped = { x, y }))

  game.tick()
  assert.deepEqual(bumped, { x: 10, y: 8 })

  // Nothing moves while they are seeing stars.
  const held = { snake: { ...game.snake[0] }, boss: { ...game.boss[0] } }
  game.tick()
  assert.deepEqual(game.snake[0], held.snake)
  assert.deepEqual(game.boss[0], held.boss)

  game.advanceBoss(1200)
  assert.ok(!game.dizzy)

  // And then it wants to be somewhere else.
  game.turn(0, 1)
  const apart = []
  for (let i = 0; i < 5; ++i) {
    game.tick()
    apart.push(game.boardDistance(game.boss[0], game.snake[0]))
  }
  assert.ok(apart[apart.length - 1] > apart[0], `expected them to separate, got ${apart}`)
  assert.ok(!game.gameOver)
})

test("a bite through the middle cuts the boss in two", () => {
  const game = fresh()
  game.displayedLevel = 5
  game.spawnBoss()
  const length = game.boss.length
  const middle = 3

  game.biteBoss(game.boss[middle], middle)
  assert.equal(game.boss.length, middle, "the head keeps what was in front of the bite")
  assert.equal(game.husks.length, 1)
  assert.equal(game.husks[0].cells.length, length - middle - 1, "and the rest is left behind")
  assert.equal(game.bossPhase, "fight")

  // Biting a husk in the middle splits that too.
  game.biteHusk({ x: 0, y: 0 }, 0, 1)
  assert.equal(game.husks.length, 2)
  // Biting the last cell of a one-cell husk removes it entirely.
  const single = game.husks.findIndex(husk => husk.cells.length === 1)
  if (single >= 0) {
    game.biteHusk({ x: 0, y: 0 }, single, 0)
    assert.ok(!game.husks.some(husk => husk.cells.length === 0), "nothing empty is kept")
  }
})

test("a husk drifts, and never through the boss or the snake", () => {
  const game = fresh()
  game.displayedLevel = 10
  game.endlessMode = false
  game.boss = [{ x: 5, y: 5 }, { x: 6, y: 5 }]
  game.snake = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]
  game.husks = [{ cells: [{ x: 10, y: 10 }, { x: 11, y: 10 }], direction: { x: -1, y: 0 }, pace: 1 }]
  const before = JSON.stringify(game.husks[0].cells)
  game.moveHusks() // pace becomes 2: an even tick, so it drifts
  assert.notEqual(JSON.stringify(game.husks[0].cells), before)
  assert.equal(game.husks[0].cells.length, 2, "it does not grow or shrink by drifting")

  // Boxed in against the boss and solid walls, it holds its ground rather
  // than walking through either.
  game.wallsWrap = false
  game.husks = [{ cells: [{ x: 0, y: 0 }], direction: { x: -1, y: 0 }, pace: 1 }]
  game.boss = [{ x: 1, y: 0 }, { x: 2, y: 0 }]
  game.snake = [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }]
  game.moveHusks()
  assert.deepEqual(game.husks[0].cells, [{ x: 0, y: 0 }])

  // With wrapping borders the same corner is not a corner at all.
  game.wallsWrap = true
  game.husks[0].pace = 1
  game.moveHusks()
  assert.deepEqual(game.husks[0].cells, [{ x: COLUMNS - 1, y: 0 }])
})

test("eating the boss down to its head calls for a finish, and winning clears the level", () => {
  const game = fresh()
  game.score = scoreForLevel(5)
  game.displayedLevel = 5
  game.spawnBoss()
  const cleared = []
  game.on("levelCompleted", level => cleared.push(level))

  // Take it apart from the tail without simulating the chase.
  while (game.boss.length > 1) game.biteBoss(game.boss[game.boss.length - 1])
  assert.equal(game.bossPhase, "finish")
  assert.equal(game.finishProgress, 1)
  assert.ok(!game.levelTransition, "the fight is not over until it is finished")

  // Steering is finisher input now, not steering.
  const before = game.turnQueue.length
  for (const [dx, dy] of [[0, -1], [0, -1], [0, 1], [0, 1]]) game.turn(dx, dy)
  assert.equal(game.turnQueue.length, before)
  assert.equal(game.bossPhase, "fatality")
  assert.equal(game.fatality.name, "KERNEL PANIC")

  game.advanceBoss(2500)
  assert.equal(game.bossPhase, "none")
  assert.deepEqual(cleared, [5])
  assert.ok(game.levelTransition)
  assert.ok(game.score >= scoreForLevel(6), "the win pays for the level it cleared")
})

test("hesitating still finishes it, just worse", () => {
  const game = fresh()
  game.score = scoreForLevel(5)
  game.displayedLevel = 5
  game.spawnBoss()
  while (game.boss.length > 1) game.biteBoss(game.boss[game.boss.length - 1])
  game.advanceBoss(5000)
  assert.equal(game.fatality.name, "MERCY")
  assert.equal(game.bossPhase, "fatality")
})

test("a duel pins the level, so apples cannot end it early", () => {
  const game = fresh()
  game.score = scoreForLevel(5)
  game.displayedLevel = 5
  game.spawnBoss()
  game.awardPoints(40) // Far past what the next level would need.
  assert.equal(game.level, 5)
  assert.ok(!game.levelTransition, "only the boss ends a boss level")
})

test("a practice run counts for nothing", () => {
  const memory = new Map()
  const store = {
    getItem: key => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value))
  }
  const game = new Game({ store })
  game.jumpToLevel(5)
  assert.ok(game.practiceRun)
  assert.equal(game.displayedLevel, 5)
  assert.ok(game.boss.length > 1, "and lands in the fight")

  game.finish()
  assert.equal(game.best, 0, "a level it was dropped onto is not a best score")

  // A real run afterwards is a real run again.
  game.reset()
  assert.ok(!game.practiceRun)
  game.score = 40
  game.finish()
  assert.equal(game.best, 40)
})

test("the boss cannot be bitten after the run has ended", () => {
  const game = fresh()
  game.jumpToLevel(5)
  const length = game.boss.length
  game.finish()
  game.biteBoss(game.bossTail)
  assert.equal(game.boss.length, length)
  assert.equal(game.bossPhase, "fight", "and no finish is offered to a dead snake")
})

test("a boss with something at its neck stops dawdling", () => {
  const game = fresh()
  game.displayedLevel = 10 // the first boss, which normally skips every third tick
  game.wallsWrap = false
  game.spawnBoss()
  game.boss = [{ x: 10, y: 4 }, { x: 11, y: 4 }, { x: 12, y: 4 }]

  // Far away: the skipped tick is still skipped.
  game.snake = [{ x: 2, y: 14 }, { x: 1, y: 14 }, { x: 0, y: 14 }]
  assert.ok(!game.bossAlert)
  game.bossPace = 2
  const restingAt = { ...game.boss[0] }
  game.moveBoss()
  assert.deepEqual(game.boss[0], restingAt, "a boss with nothing behind it may dawdle")

  // Close up: every tick counts.
  game.snake = [{ x: 10, y: 6 }, { x: 10, y: 7 }, { x: 10, y: 8 }]
  assert.ok(game.bossAlert)
  game.bossPace = 2
  game.moveBoss()
  assert.notDeepEqual(game.boss[0], restingAt, "with a snake at its neck it does not")
})

test("a quick boss finds an extra step when threatened", () => {
  const game = fresh()
  game.displayedLevel = 15 // third boss: already moving every tick
  game.wallsWrap = false
  game.spawnBoss()
  game.boss = [{ x: 10, y: 4 }, { x: 11, y: 4 }, { x: 12, y: 4 }]
  game.snake = [{ x: 10, y: 6 }, { x: 10, y: 7 }, { x: 10, y: 8 }]
  const from = { ...game.boss[0] }
  game.bossPace = 2 // the tick that would have been skipped is a double instead
  game.moveBoss()
  assert.equal(game.boardDistance(from, game.boss[0]), 2, "two cells, not one")
})

// --- the ball and the goal ---------------------------------------------------

const pitch = () => {
  const game = fresh()
  game.score = scoreForLevel(11)
  game.displayedLevel = 11 // 3-1, the first set with a ball
  game.wallsWrap = false
  game.prepareNextLevel = () => {}
  game.boss = []
  game.husks = []
  game.food = { x: 1, y: 1 }
  return game
}

test("a ball and a goal turn up from the third set, and not in an arena", () => {
  assert.ok(!hasBall(1))
  assert.ok(!hasBall(10))
  assert.ok(hasBall(11))
  assert.ok(!hasBall(15), "1-5, 2-5, 3-5 are duels and have neither")

  const game = pitch()
  game.spawnBall()
  assert.ok(game.ball.x >= 0 && game.goal.x >= 0)
  assert.ok(game.boardDistance(game.ball, game.goal) >= 8, "there is a shot to line up")

  // Endless has no levels to unlock it with.
  const endless = fresh()
  endless.endlessMode = true
  endless.spawnBall()
  assert.equal(endless.ball.x, -1)
})

test("one kick is enough when the net is already lined up", () => {
  const game = pitch()
  game.goal = { x: 19, y: 8 }
  game.ball = { x: 12, y: 8 }
  game.snake = [{ x: 11, y: 8 }, { x: 10, y: 8 }, { x: 9, y: 8 }]
  game.direction = { x: 1, y: 0 }
  let kicks = 0
  let scored = null
  game.on("ballKicked", () => ++kicks)
  game.on("goalScored", (x, y, points) => (scored = { x, y, points }))

  const before = game.score
  for (let i = 0; i < 8 && !scored; ++i) game.tick()
  assert.equal(kicks, 1, "pushing it along its own line is not a second kick")
  assert.deepEqual(scored, { x: 19, y: 8, points: GOAL_BONUS })
  assert.equal(game.score - before, GOAL_BONUS)
  assert.ok(game.ball.x < 0 && game.goal.x < 0, "both leave the pitch")
})

test("a kicked ball keeps going until something turns it round", () => {
  const game = pitch()
  game.goal = { x: 2, y: 2 }
  game.ball = { x: 6, y: 8 }
  game.snake = [{ x: 5, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 8 }]
  game.direction = { x: 1, y: 0 }
  game.tick()
  assert.deepEqual(game.ballDirection, { x: 1, y: 0 })

  // Set it rolling at the near wall and leave it alone. The snake goes off
  // downwards, well clear of it and of any wall of its own for a while.
  game.ball = { x: COLUMNS - 3, y: 8 }
  game.ballDirection = { x: 1, y: 0 }
  game.snake = [{ x: 2, y: 2 }, { x: 2, y: 1 }, { x: 2, y: 0 }]
  game.direction = { x: 0, y: 1 }
  let bounces = 0
  game.on("ballBounced", () => ++bounces)
  for (let i = 0; i < 10; ++i) {
    game.tick()
    assert.ok(game.ballRolling, "it never runs out of roll")
  }
  assert.equal(bounces, 1, "it turns round at the wall rather than stopping")
  assert.deepEqual(game.ballDirection, { x: -1, y: 0 })
  assert.ok(!game.gameOver)
})

test("a head turns a rolling ball; a body only sends it back", () => {
  // Standing in the ball's way with the head is a kick: the ball leaves the
  // way the snake was going, which is the only way to aim a moving one.
  const struck = pitch()
  struck.goal = { x: 2, y: 2 }
  // One cell short of where the snake's head is about to arrive.
  struck.ball = { x: 11, y: 8 }
  struck.ballDirection = { x: 1, y: 0 }
  struck.snake = [{ x: 12, y: 9 }, { x: 12, y: 10 }, { x: 12, y: 11 }]
  struck.direction = { x: 0, y: -1 }
  struck.tick()
  assert.deepEqual(struck.ballDirection, { x: 0, y: -1 }, "it goes the way it was hit")

  // The rest of the snake is just something in the way.
  const walled = pitch()
  walled.goal = { x: 2, y: 2 }
  walled.ball = { x: 11, y: 8 }
  walled.ballDirection = { x: 1, y: 0 }
  walled.snake = [{ x: 5, y: 2 }, { x: 12, y: 8 }, { x: 12, y: 9 }]
  walled.direction = { x: 0, y: -1 }
  walled.tick()
  assert.deepEqual(walled.ballDirection, { x: -1, y: 0 }, "off a body it comes straight back")
  assert.ok(!walled.gameOver)
})

test("a ball is never lethal, whatever it runs into", () => {
  const game = pitch()
  game.goal = { x: 2, y: 14 }
  // Kicked straight at a wall of the snake's own body.
  game.ball = { x: 8, y: 8 }
  game.snake = [{ x: 7, y: 8 }, { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 9, y: 7 }, { x: 9, y: 8 }]
  game.direction = { x: 1, y: 0 }
  game.tick()
  assert.ok(!game.gameOver)
  assert.ok(game.ball.x >= 0, "it is still on the pitch")
})

// --- serialisation -----------------------------------------------------------
//
// A race runs two of these in a room and draws them in two browsers, so a whole
// game has to survive being turned into a message. Everything `Draw.js` reads
// is either a field below or derived from one.

test("a whole game survives the trip to another board and back", () => {
  const game = fresh({ random: () => 0.5 })
  game.jumpToLevel(5)
  game.setPartyMode(true)
  for (let apple = 0; apple < 5; ++apple) {
    game.food = { x: game.snake[0].x + game.direction.x, y: game.snake[0].y + game.direction.y }
    game.tick()
  }

  const copy = fresh({ random: () => 0.5 })
  copy.applySnapshot(JSON.parse(JSON.stringify(game.snapshot())))

  assert.deepEqual(copy.snapshot(), game.snapshot())
  assert.deepEqual(copy.snake, game.snake)
  assert.deepEqual(copy.boss, game.boss)
  assert.equal(copy.score, game.score)
  assert.equal(copy.partyMode, true)
  assert.equal(copy.foodMultiplier, game.foodMultiplier)
})

test("everything the renderer reads is derived, so restoring the fields restores it", () => {
  const game = fresh({ random: () => 0.5 })
  game.jumpToLevel(5)
  const copy = fresh()
  copy.applySnapshot(game.snapshot())

  assert.equal(copy.level, game.level)
  assert.equal(copy.bossLevel, game.bossLevel)
  assert.equal(copy.bossHealth, game.bossHealth)
  assert.equal(copy.levelProgress, game.levelProgress)
  assert.equal(copy.comboProgress, game.comboProgress)
  assert.deepEqual(copy.obstacles, game.obstacles)
})

test("a cell off the board travels as nowhere and comes back as nowhere", () => {
  const game = fresh({ random: () => 0.5 })
  game.snakeEater = { x: -1, y: -1 }
  game.ball = { x: -1, y: -1 }
  const copy = fresh()
  copy.applySnapshot(game.snapshot())
  assert.deepEqual(copy.snakeEater, { x: -1, y: -1 })
  assert.deepEqual(copy.ball, { x: -1, y: -1 })
})
