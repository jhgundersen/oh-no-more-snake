// The two-player model: spawning, the shared apple, who dies of what, and how
// a round is decided when both of them die of it at once.
//
//   npm test

import test from "node:test"
import assert from "node:assert/strict"

import {
  COUNTDOWN_MS,
  DRAW,
  HEADS,
  PHASE_COUNTDOWN,
  PHASE_MATCH_OVER,
  PHASE_PLAYING,
  PHASE_ROUND_OVER,
  ROUND_OVER_MS,
  ROUND_TIME_MS,
  VERSUS_COLUMNS,
  VERSUS_ROWS,
  Versus,
  mirrorCell,
  spawnCells,
  spawnRow,
  MAX_SEATS,
  flipRow,
  spawnDirection,
  spawnFor,
  spawnZone,
  validHead,
  versusObstacles
} from "../public/snake/Versus.js"

// A match already past its countdown, with the apple pushed out of the way so
// a test only has to think about the thing it is testing.
function arena(options = {}) {
  const versus = new Versus({ random: () => 0, ...options })
  versus.startMatch()
  versus.advance(COUNTDOWN_MS)
  versus.food = { x: -1, y: -1 }
  return versus
}

// Head first, like the model stores it.
function place(versus, seat, cells, direction) {
  const player = versus.players[seat]
  player.snake = cells.map(([x, y]) => ({ x, y }))
  player.direction = { x: direction[0], y: direction[1] }
  player.turnQueue = []
}

const cells = player => player.snake.map(cell => [cell.x, cell.y])

// --- the board ---------------------------------------------------------------

test("the two spawns are the same spawn turned through half a turn", () => {
  const versus = new Versus({ random: () => 0 })
  versus.startMatch()
  const [first, second] = versus.players

  assert.equal(first.snake.length, 3)
  assert.equal(second.snake.length, 3)
  assert.deepEqual(first.direction, { x: 1, y: 0 })
  assert.deepEqual(second.direction, { x: -1, y: 0 })

  first.snake.forEach((cell, index) => {
    assert.deepEqual(second.snake[index], mirrorCell(cell, versus.columns, versus.rows))
  })
})

test("the spawn rows are far enough apart to be two different rows", () => {
  const mine = spawnRow(VERSUS_ROWS)
  const theirs = VERSUS_ROWS - 1 - mine
  assert.ok(Math.abs(theirs - mine) >= 4, `spawn rows ${mine} and ${theirs} are too close`)
})

// The single-player game has a test that a layout always leaves the snake
// somewhere to spawn. This is the same worry: an arrangement that lands on a
// spawn cell is a snake born inside a wall.
test("no arrangement puts a wall on a spawn cell or the run in front of it", () => {
  for (const [columns, rows] of [[VERSUS_COLUMNS, VERSUS_ROWS], [24, 18], [40, 30], [21, 15]]) {
    const zone = spawnZone(columns, rows)
    for (let round = 1; round <= 8; ++round) {
      for (const cell of versusObstacles(round, columns, rows)) {
        assert.ok(cell.x >= 0 && cell.x < columns && cell.y >= 0 && cell.y < rows,
          `round ${round} on ${columns}x${rows} put a wall off the board`)
        assert.ok(!zone.some(spot => spot.x === cell.x && spot.y === cell.y),
          `round ${round} on ${columns}x${rows} put a wall at ${cell.x},${cell.y}`)
      }
    }
  }
})

test("every arrangement is symmetric under a half turn", () => {
  for (let round = 1; round <= 8; ++round) {
    const obstacles = versusObstacles(round, VERSUS_COLUMNS, VERSUS_ROWS)
    for (const cell of obstacles) {
      const twin = mirrorCell(cell, VERSUS_COLUMNS, VERSUS_ROWS)
      assert.ok(obstacles.some(other => other.x === twin.x && other.y === twin.y),
        `round ${round} has a wall at ${cell.x},${cell.y} with nothing opposite it`)
    }
  }
})

