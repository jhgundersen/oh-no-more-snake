// The racing model: two boards that never touch, four levels each, and what a
// crash costs.
//
//   npm test

import test from "node:test"
import assert from "node:assert/strict"

import { obstacleCells } from "../public/snake/Game.js"
import {
  APPLES_PER_LEVEL,
  COUNTDOWN_MS,
  CRASH_PAUSE_MS,
  DRAW,
  PHASE_COUNTDOWN,
  PHASE_MATCH_OVER,
  PHASE_PLAYING,
  PHASE_ROUND_OVER,
  ROUND_OVER_MS,
  RACE_COLUMNS,
  RACE_ROWS,
  Race,
  TARGET_LEVEL,
  findSpawn
} from "../public/snake/Race.js"

// A race already past its countdown, with both apples pushed out of the way so
// a test only has to think about the thing it is testing.
function arena(options = {}) {
  const race = new Race({ random: () => 0, ...options })
  race.startMatch()
  race.advance(COUNTDOWN_MS)
  for (const lane of race.players) lane.food = { x: -1, y: -1 }
  return race
}

function place(race, seat, cells, direction) {
  const lane = race.players[seat]
  lane.snake = cells.map(([x, y]) => ({ x, y }))
  lane.direction = { x: direction[0], y: direction[1] }
  lane.turnQueue = []
}

// Feeds one lane an apple at a time until it has the level it was asked for.
function feed(race, seat, apples) {
  for (let i = 0; i < apples; ++i) {
    const lane = race.players[seat]
    const head = lane.snake[0]
    lane.food = { x: head.x + lane.direction.x, y: head.y + lane.direction.y }
    race.tick()
  }
}

// --- the boards ---------------------------------------------------------------

test("a race is played on the single-player game's own levels", () => {
  const race = new Race({ random: () => 0 })
  race.startMatch()
  assert.deepEqual(race.obstaclesOf(0), obstacleCells(1))
  race.players[0].level = 3
  assert.deepEqual(race.obstaclesOf(0), obstacleCells(3))
  assert.ok(obstacleCells(3).length > 0)
})

// The single-player game has this test because a layout that lands on the
// spawn is a snake born inside a wall. A race uses the same layouts.
test("every level a race can reach leaves the snake somewhere to spawn", () => {
  for (let level = 1; level <= TARGET_LEVEL; ++level) {
    const obstacles = obstacleCells(level)
    const start = findSpawn(obstacles, RACE_COLUMNS, RACE_ROWS)
    for (let k = 0; k < 3; ++k) {
      const cell = { x: start.x + k, y: start.y }
      assert.ok(!obstacles.some(wall => wall.x === cell.x && wall.y === cell.y),
        `level ${level} spawns a snake inside a wall at ${cell.x},${cell.y}`)
    }
  }
})

test("both lanes start level one, three long, on their own board", () => {
  const race = new Race({ random: () => 0 })
  race.startMatch()
  for (const lane of race.players) {
    assert.equal(lane.level, 1)
    assert.equal(lane.apples, 0)
    assert.equal(lane.snake.length, 3)
    assert.deepEqual(lane.direction, { x: 1, y: 0 })
  }
  // Two boards that never touch: each has its own apple.
  assert.ok(race.players[0].food.x >= 0)
  assert.ok(race.players[1].food.x >= 0)
})

// --- climbing ------------------------------------------------------------------

test("five apples clears a level and puts the lane on the next board", () => {
  const race = arena()
  feed(race, 0, APPLES_PER_LEVEL)

  const lane = race.players[0]
  assert.equal(lane.level, 2)
  // A new level is a fresh board: three long again, apples back to none.
  assert.equal(lane.apples, 0)
  assert.equal(lane.snake.length, 3)
  assert.ok(lane.food.x >= 0)
  // And the other lane has not moved an inch.
  assert.equal(race.players[1].level, 1)
})

test("an apple short of the level does not clear it", () => {
  const race = arena()
  feed(race, 0, APPLES_PER_LEVEL - 1)
  assert.equal(race.players[0].level, 1)
  assert.equal(race.players[0].apples, APPLES_PER_LEVEL - 1)
  assert.equal(race.players[0].snake.length, 3 + APPLES_PER_LEVEL - 1)
})

test("reaching level five takes the round and stops that lane there", () => {
  const race = arena()
  for (let level = 1; level < TARGET_LEVEL; ++level) feed(race, 0, APPLES_PER_LEVEL)

  assert.equal(race.players[0].level, TARGET_LEVEL)
  assert.equal(race.players[0].finished, true)
  assert.equal(race.phase, PHASE_ROUND_OVER)
  assert.equal(race.roundWinner, 0)
  assert.equal(race.players[0].wins, 1)
  assert.equal(race.players[1].wins, 0)
})

