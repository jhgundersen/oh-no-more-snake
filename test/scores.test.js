// Validation for the charts endpoint. Everything here is reachable by anyone
// with curl, so the tests are mostly about what gets refused.

import test from "node:test"
import assert from "node:assert/strict"

import { MAX_SCORE, PERIODS, parseScoreReport, shapeBoard } from "../src/scores.js"

const ID = "550e8400-e29b-41d4-a716-446655440000"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
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

// --- run tokens and plausibility -------------------------------------------

import { ENDLESS_CEILING, MAX_RUN_MS, implausible } from "../src/scores.js"
import { issueRunToken, readRunToken } from "../src/runtoken.js"

const SECRET = "a-test-secret-nobody-deploys"
const minute = 60 * 1000

test("a token round-trips, and a forged one does not", async () => {
  const issued = await issueRunToken(SECRET, 1_000_000)
  const read = await readRunToken(SECRET, issued.token)
  assert.equal(read.nonce, issued.nonce)
  assert.equal(read.issuedAt, 1_000_000)

  // Signed by somebody else.
  assert.equal(await readRunToken("a-different-secret", issued.token), null)
  // Payload edited to back-date the run, signature left alone.
  const [, signature] = issued.token.split(".")
  const forged = Buffer.from(JSON.stringify({ n: issued.nonce, t: 1 })).toString("base64url")
  assert.equal(await readRunToken(SECRET, `${forged}.${signature}`), null)
})

test("junk is not a token", async () => {
  for (const value of [null, undefined, "", "nope", "a.b", 42, "x".repeat(900)]) {
    assert.equal(await readRunToken(SECRET, value), null, `accepted ${String(value).slice(0, 20)}`)
  }
})

test("a made-up score is refused for the time it claims to have taken", () => {
  // The attack this exists for: a large number, posted immediately.
  assert.ok(implausible(99999, "levels", 3000))
  assert.ok(implausible(5000, "levels", 1000))
  // And the same number after a plausible amount of play is still refused,
  // because the levels it implies could not have been faded through.
  assert.ok(implausible(99999, "levels", 10 * minute))
})

test("real runs are accepted", () => {
  assert.equal(implausible(23, "levels", 45 * 1000), null)
  assert.equal(implausible(12, "levels", 20 * 1000), null)
  assert.equal(implausible(300, "endless", 12 * minute), null)
  // A strong party run: high scoring, but over a real stretch of time.
  assert.equal(implausible(900, "levels", 8 * minute), null)
})

test("the level-transition floor is a real rule, not shadowed by the rate one", () => {
  // 500 points in 40s sits well inside the points-per-second allowance of 630,
  // and is still refused: it claims 37 levels, and 36 fades cannot fit in 40s.
  assert.match(implausible(500, "levels", 40 * 1000), /levels/)
  assert.equal(implausible(500, "levels", 70 * 1000), null)
})

test("endless is capped by the board, however long it took", () => {
  assert.equal(implausible(ENDLESS_CEILING, "endless", 30 * minute), null)
  assert.ok(implausible(ENDLESS_CEILING + 1, "endless", 30 * minute))
  // Levels resets the board every level, so the same score is fine there.
  assert.equal(implausible(ENDLESS_CEILING + 1, "levels", 60 * minute), null)
})

test("a token cannot be left to mature, and time cannot run backwards", () => {
  assert.ok(implausible(10, "levels", MAX_RUN_MS + 1))
  assert.ok(implausible(10, "levels", -1))
  assert.ok(implausible(10, "levels", Number.NaN))
})

// --- event ids --------------------------------------------------------------

import { uuid } from "../public/snake/Scores.js"

test("an event id can be made without crypto.randomUUID", () => {
  // Over plain http the page is not a secure context and `crypto.randomUUID`
  // does not exist. Asking for one threw, and the score never left the page.
  const real = globalThis.crypto.randomUUID
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true })
    const made = Array.from({ length: 500 }, uuid)
    for (const id of made) assert.match(id, UUID_PATTERN, `${id} is not a UUID the server would take`)
    assert.equal(new Set(made).size, made.length, "and they are not all the same one")
    // Version 4, variant 1, as the pattern the endpoint accepts requires.
    assert.ok(made.every(id => id[14] === "4" && "89ab".includes(id[19])))
  } finally {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: real, configurable: true })
  }
})

test("the event ids it makes are the ones the endpoint accepts", () => {
  const report = parseScoreReport({ eventId: uuid(), score: 40, mode: "levels", party: false })
  assert.ok(report, "a freshly minted id is refused by our own validator")
})