test("the first round is an empty board and later rounds are not", () => {
  assert.equal(versusObstacles(1).length, 0)
  assert.ok(versusObstacles(2).length > 0)
  assert.ok(versusObstacles(3).length > 0)
  assert.ok(versusObstacles(4).length > 0)
  assert.equal(versusObstacles(5).length, 0)
})

test("a spawn cell is never off the board", () => {
  for (const [columns, rows] of [[VERSUS_COLUMNS, VERSUS_ROWS], [21, 15], [40, 30]]) {
    for (const cell of spawnCells(columns, rows)) {
      assert.ok(cell.x >= 0 && cell.x < columns && cell.y >= 0 && cell.y < rows)
    }
  }
})

// --- the countdown -----------------------------------------------------------

test("a round does not move until its countdown has run out", () => {
  const versus = new Versus({ random: () => 0 })
  versus.startMatch()
  assert.equal(versus.phase, PHASE_COUNTDOWN)

  const before = cells(versus.players[0])
  versus.tick()
  assert.deepEqual(cells(versus.players[0]), before)

  versus.advance(COUNTDOWN_MS)
  assert.equal(versus.phase, PHASE_PLAYING)
  versus.tick()
  assert.notDeepEqual(cells(versus.players[0]), before)
})

test("a turn may be queued during the countdown, so the first tick can already be a turn", () => {
  const versus = new Versus({ random: () => 0 })
  versus.startMatch()
  assert.ok(versus.turn(0, 0, -1))
  versus.advance(COUNTDOWN_MS)
  versus.tick()
  assert.deepEqual(versus.players[0].direction, { x: 0, y: -1 })
})

// --- dying -------------------------------------------------------------------

test("a wall on the board ends the round and hands it to the other player", () => {
  const versus = arena()
  versus.obstacles = [{ x: 6, y: 5 }]
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  versus.tick()

  assert.equal(versus.phase, PHASE_ROUND_OVER)
  assert.equal(versus.players[0].alive, false)
  assert.equal(versus.players[0].reason, "wall")
  assert.equal(versus.roundWinner, 1)
  assert.equal(versus.players[1].wins, 1)
})

test("the border is always a way round, never an ending", () => {
  const versus = arena()
  assert.equal(versus.wrap, true)
  place(versus, 0, [[versus.columns - 1, 5], [versus.columns - 2, 5], [versus.columns - 3, 5]], [1, 0])
  versus.tick()

  assert.equal(versus.players[0].alive, true)
  assert.deepEqual(versus.players[0].snake[0], { x: 0, y: 5 })
  assert.equal(versus.phase, PHASE_PLAYING)
})

test("a wrapping border carries the snake round instead", () => {
  const versus = arena()
  place(versus, 0, [[versus.columns - 1, 5], [versus.columns - 2, 5], [versus.columns - 3, 5]], [1, 0])
  versus.tick()

  assert.equal(versus.phase, PHASE_PLAYING)
  assert.deepEqual(versus.players[0].snake[0], { x: 0, y: 5 })
})

test("running into your own body takes your own tail off", () => {
  const versus = arena()
  // Straight into its own flank, four cells back.
  place(versus, 0, [[5, 5], [5, 4], [6, 4], [6, 5], [6, 6], [6, 7]], [1, 0])
  versus.tick()

  // Still going, and shorter. There is no third way to lose a duel.
  assert.equal(versus.players[0].alive, true)
  assert.equal(versus.phase, PHASE_PLAYING)
  assert.deepEqual(versus.players[0].snake,
    [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 6, y: 4 }])
  // What came off is on the board, the same as a bite out of anybody else.
  assert.deepEqual(versus.scraps, [{ x: 6, y: 6 }])
})

test("clipping your own tail costs one cell and leaves nothing behind", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [6, 5], [6, 6], [5, 6], [4, 6]], [0, 1])
  versus.tick()

  assert.equal(versus.players[0].alive, true)
  assert.equal(versus.players[0].snake.length, 4, "five, less the tail it left and the cell it bit")
  assert.deepEqual(versus.scraps, [], "the tail had already moved on")
})