test("the lanes never touch: one lane's apple is not the other's", () => {
  const race = arena()
  place(race, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(race, 1, [[5, 5], [4, 5], [3, 5]], [1, 0])
  race.players[0].food = { x: 6, y: 5 }
  race.players[1].food = { x: 9, y: 9 }
  race.tick()

  assert.equal(race.players[0].apples, 1)
  assert.equal(race.players[1].apples, 0)
  // Two snakes on the same coordinates, on two boards, and neither notices.
  assert.deepEqual(race.players[1].snake[0], { x: 6, y: 5 })
  assert.equal(race.phase, PHASE_PLAYING)
})

// --- crashing ------------------------------------------------------------------

test("a crash costs the level, not the round", () => {
  const race = arena({ wrap: false })
  feed(race, 0, APPLES_PER_LEVEL)
  assert.equal(race.players[0].level, 2)

  const lane = race.players[0]
  place(race, 0, [[RACE_COLUMNS - 1, 5], [RACE_COLUMNS - 2, 5], [RACE_COLUMNS - 3, 5]], [1, 0])
  race.tick()

  // Left where it crashed, and the round is still going.
  assert.equal(race.phase, PHASE_PLAYING)
  assert.equal(lane.alive, false)
  assert.equal(lane.reason, "wall")
  assert.equal(lane.crashes, 1)
  assert.equal(lane.level, 2)

  // Then it goes back to the beginning.
  race.advance(CRASH_PAUSE_MS)
  assert.equal(lane.level, 1)
  assert.equal(lane.apples, 0)
  assert.equal(lane.alive, true)
  assert.equal(lane.snake.length, 3)
  assert.equal(race.phase, PHASE_PLAYING)
})

test("a crashed lane holds still while the other one keeps racing", () => {
  const race = arena({ wrap: false })
  place(race, 0, [[RACE_COLUMNS - 1, 5], [RACE_COLUMNS - 2, 5], [RACE_COLUMNS - 3, 5]], [1, 0])
  race.tick()
  assert.equal(race.players[0].crashMs, CRASH_PAUSE_MS)

  const stuck = race.players[0].snake.map(cell => ({ ...cell }))
  const moving = race.players[1].snake[0].x
  race.tick()
  race.tick()

  assert.deepEqual(race.players[0].snake, stuck)
  assert.notEqual(race.players[1].snake[0].x, moving)
})

test("running into your own body is a crash too", () => {
  const race = arena()
  place(race, 0, [[5, 5], [6, 5], [6, 6], [5, 6], [4, 6]], [0, 1])
  race.tick()
  assert.equal(race.players[0].reason, "self")
  assert.equal(race.players[0].alive, false)
})

test("a wall on the level is as fatal as the edge", () => {
  const race = arena({ wrap: false })
  race.players[0].level = 2
  const wall = obstacleCells(2)[0]
  place(race, 0, [[wall.x - 1, wall.y], [wall.x - 2, wall.y], [wall.x - 3, wall.y]], [1, 0])
  race.tick()
  assert.equal(race.players[0].reason, "wall")
})

test("a wrapping border carries a lane round instead of ending it", () => {
  const race = arena({ wrap: true })
  place(race, 0, [[RACE_COLUMNS - 1, 5], [RACE_COLUMNS - 2, 5], [RACE_COLUMNS - 3, 5]], [1, 0])
  race.tick()
  assert.equal(race.players[0].alive, true)
  assert.deepEqual(race.players[0].snake[0], { x: 0, y: 5 })
})

test("a lane that crashes on the last step of a round stays crashed", () => {
  const race = arena({ wrap: false })
  place(race, 0, [[RACE_COLUMNS - 1, 5], [RACE_COLUMNS - 2, 5], [RACE_COLUMNS - 3, 5]], [1, 0])
  race.tick()
  // The other lane finishes while the first is still sitting in its crash.
  race.players[1].level = TARGET_LEVEL - 1
  race.players[1].apples = APPLES_PER_LEVEL - 1
  const lane = race.players[1]
  lane.food = { x: lane.snake[0].x + lane.direction.x, y: lane.snake[0].y + lane.direction.y }
  race.tick()

  assert.equal(race.phase, PHASE_ROUND_OVER)
  assert.equal(race.roundWinner, 1)
  race.advance(100)
  assert.equal(race.players[0].alive, false, "the crash should still be on screen")
  assert.equal(race.players[0].level, 2 - 1)
})

// --- rounds and the match --------------------------------------------------------

test("the round over screen passes and the next round starts both lanes over", () => {
  const race = arena()
  for (let level = 1; level < TARGET_LEVEL; ++level) feed(race, 0, APPLES_PER_LEVEL)
  assert.equal(race.round, 1)

  race.advance(ROUND_OVER_MS)
  assert.equal(race.round, 2)
  assert.equal(race.phase, PHASE_COUNTDOWN)
  for (const lane of race.players) {
    assert.equal(lane.level, 1)
    assert.equal(lane.apples, 0)
    assert.equal(lane.finished, false)
    assert.equal(lane.snake.length, 3)
  }
  assert.equal(race.players[0].wins, 1)
})

test("the match ends when someone has taken enough rounds", () => {
  const race = arena({ winsNeeded: 2 })
  race.players[0].wins = 1
  for (let level = 1; level < TARGET_LEVEL; ++level) feed(race, 0, APPLES_PER_LEVEL)
  assert.equal(race.players[0].wins, 2)

  race.advance(ROUND_OVER_MS)
  assert.equal(race.phase, PHASE_MATCH_OVER)
  assert.equal(race.matchWinner, 0)
  race.advance(10000)
  assert.equal(race.phase, PHASE_MATCH_OVER)
})

test("a race nobody is trying to win is eventually a draw", () => {
  const race = arena({ wrap: true })
  for (let step = 0; step < 3000 && race.phase === PHASE_PLAYING; ++step) race.tick()
  assert.equal(race.phase, PHASE_ROUND_OVER)
  assert.equal(race.roundWinner, DRAW)
  assert.equal(race.players[0].wins, 0)
  assert.equal(race.players[1].wins, 0)
})

test("nothing moves until the countdown has run out", () => {
  const race = new Race({ random: () => 0 })
  race.startMatch()
  assert.equal(race.phase, PHASE_COUNTDOWN)
  const before = race.players[0].snake.map(cell => ({ ...cell }))
  race.tick()
  assert.deepEqual(race.players[0].snake, before)
  race.advance(COUNTDOWN_MS)
  race.tick()
  assert.notDeepEqual(race.players[0].snake, before)
})

// --- pace ------------------------------------------------------------------------

test("the pace follows whichever lane is further ahead, and stops at a floor", () => {
  const race = arena()
  const opening = race.tickInterval
  race.players[1].level = 3
  assert.ok(race.tickInterval < opening)
  race.players[1].level = 40
  assert.ok(race.tickInterval >= 85)
})

test("progress counts levels far more heavily than apples", () => {
  const race = arena()
  assert.equal(race.progressOf(0), 0)
  race.players[0].apples = APPLES_PER_LEVEL
  const oneLevelOfApples = race.progressOf(0)
  race.players[0].apples = 0
  race.players[0].level = 2
  assert.equal(race.progressOf(0), oneLevelOfApples)
  race.players[0].level = TARGET_LEVEL
  assert.equal(race.progressOf(0), 1)
})

// --- steering and faces ------------------------------------------------------------

test("a lane cannot be turned back into itself, and queues two turns", () => {
  const race = arena()
  assert.equal(race.turn(0, -1, 0), false)
  assert.equal(race.turn(0, 0, 1), true)
  assert.equal(race.turn(0, -1, 0), true)
  assert.equal(race.turn(0, 0, -1), false)
})

test("a crashed lane cannot be steered", () => {
  const race = arena({ wrap: false })
  place(race, 0, [[RACE_COLUMNS - 1, 5], [RACE_COLUMNS - 2, 5], [RACE_COLUMNS - 3, 5]], [1, 0])
  race.tick()
  assert.equal(race.turn(0, 0, 1), false)
  assert.equal(race.turn(1, 0, 1), true)
})

test("a face is picked before a race and not during one", () => {
  const race = new Race({ random: () => 0 })
  race.startMatch()
  assert.equal(race.setHead(1, 2), true)
  assert.equal(race.players[1].head, 2)
  race.advance(COUNTDOWN_MS)
  assert.equal(race.setHead(1, 5), false)
  assert.equal(race.players[1].head, 2)
})

// --- the wire ----------------------------------------------------------------------

test("a snapshot survives the trip to another board and back", () => {
  const race = arena()
  // Straight onto the lane: the setter refuses once a race is running, which
  // is its own test above. This one is about the wire.
  race.players[0].head = 4
  feed(race, 0, APPLES_PER_LEVEL + 1)
  race.players[1].wins = 2

  const watcher = new Race()
  watcher.applySnapshot(JSON.parse(JSON.stringify(race.snapshot())))

  assert.deepEqual(watcher.snapshot(), race.snapshot())
  assert.equal(watcher.players[0].level, 2)
  assert.equal(watcher.players[0].head, 4)
  assert.equal(watcher.players[1].wins, 2)
  assert.deepEqual(watcher.players[0].snake, race.players[0].snake)
  assert.deepEqual(watcher.players[0].food, race.players[0].food)
})

// The layouts are the one thing not sent: a lane's walls are its level's walls,
// which both ends can work out from the one number.
test("the walls are not on the wire and are derived from the level", () => {
  const race = arena()
  race.players[0].level = 4
  const state = race.snapshot()
  assert.equal(JSON.stringify(state).includes("obstacles"), false)

  const watcher = new Race()
  watcher.applySnapshot(state)
  assert.deepEqual(watcher.obstaclesOf(0), obstacleCells(4))
  assert.ok(watcher.obstaclesOf(0).length > 0)
})

test("a crash cell past the far wall does not come back as a real cell", () => {
  const race = arena({ wrap: false })
  place(race, 0, [[RACE_COLUMNS - 1, 5], [RACE_COLUMNS - 2, 5], [RACE_COLUMNS - 3, 5]], [1, 0])
  race.tick()
  const watcher = new Race()
  watcher.applySnapshot(race.snapshot())
  assert.equal(watcher.players[0].crashAt, null)
})
