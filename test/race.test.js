// The racing model: a set of levels each, a boss at the end of every set, and
// what a crash costs. Each lane is a real `Game`, so most of what happens on a
// board is `test/game.test.js`'s business — these are the rules a race adds on
// top of it.
//
//   npm test

import test from "node:test"
import assert from "node:assert/strict"

import { LEVELS_PER_SET, isBossLevel, levelName, obstacleCells, pointsForLevel } from "../public/snake/Game.js"
import {
  COUNTDOWN_MS,
  CRASH_PAUSE_MS,
  DRAW,
  LEVEL_FADE_MS,
  PHASE_COUNTDOWN,
  PHASE_MATCH_OVER,
  PHASE_PLAYING,
  PHASE_ROUND_OVER,
  ROUND_OVER_MS,
  Race,
  setBossLevel,
  setStartLevel
} from "../public/snake/Race.js"

// A race already past its countdown.
function arena(options = {}) {
  const race = new Race(options)
  race.startMatch()
  race.step(COUNTDOWN_MS)
  return race
}

// The room and the browser both drive a race in small slices, so tests do too:
// a lane's timers only move when it is stepped.
function pump(race, ms, chunk = 20) {
  for (let elapsed = 0; elapsed < ms; elapsed += chunk) race.step(chunk)
}

const levelsOf = race => race.seated.map(lane => lane.game.displayedLevel)

// --- rounds are sets --------------------------------------------------------

test("round one is set one, and both lanes start on 1.1", () => {
  const race = new Race()
  race.startMatch()
  assert.equal(race.round, 1)
  assert.deepEqual(levelsOf(race), [1, 1])
  assert.equal(levelName(race.players[0].game.displayedLevel), "1.1")
})

test("round two starts on 2.1", () => {
  const race = arena()
  // Winning a round is beating the boss at the end of the set.
  race.players[0].game.defeatBoss()
  assert.equal(race.phase, PHASE_ROUND_OVER)
  assert.equal(race.roundWinner, 0)

  pump(race, ROUND_OVER_MS)
  assert.equal(race.round, 2)
  assert.equal(race.phase, PHASE_COUNTDOWN)
  assert.deepEqual(levelsOf(race), [6, 6])
  assert.equal(levelName(race.players[0].game.displayedLevel), "2.1")
  assert.equal(levelName(race.players[1].game.displayedLevel), "2.1")
})

test("a set is five levels and its last one is the boss", () => {
  for (let round = 1; round <= 4; ++round) {
    assert.equal(setBossLevel(round) - setStartLevel(round), LEVELS_PER_SET - 1)
    assert.ok(isBossLevel(setBossLevel(round)), `${levelName(setBossLevel(round))} should be a boss`)
    assert.ok(!isBossLevel(setStartLevel(round)))
  }
  assert.equal(levelName(setBossLevel(1)), "1.5")
  assert.equal(levelName(setBossLevel(2)), "2.5")
})

// --- a lane is a real game ---------------------------------------------------

test("a lane plays the single-player game's own layouts", () => {
  const race = arena()
  const lane = race.players[0]
  race.placeLane(0, 3)
  assert.deepEqual(lane.game.obstacles, obstacleCells(3))
  assert.ok(obstacleCells(3).length > 0)
})

test("level 1.5 is a boss fight, not a finishing post you walk past", () => {
  const race = arena()
  race.placeLane(0, setBossLevel(1))
  const game = race.players[0].game
  assert.equal(game.bossLevel, true)
  assert.equal(game.bossPhase, "fight")
  assert.ok(game.boss.length > 1)
  assert.equal(game.bossHealth, 1)
  // Arriving there is not winning it.
  assert.equal(race.phase, PHASE_PLAYING)
  assert.equal(race.players[0].finished, false)
})

test("beating the boss takes the round; the other lane's progress is irrelevant", () => {
  const race = arena()
  race.players[1].game.awardPoints(pointsForLevel(1))   // the other lane is doing fine
  race.players[0].game.defeatBoss()

  assert.equal(race.players[0].finished, true)
  assert.equal(race.roundWinner, 0)
  assert.equal(race.players[0].wins, 1)
  assert.equal(race.players[1].wins, 0)
  assert.equal(race.phase, PHASE_ROUND_OVER)
})