test("running into the other snake bites it rather than ending you", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  // Long enough that a bite through the middle leaves something behind.
  place(versus, 1, [[6, 3], [6, 4], [6, 5], [6, 6], [6, 7]], [0, -1])
  versus.tick()

  // Both are still going, and the round with them.
  assert.equal(versus.phase, PHASE_PLAYING)
  assert.equal(versus.players[0].alive, true)
  assert.equal(versus.players[1].alive, true)

  // The victim keeps everything in front of the bite; the rest is on the floor.
  assert.deepEqual(versus.players[1].snake, [{ x: 6, y: 2 }, { x: 6, y: 3 }, { x: 6, y: 4 }])
  assert.deepEqual(versus.scraps, [{ x: 6, y: 6 }])
  // And biting is worth something, or nobody would risk it.
  assert.equal(versus.players[0].score, 1)
})

test("a bite that leaves nothing but a head has eaten it", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  // Its head will be at 6,4 and 6,5 will be the cell right behind it.
  place(versus, 1, [[6, 5], [6, 6], [6, 7]], [0, -1])
  versus.tick()

  assert.equal(versus.players[1].alive, false)
  assert.equal(versus.players[1].reason, "eaten")
  assert.equal(versus.phase, PHASE_ROUND_OVER)
  assert.equal(versus.roundWinner, 0)
})

test("what is bitten off can be eaten, and grows whoever eats it", () => {
  const versus = arena()
  versus.scraps = [{ x: 6, y: 5 }]
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  versus.tick()

  assert.equal(versus.scraps.length, 0)
  assert.equal(versus.players[0].snake.length, 4)
  assert.equal(versus.players[0].score, 1)
})

test("an apple never lands on something bitten off", () => {
  const versus = arena()
  versus.scraps = [{ x: 4, y: 4 }]
  for (let attempt = 0; attempt < 30; ++attempt) {
    versus.random = () => attempt / 30
    versus.spawnFood()
    assert.notDeepEqual(versus.food, { x: 4, y: 4 })
  }
})

test("nose to nose is stars, not an ending", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[7, 5], [8, 5], [9, 5]], [-1, 0])
  const before = [0, 1].map(seat => versus.players[seat].snake.map(cell => ({ ...cell })))
  versus.tick()

  assert.equal(versus.phase, PHASE_PLAYING)
  for (const seat of [0, 1]) {
    assert.equal(versus.players[seat].alive, true)
    assert.ok(versus.players[seat].dizzyMs > 0, "it should be seeing stars")
    assert.deepEqual(versus.players[seat].snake, before[seat], "and it should not have moved")
  }
})

test("stars wear off, and a turn taken during them is taken the moment they do", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[7, 5], [8, 5], [9, 5]], [-1, 0])
  versus.tick()

  // Steering out of it is allowed, and is the way out of it.
  assert.equal(versus.turn(0, 0, -1), true)
  versus.tick()
  assert.deepEqual(versus.players[0].snake[0], { x: 5, y: 5 }, "still stunned")

  versus.advance(1200)
  assert.equal(versus.players[0].dizzyMs, 0)
  versus.tick()
  assert.deepEqual(versus.players[0].snake[0], { x: 5, y: 4 }, "and away it goes")
})

test("a snake seeing stars is still there to be bitten", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[7, 5], [8, 5], [9, 5]], [-1, 0])
  versus.tick()
  assert.ok(versus.players[1].dizzyMs > 0)

  // A third snake helps itself while the two of them are seeing stars.
  versus.players[2].present = true
  versus.players[2].alive = true
  place(versus, 2, [[8, 4], [8, 3], [8, 2]], [0, 1])
  versus.tick()

  assert.equal(versus.players[2].score, 1, "a bite is worth a point")
  assert.ok(versus.players[1].snake.length < 3)
})

test("the last of them going together is decided on apples", () => {
  const versus = arena()
  versus.obstacles = [{ x: 6, y: 5 }, { x: 6, y: 9 }]
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[5, 9], [4, 9], [3, 9]], [1, 0])
  versus.players[1].score = 2
  versus.tick()

  assert.equal(versus.roundWinner, 1)
  assert.equal(versus.players[1].wins, 1)
})

