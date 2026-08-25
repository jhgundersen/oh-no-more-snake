// Validation for the charts endpoint. Everything here is reachable by anyone
// with curl, so the tests are mostly about what gets refused.

import test from "node:test"
import assert from "node:assert/strict"

import { MAX_SCORE, PERIODS, parseScoreReport, shapeBoard } from "../src/scores.js"

const ID = "550e8400-e29b-41d4-a716-446655440000"
const valid = { eventId: ID, score: 40, mode: "levels", party: false }

test("a well-formed report is accepted", () => {
  const report = parseScoreReport(valid)
  assert.equal(report.eventId, ID)
  assert.equal(report.score, 40)
  assert.equal(report.mode, "levels")
  assert.equal(report.party, false)
})

test("the level is derived, never accepted", () => {
  // 40 points is level 4: 12 + 12 + 12 clears three, and 4 remain.
  assert.equal(parseScoreReport({ ...valid, level: 999 }).level, 4)
  assert.equal(parseScoreReport({ ...valid, mode: "endless", level: 999 }).level, 1)
})

test("malformed reports are refused", () => {
  const bad = [
    null,
    "not an object",
    { ...valid, eventId: "nope" },
    { ...valid, eventId: undefined },
    { ...valid, score: 0 },
    { ...valid, score: -5 },
    { ...valid, score: 1.5 },
    { ...valid, score: MAX_SCORE + 1 },
    { ...valid, score: "40" },
    { ...valid, mode: "cheating" },
    { ...valid, party: "yes" }
  ]
  for (const body of bad) assert.equal(parseScoreReport(body), null, `accepted ${JSON.stringify(body)}`)
})

test("the boards are the four documented windows", () => {
  assert.deepEqual(Object.keys(PERIODS), ["day", "week", "month", "all"])
  assert.equal(PERIODS.all, null, "all time has no window")
})

test("rows are ranked in the order the query returned them", () => {
  const rows = [
    { score: 90, level: 8, mode: "levels", party: 1, created_at: "2026-08-25 09:00:00" },
    { score: 12, level: 1, mode: "endless", party: 0, created_at: "2026-08-25 08:00:00" }
  ]
  const board = shapeBoard(rows)
  assert.equal(board[0].rank, 1)
  assert.equal(board[0].party, true)
  assert.equal(board[1].rank, 2)
  assert.equal(board[1].party, false)
  assert.deepEqual(shapeBoard(undefined), [], "an empty board is a board")
})