test("clearing a level moves the lane to the next one, once the fade has passed", () => {
  const race = arena()
  const lane = race.players[0]
  lane.game.awardPoints(pointsForLevel(1))

  // The race hears `levelCompleted` as it happens and starts the fade there.
  assert.equal(lane.game.levelTransition, true)
  assert.ok(lane.transitionMs > 0)
  assert.equal(lane.game.displayedLevel, 1)

  pump(race, LEVEL_FADE_MS)
  assert.equal(lane.game.displayedLevel, 2)
  assert.equal(lane.game.levelTransition, false)
  assert.equal(lane.game.snake.length, 3)
})

// --- crashing ----------------------------------------------------------------

test("a crash costs the set, not the round, and goes back to the set's first level", () => {
  const race = arena()
  race.players[0].game.defeatBoss()
  pump(race, ROUND_OVER_MS + COUNTDOWN_MS)
  assert.equal(race.round, 2)

  const lane = race.players[0]
  race.placeLane(0, 8)                     // 2.3, partway up the set
  assert.equal(levelName(lane.game.displayedLevel), "2.3")
  lane.game.finish()
  race.step(20)

  assert.equal(lane.crashMs > 0, true)
  assert.equal(lane.crashes, 1)
  assert.equal(race.phase, PHASE_PLAYING, "a crash does not end the round")

  pump(race, CRASH_PAUSE_MS)
  assert.equal(levelName(lane.game.displayedLevel), "2.1", "back to the start of the set, not to 1.1")
  assert.equal(lane.game.gameOver, false)
  assert.equal(lane.game.snake.length, 3)
})

test("a crashed lane holds still while the other one keeps racing", () => {
  const race = arena()
  race.players[0].game.finish()
  race.step(20)

  const stuck = race.players[0].game.snake.map(cell => ({ ...cell }))
  const moving = race.players[1].game.snake[0].x
  pump(race, 400)

  assert.deepEqual(race.players[0].game.snake, stuck)
  assert.notEqual(race.players[1].game.snake[0].x, moving)
})

test("being eaten by a boss says so, and is still only a setback", () => {
  const race = arena()
  race.placeLane(0, setBossLevel(1))
  const lane = race.players[0]
  assert.equal(lane.game.bossPhase, "fight")
  lane.game.finish()
  race.step(20)

  assert.equal(lane.reason, "eaten")
  assert.equal(race.phase, PHASE_PLAYING)
  pump(race, CRASH_PAUSE_MS)
  assert.equal(levelName(lane.game.displayedLevel), "1.1")
})

// --- party mode, one player at a time ------------------------------------------

test("every lane plays with Party Mode on, because that is how a race is played", () => {
  const race = arena()
  for (const lane of race.seated) {
    assert.equal(lane.game.partyMode, true)
  }
  // And it survives a round, a crash and a new set.
  race.players[0].game.defeatBoss()
  pump(race, ROUND_OVER_MS)
  for (const lane of race.seated) assert.equal(lane.game.partyMode, true)
})

test("the disco ball stays on the board, because here it offers the music", () => {
  const race = arena()
  // Party Mode ordinarily takes it away, the party having already started.
  for (const lane of race.seated) {
    assert.equal(lane.game.discoBallEnabled, true)
    assert.ok(lane.game.discoBall.x >= 0, "a lane should have a disco ball on it")
  }
})

test("eating one takes it off that board, and leaves the others alone", () => {
  const race = arena()
  const lane = race.players[0]
  const ball = { ...lane.game.discoBall }
  assert.ok(ball.x >= 0)

  // Straight into it.
  lane.game.snake = [{ x: ball.x - 1, y: ball.y }, { x: ball.x - 2, y: ball.y }, { x: ball.x - 3, y: ball.y }]
  lane.game.direction = { x: 1, y: 0 }
  lane.game.turnQueue = []
  lane.game.tick()

  assert.deepEqual(lane.game.discoBall, { x: -1, y: -1 })
  assert.ok(race.players[1].game.discoBall.x >= 0, "the other lane still has its own")
})