test("a wall on the board is as fatal as the edge is", () => {
  const versus = arena()
  versus.obstacles = [{ x: 6, y: 5 }]
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  versus.tick()

  assert.equal(versus.players[0].reason, "wall")
})

// The single-player game allows this and so must this one — but here the tail
// moving away may be somebody else's.
test("moving into a tail cell is legal when that tail moves away the same tick", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[6, 3], [6, 4], [6, 5]], [0, -1])
  versus.tick()

  assert.equal(versus.phase, PHASE_PLAYING)
  assert.deepEqual(versus.players[0].snake[0], { x: 6, y: 5 })
})

test("a tail that is growing does not move away, so it is there to be bitten", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[6, 3], [6, 4], [6, 5]], [0, -1])
  // The apple is where the other snake is about to put its head, so its tail
  // stays exactly where it is — and gets bitten off.
  versus.food = { x: 6, y: 2 }
  versus.tick()

  assert.equal(versus.players[1].score, 1, "it still got the apple")
  assert.equal(versus.players[0].alive, true)
  // Bitten at its very last cell: one segment gone, nothing behind it to drop,
  // and the growth it had just earned cancelled out.
  assert.equal(versus.players[1].alive, true)
  assert.deepEqual(versus.players[1].snake, [{ x: 6, y: 2 }, { x: 6, y: 3 }, { x: 6, y: 4 }])
  assert.equal(versus.scraps.length, 0)
  assert.equal(versus.players[0].score, 1, "a nip off the tail still counts")
})

// --- the apple ---------------------------------------------------------------

test("eating grows the snake by one and puts a new apple somewhere else", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  versus.food = { x: 6, y: 5 }
  versus.tick()

  const player = versus.players[0]
  assert.equal(player.snake.length, 4)
  assert.equal(player.score, 1)
  assert.equal(player.total, 1)
  assert.notDeepEqual(versus.food, { x: 6, y: 5 })
  assert.ok(versus.food.x >= 0)
})

test("an apple never lands on a snake or a wall", () => {
  const versus = arena()
  versus.obstacles = [{ x: 0, y: 0 }]
  place(versus, 0, [[1, 0], [2, 0], [3, 0]], [1, 0])
  for (let attempt = 0; attempt < 40; ++attempt) {
    versus.random = () => attempt / 40
    versus.spawnFood()
    assert.ok(!versus.occupied(versus.food), `apple landed on something at ${versus.food.x},${versus.food.y}`)
  }
})

test("nobody takes an apple two of them reached at once", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[7, 5], [8, 5], [9, 5]], [-1, 0])
  versus.food = { x: 6, y: 5 }
  versus.tick()

  // They stop nose to nose over it instead, and it is still there.
  assert.equal(versus.players[0].score, 0)
  assert.equal(versus.players[1].score, 0)
  assert.deepEqual(versus.food, { x: 6, y: 5 })
  assert.equal(versus.phase, PHASE_PLAYING)
})

// --- steering ----------------------------------------------------------------

test("a snake cannot be turned back into itself", () => {
  const versus = arena()
  assert.equal(versus.turn(0, -1, 0), false)
  assert.equal(versus.turn(0, 1, 0), false)
  assert.equal(versus.turn(0, 0, 1), true)
})

test("two turns queue and a third is dropped", () => {
  const versus = arena()
  assert.equal(versus.turn(0, 0, 1), true)
  assert.equal(versus.turn(0, -1, 0), true)
  assert.equal(versus.turn(0, 0, -1), false)
  assert.equal(versus.players[0].turnQueue.length, 2)
})

test("a dead player cannot steer, and neither seat can steer the other", () => {
  const versus = arena()
  versus.players[0].alive = false
  assert.equal(versus.turn(0, 0, 1), false)
  assert.equal(versus.turn(2, 0, 1), false)
  assert.equal(versus.turn(1, 0, 1), true)
})

// --- rounds and the match ----------------------------------------------------