test("eating one says so, and says which lane it was", () => {
  const race = arena()
  const seen = []
  race.on("discoBall", (seat, x, y) => seen.push([seat, x, y]))
  race.players[1].game.emit("discoBallEaten", 4, 5)
  assert.deepEqual(seen, [[1, 4, 5]])
})

test("every lane builds a combo, and it is worth more than the apples alone", () => {
  const race = arena()
  const game = race.players[0].game
  for (let apple = 0; apple < 3; ++apple) {
    game.food = { x: game.snake[0].x + game.direction.x, y: game.snake[0].y + game.direction.y }
    game.tick()
  }
  assert.ok(game.foodMultiplier > 1)
  assert.ok(game.score > 3, "three apples at a multiplier are worth more than three")
})

test("a beat only ever reaches the lane that reported it", () => {
  const race = arena()
  assert.equal(race.registerBeat(0, 1), true)
  assert.ok(race.players[0].game.beatWindowMs > 0)
  assert.equal(race.players[1].game.beatWindowMs, 0)
  // And an empty seat has no lane to open one on.
  assert.equal(race.registerBeat(3, 1), false)
})

test("a face is picked before a race and not during one", () => {
  const race = new Race()
  race.startMatch()
  assert.equal(race.setHead(0, 2), true)
  race.step(COUNTDOWN_MS)
  assert.equal(race.setHead(0, 5), false)
  assert.equal(race.players[0].head, 2)
})

// --- the match ------------------------------------------------------------------

test("the match ends when someone has taken enough rounds", () => {
  const race = arena({ winsNeeded: 2 })
  race.players[0].wins = 1
  race.players[0].game.defeatBoss()
  assert.equal(race.players[0].wins, 2)

  pump(race, ROUND_OVER_MS)
  assert.equal(race.phase, PHASE_MATCH_OVER)
  assert.equal(race.matchWinner, 0)
  pump(race, 10000)
  assert.equal(race.phase, PHASE_MATCH_OVER)
})

test("a race nobody is trying to win is eventually a draw", () => {
  const race = arena()
  pump(race, 5 * 60 * 1000 + 1000, 500)
  assert.equal(race.phase, PHASE_ROUND_OVER)
  assert.equal(race.roundWinner, DRAW)
  assert.deepEqual(race.seated.map(lane => lane.wins), [0, 0])
})

test("the pace follows whichever lane is next due", () => {
  const race = arena()
  assert.ok(race.pace > 0 && race.pace <= 100)
  race.players[0].game.finish()
  race.players[1].game.finish()
  race.step(20)
  // Both sitting in a crash: nothing is due, so it waits.
  assert.equal(race.pace, 100)
})

// --- nothing a race does may reach a best score -----------------------------------

test("a lane is a practice run on storage of its own", () => {
  const race = arena()
  const lane = race.players[0]
  assert.equal(lane.game.practiceRun, true)

  lane.game.score = 500
  lane.game.finish()
  assert.equal(lane.game.bestLevels, 0, "a practice run never sets a best score")
  // And whatever it did save went to the lane's own store, not the player's.
  assert.notEqual(lane.game.store, globalThis.localStorage)
})

// --- the wire ----------------------------------------------------------------------

test("a snapshot carries two whole games there and back", () => {
  const race = arena()
  race.players[0].head = 4
  race.placeLane(0, setBossLevel(1))
  race.players[1].wins = 2
  race.players[1].game.awardPoints(3)

  const watcher = new Race()
  watcher.applySnapshot(JSON.parse(JSON.stringify(race.snapshot())))

  assert.deepEqual(watcher.snapshot(), race.snapshot())
  assert.equal(watcher.players[0].head, 4)
  assert.equal(watcher.players[1].wins, 2)
  // The boss and everything derived from it survives, which is what lets the
  // far browser draw a fight it is not running.
  assert.equal(watcher.players[0].game.bossLevel, true)
  assert.equal(watcher.players[0].game.boss.length, race.players[0].game.boss.length)
  assert.equal(watcher.players[0].game.bossHealth, race.players[0].game.bossHealth)
  assert.deepEqual(watcher.players[0].game.obstacles, race.players[0].game.obstacles)
  assert.equal(watcher.players[1].game.score, race.players[1].game.score)
})

test("progress counts levels through the set", () => {
  const race = arena()
  assert.equal(race.progressOf(0), 0)
  race.placeLane(0, setStartLevel(1) + 2)
  assert.ok(race.progressOf(0) >= 0.4 && race.progressOf(0) < 0.7)
  race.players[0].finished = true
  assert.equal(race.progressOf(0), 1)
})

// --- more than two lanes -------------------------------------------------------

const foursome = (options = {}) => {
  const race = new Race({ present: [true, true, true, true], ...options })
  race.startMatch()
  race.step(COUNTDOWN_MS)
  return race
}

test("an empty seat gets no board and no clock", () => {
  const race = new Race()
  race.startMatch()
  assert.equal(race.players.length, 4)
  assert.deepEqual(race.players.map(lane => lane.present), [true, true, false, false])
  assert.equal(race.seated.length, 2)
  assert.equal(race.players[2].game.snake.length, 0)
  assert.equal(race.turn(2, 0, 1), false)
  assert.equal(race.registerBeat(2, 1), false)
})

test("four lanes all start the set together", () => {
  const race = foursome()
  assert.equal(race.seated.length, 4)
  for (const lane of race.seated) {
    assert.equal(levelName(lane.game.displayedLevel), "1.1")
    assert.equal(lane.game.snake.length, 3)
  }
  // Four separate boards: four separate apples.
  const apples = race.seated.map(lane => lane.game.food)
  for (const apple of apples) assert.ok(apple.x >= 0)
})

test("the first of four to beat the boss takes the round, and the rest start the next set", () => {
  const race = foursome()
  race.players[2].game.defeatBoss()

  assert.equal(race.roundWinner, 2)
  assert.equal(race.players[2].wins, 1)
  assert.deepEqual(race.players.map(lane => lane.wins), [0, 0, 1, 0])

  pump(race, ROUND_OVER_MS)
  assert.equal(race.round, 2)
  for (const lane of race.seated) assert.equal(levelName(lane.game.displayedLevel), "2.1")
})

test("one lane crashing leaves the other three alone", () => {
  const race = foursome()
  race.players[1].game.finish()
  race.step(20)

  assert.ok(race.players[1].crashMs > 0)
  const others = [0, 2, 3].map(seat => race.players[seat].game.snake[0].x)
  pump(race, 400)
  ;[0, 2, 3].forEach((seat, index) => {
    assert.notEqual(race.players[seat].game.snake[0].x, others[index], `lane ${seat} should still be moving`)
  })
  assert.equal(race.phase, PHASE_PLAYING)
})

test("all four lanes play the same game", () => {
  const race = foursome()
  assert.deepEqual(race.seated.map(lane => lane.game.partyMode), [true, true, true, true])
})

test("an absent seat cannot win a match", () => {
  const race = foursome({ winsNeeded: 1 })
  race.players[3].present = false
  race.players[3].wins = 5
  race.players[0].game.defeatBoss()
  pump(race, ROUND_OVER_MS)
  assert.equal(race.matchWinner, 0)
})

test("a snapshot carries who is playing", () => {
  const race = foursome()
  race.players[3].present = false
  const watcher = new Race()
  watcher.applySnapshot(JSON.parse(JSON.stringify(race.snapshot())))
  assert.deepEqual(watcher.players.map(lane => lane.present), [true, true, true, false])
  assert.deepEqual(watcher.snapshot(), race.snapshot())
})

test("the four default faces are four different faces", () => {
  const race = foursome()
  assert.equal(new Set(race.players.map(lane => lane.head)).size, 4)
})