test("the round over screen passes and the next round starts fresh", () => {
  const versus = arena()
  // A wall ends it: the first snake runs straight into one.
  versus.obstacles = [{ x: 6, y: 5 }]
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[20, 12], [21, 12], [22, 12]], [-1, 0])
  versus.tick()
  assert.equal(versus.phase, PHASE_ROUND_OVER)
  assert.equal(versus.round, 1)

  versus.advance(ROUND_OVER_MS)
  assert.equal(versus.round, 2)
  assert.equal(versus.phase, PHASE_COUNTDOWN)
  assert.equal(versus.players[0].alive, true)
  assert.equal(versus.players[0].snake.length, 3)
  // Wins carry across rounds; apples do not.
  assert.equal(versus.players[1].wins, 1)
  assert.equal(versus.players[1].score, 0)
})

test("the match ends when someone has taken enough rounds", () => {
  const versus = arena({ winsNeeded: 2 })
  versus.players[1].wins = 1
  versus.obstacles = [{ x: 6, y: 5 }]
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[20, 12], [21, 12], [22, 12]], [-1, 0])
  versus.tick()
  assert.equal(versus.players[1].wins, 2)

  versus.advance(ROUND_OVER_MS)
  assert.equal(versus.phase, PHASE_MATCH_OVER)
  assert.equal(versus.matchWinner, 1)
  assert.equal(versus.over, true)

  // And stays there: nothing about a finished match passes on its own.
  versus.advance(10000)
  assert.equal(versus.phase, PHASE_MATCH_OVER)
})

test("a round nobody is trying to win is ended by the clock, not left open", () => {
  const versus = arena()
  // Two snakes going round the same empty board and never meeting.
  for (let step = 0; step < 400 && versus.phase === PHASE_PLAYING; ++step) {
    versus.tick()
    versus.advance(400)
  }

  assert.equal(versus.phase, PHASE_ROUND_OVER)
  // Nobody died of it: they are the same length, so nobody takes it either.
  assert.equal(versus.roundWinner, DRAW)
  assert.equal(versus.players[0].alive, true)
  assert.equal(versus.players[1].alive, true)
})

// --- pace --------------------------------------------------------------------

test("the board speeds up with apples and with rounds, and stops at a floor", () => {
  const versus = arena()
  const opening = versus.tickInterval

  versus.players[0].score = 3
  assert.ok(versus.tickInterval < opening)

  const withApples = versus.tickInterval
  versus.round = 4
  assert.ok(versus.tickInterval < withApples)

  versus.round = 40
  versus.players[0].score = 200
  assert.ok(versus.tickInterval >= 70, `interval fell to ${versus.tickInterval}`)
})

// --- the wire ----------------------------------------------------------------

test("a snapshot survives the trip to another board and back", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  versus.food = { x: 9, y: 2 }
  versus.obstacles = [{ x: 1, y: 1 }, { x: 30, y: 20 }]
  versus.players[0].wins = 2
  versus.tick()

  const watcher = new Versus()
  watcher.applySnapshot(JSON.parse(JSON.stringify(versus.snapshot())))

  assert.deepEqual(watcher.snapshot(), versus.snapshot())
  assert.deepEqual(watcher.players[0].snake, versus.players[0].snake)
  assert.deepEqual(watcher.food, versus.food)
  assert.deepEqual(watcher.obstacles, versus.obstacles)
  assert.equal(watcher.players[0].wins, 2)
})

test("a cell off the board travels as nowhere and comes back as nowhere", () => {
  const versus = arena()
  versus.food = { x: -1, y: -1 }
  const watcher = new Versus()
  watcher.applySnapshot(versus.snapshot())
  assert.deepEqual(watcher.food, { x: -1, y: -1 })
})

test("a cell off the board travels as nowhere, whatever put it there", () => {
  const versus = arena()
  assert.equal(versus.indexOf({ x: versus.columns, y: 5 }), -1)
  assert.equal(versus.indexOf({ x: 5, y: versus.rows }), -1)
  assert.equal(versus.indexOf({ x: -1, y: -1 }), -1)
  assert.deepEqual(versus.cellAt(-1), { x: -1, y: -1 })
})

// --- heads -------------------------------------------------------------------

test("the head roster is a set of distinct named faces", () => {
  assert.ok(HEADS.length >= 2)
  assert.equal(new Set(HEADS.map(head => head.id)).size, HEADS.length)
  for (const head of HEADS) {
    assert.equal(typeof head.name, "string")
    assert.ok(head.name.length)
  }
})

// A head arrives from a browser, so it is not to be trusted to be a number.
test("anything that is not a head in the roster becomes the first one", () => {
  assert.equal(validHead(0), 0)
  assert.equal(validHead(HEADS.length - 1), HEADS.length - 1)
  assert.equal(validHead(HEADS.length), 0)
  assert.equal(validHead(-1), HEADS.length - 1)
  assert.equal(validHead("2"), 2)
  assert.equal(validHead("nonsense"), 0)
  assert.equal(validHead(null), 0)
  assert.equal(validHead(undefined), 0)
  assert.equal(validHead(Infinity), 0)
  assert.equal(validHead(1.9), 1)
})

test("the two seats start with two different faces", () => {
  const versus = new Versus()
  assert.notEqual(versus.players[0].head, versus.players[1].head)
})

test("a head may be picked before a round and not during one", () => {
  const versus = new Versus({ random: () => 0 })
  versus.startMatch()
  assert.equal(versus.phase, PHASE_COUNTDOWN)
  assert.equal(versus.setHead(0, 2), true)
  assert.equal(versus.players[0].head, 2)

  versus.advance(COUNTDOWN_MS)
  assert.equal(versus.phase, PHASE_PLAYING)
  assert.equal(versus.setHead(0, 4), false)
  assert.equal(versus.players[0].head, 2)

  assert.equal(versus.setHead(9, 1), false)
})

test("a face survives the round, the match and the trip over the wire", () => {
  // Picked during the countdown, which is the only time a face may be picked.
  const versus = new Versus({ random: () => 0 })
  versus.startMatch()
  versus.setHead(0, 4)
  versus.setHead(1, 1)
  versus.advance(COUNTDOWN_MS)
  versus.food = { x: -1, y: -1 }

  const watcher = new Versus()
  watcher.applySnapshot(JSON.parse(JSON.stringify(versus.snapshot())))
  assert.equal(watcher.players[0].head, 4)
  assert.equal(watcher.players[1].head, 1)

  // A new round rebuilds the snakes but not the players.
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[6, 4], [6, 5], [6, 6]], [0, -1])
  versus.tick()
  versus.advance(ROUND_OVER_MS)
  assert.equal(versus.players[0].head, 4)

  // And a room that throws its match away keeps the faces, because being made
  // to pick again because somebody's wifi went is not a thing to be made to do.
  versus.toLobby()
  assert.equal(versus.players[0].head, 4)
  assert.equal(versus.players[1].head, 1)
})

// --- four on one board ---------------------------------------------------------

const foursome = (options = {}) => {
  const versus = new Versus({ random: () => 0, present: [true, true, true, true], ...options })
  versus.startMatch()
  versus.advance(COUNTDOWN_MS)
  versus.food = { x: -1, y: -1 }
  return versus
}

test("an empty seat is on the board's books and on nothing else", () => {
  const versus = new Versus({ random: () => 0 })
  versus.startMatch()
  assert.equal(versus.players.length, MAX_SEATS)
  assert.deepEqual(versus.players.map(player => player.present), [true, true, false, false])
  assert.equal(versus.seated.length, 2)
  // The two nobody is in have no snake at all.
  assert.equal(versus.players[2].snake.length, 0)
  assert.equal(versus.players[3].snake.length, 0)
  assert.equal(versus.turn(2, 0, 1), false)
})

test("four spawns, all of them the first one moved by a symmetry of the board", () => {
  const versus = foursome()
  const snakes = versus.players.map(player => player.snake)
  for (const snake of snakes) assert.equal(snake.length, 3)

  // No two of them share a cell, and each faces inwards.
  const seen = new Set()
  for (const snake of snakes) {
    for (const cell of snake) {
      const key = `${cell.x},${cell.y}`
      assert.ok(!seen.has(key), `two snakes spawned on ${key}`)
      seen.add(key)
    }
  }
  assert.deepEqual(versus.players[0].direction, { x: 1, y: 0 })
  assert.deepEqual(versus.players[1].direction, { x: -1, y: 0 })
  assert.deepEqual(versus.players[2].direction, { x: 1, y: 0 })
  assert.deepEqual(versus.players[3].direction, { x: -1, y: 0 })

  // Seat two is seat zero reflected top to bottom, and seat three is seat one.
  versus.players[0].snake.forEach((cell, index) => {
    assert.deepEqual(versus.players[2].snake[index], flipRow(cell, versus.columns, versus.rows))
  })
  versus.players[1].snake.forEach((cell, index) => {
    assert.deepEqual(versus.players[3].snake[index], flipRow(cell, versus.columns, versus.rows))
  })
})

test("with more than two on the board the layouts match top to bottom as well", () => {
  for (let round = 1; round <= 8; ++round) {
    const obstacles = versusObstacles(round, VERSUS_COLUMNS, VERSUS_ROWS, 4)
    for (const cell of obstacles) {
      for (const twin of [
        mirrorCell(cell, VERSUS_COLUMNS, VERSUS_ROWS),
        flipRow(cell, VERSUS_COLUMNS, VERSUS_ROWS)
      ]) {
        assert.ok(obstacles.some(other => other.x === twin.x && other.y === twin.y),
          `round ${round} has a wall at ${cell.x},${cell.y} with nothing opposite it`)
      }
    }
  }
})

test("no arrangement lands on any of the four spawns", () => {
  for (const seats of [2, 3, 4]) {
    const zone = spawnZone(VERSUS_COLUMNS, VERSUS_ROWS, seats)
    for (let round = 1; round <= 8; ++round) {
      for (const cell of versusObstacles(round, VERSUS_COLUMNS, VERSUS_ROWS, seats)) {
        assert.ok(!zone.some(spot => spot.x === cell.x && spot.y === cell.y),
          `${seats} seats, round ${round}: a wall at ${cell.x},${cell.y}`)
      }
    }
  }
})

test("a round of four runs on after the first death", () => {
  const versus = foursome()
  // Seat two into a wall, with the other three well clear of it.
  versus.obstacles = [{ x: 9, y: 9 }]
  place(versus, 2, [[8, 9], [7, 9], [6, 9]], [1, 0])
  versus.tick()

  assert.equal(versus.players[2].alive, false)
  assert.equal(versus.phase, PHASE_PLAYING, "three of them are still playing")
  assert.equal(versus.alive.length, 3)
  assert.equal(versus.roundWinner, null)
})

test("a dead snake is off the board on the next tick", () => {
  const versus = foursome()
  versus.obstacles = [{ x: 9, y: 9 }]
  place(versus, 2, [[8, 9], [7, 9], [6, 9]], [1, 0])
  versus.tick()
  // Left where it fell for the frame that killed it...
  assert.ok(versus.players[2].snake.length > 0)
  versus.tick()
  // ...and gone by the next, so nothing can crash into a body it cannot see.
  assert.equal(versus.players[2].snake.length, 0)
})

test("the round goes to the last one standing", () => {
  const versus = foursome()
  versus.obstacles = [{ x: 9, y: 9 }, { x: 9, y: 12 }, { x: 9, y: 15 }]
  place(versus, 0, [[8, 9], [7, 9], [6, 9]], [1, 0])
  place(versus, 2, [[8, 12], [7, 12], [6, 12]], [1, 0])
  place(versus, 3, [[8, 15], [7, 15], [6, 15]], [1, 0])
  place(versus, 1, [[20, 3], [21, 3], [22, 3]], [-1, 0])
  versus.tick()

  assert.equal(versus.phase, PHASE_ROUND_OVER)
  assert.equal(versus.roundWinner, 1)
  assert.equal(versus.players[1].wins, 1)
})

test("when the last of four go together it is decided on apples", () => {
  const versus = foursome()
  versus.players[2].alive = false
  versus.players[3].alive = false
  versus.players[0].score = 4
  versus.players[1].score = 2
  versus.obstacles = [{ x: 6, y: 5 }, { x: 6, y: 9 }]
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[5, 9], [4, 9], [3, 9]], [1, 0])
  versus.tick()

  assert.equal(versus.roundWinner, 0)
  assert.equal(versus.players[0].wins, 1)
})

test("a seat that is not playing cannot take a round", () => {
  const versus = foursome()
  versus.players[3].present = false
  versus.obstacles = [{ x: 9, y: 9 }, { x: 9, y: 12 }]
  place(versus, 0, [[8, 9], [7, 9], [6, 9]], [1, 0])
  place(versus, 2, [[8, 12], [7, 12], [6, 12]], [1, 0])
  place(versus, 1, [[20, 3], [21, 3], [22, 3]], [-1, 0])
  versus.tick()

  assert.equal(versus.roundWinner, 1)
  assert.equal(versus.players[3].wins, 0)
})

test("a snapshot carries who is playing", () => {
  const versus = foursome()
  versus.players[3].present = false
  const watcher = new Versus()
  watcher.applySnapshot(JSON.parse(JSON.stringify(versus.snapshot())))
  assert.deepEqual(watcher.players.map(p => p.present), [true, true, true, false])
  assert.deepEqual(watcher.snapshot(), versus.snapshot())
})

test("the four default faces are four different faces", () => {
  const versus = foursome()
  const heads = versus.players.map(player => player.head)
  assert.equal(new Set(heads).size, 4)
})

test("presence can be changed between matches, so a late arrival plays the next one", () => {
  const versus = new Versus({ random: () => 0 })
  versus.startMatch()
  assert.equal(versus.seated.length, 2)

  versus.setPresent([true, true, true, true])
  versus.startMatch()
  assert.equal(versus.seated.length, 4)
  for (const player of versus.players) assert.equal(player.snake.length, 3)
})

// --- the clock ----------------------------------------------------------------

test("a round is two minutes, and the longest snake takes it when they run out", () => {
  const versus = arena()
  assert.equal(versus.remainingMs, ROUND_TIME_MS)

  // One of them has been eating.
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[20, 9], [21, 9], [22, 9], [23, 9], [24, 9]], [-1, 0])

  versus.advance(ROUND_TIME_MS)
  assert.equal(versus.remainingMs, 0)
  assert.equal(versus.phase, PHASE_ROUND_OVER)
  assert.equal(versus.roundWinner, 1)
  assert.equal(versus.players[1].wins, 1)
  // Nobody died of the clock.
  assert.equal(versus.players[0].alive, true)
})

test("apples break a tie in length, and nothing breaks a tie in both", () => {
  const versus = arena()
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(versus, 1, [[20, 9], [21, 9], [22, 9]], [-1, 0])
  versus.players[1].score = 3
  versus.advance(ROUND_TIME_MS)
  assert.equal(versus.roundWinner, 1)

  const level = arena()
  place(level, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  place(level, 1, [[20, 9], [21, 9], [22, 9]], [-1, 0])
  level.advance(ROUND_TIME_MS)
  assert.equal(level.roundWinner, DRAW)
})

test("the clock only runs while the board does", () => {
  const versus = new Versus({ random: () => 0 })
  versus.startMatch()
  assert.equal(versus.phase, PHASE_COUNTDOWN)
  versus.advance(COUNTDOWN_MS)
  assert.equal(versus.remainingMs, ROUND_TIME_MS, "a countdown is not part of the round")

  versus.advance(5000)
  assert.equal(versus.remainingMs, ROUND_TIME_MS - 5000)
})

test("the clock starts again with each round", () => {
  const versus = arena()
  versus.advance(30000)
  assert.ok(versus.remainingMs < ROUND_TIME_MS)
  versus.obstacles = [{ x: 6, y: 5 }]
  place(versus, 0, [[5, 5], [4, 5], [3, 5]], [1, 0])
  versus.tick()
  versus.advance(ROUND_OVER_MS)
  assert.equal(versus.remainingMs, ROUND_TIME_MS)
})
