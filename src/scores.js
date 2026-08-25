// Validation, shaping and the SQL windows behind the charts.
//
// Treat the boards as a community gimmick, not a trustworthy leaderboard.
// Anybody can post a number to a public endpoint; what this file does is keep
// the damage bounded, idempotent and rate-limited, which is as far as a game
// with no accounts can reasonably go.

import { COLUMNS, ROWS, levelForScore } from "../public/snake/Game.js"

export const MAX_SCORE = 100000

// How long a token stays spendable. Longer than any real run, short enough
// that one cannot be left to mature into a large allowance.
export const MAX_RUN_MS = 2 * 60 * 60 * 1000

// Every point scored is also a block the snake grows by, and the run ends when
// there is nowhere left to put one. Endless never resets the board, so the
// whole mode is capped by the board's area — a structural limit, not a guess.
export const ENDLESS_CEILING = COLUMNS * ROWS

// This one is a plausibility ceiling rather than a physical one. The game's own
// limits would allow far more — eighteen ticks a second, ten points a food —
// but nothing human comes close to a sustained fifteen, and the point is to
// make "ninety thousand in three seconds" arithmetic instead of opinion.
const POINTS_PER_SECOND = 15
const OPENING_ALLOWANCE = 30

// A level cannot be cleared faster than the board can fade out and back in,
// and those two are what the level-clear screen is made of.
const LEVEL_TRANSITION_MS = 750 + 900
export const MAX_SUBMISSIONS_PER_MINUTE = 10
export const BOARD_SIZE = 10

// Rolling windows rather than calendar ones: no timezone has to be picked, and
// "the last 24 hours" means the same thing to everybody reading it.
export const PERIODS = {
  day: "-1 day",
  week: "-7 days",
  month: "-30 days",
  all: null
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseScoreReport(body) {
  if (!body || typeof body !== "object") return null
  const { eventId, score, mode, party } = body
  if (typeof eventId !== "string" || !UUID.test(eventId)) return null
  if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) return null
  if (mode !== "levels" && mode !== "endless") return null
  if (typeof party !== "boolean") return null
  // The level is never taken from the client. It is a function of the score,
  // so accepting one would only be an invitation to be lied to.
  return {
    eventId,
    score,
    mode,
    party,
    level: mode === "endless" ? 1 : levelForScore(score)
  }
}

// What a run of this score would have had to do, checked against how long the
// server watched it take. Returns a reason to refuse, or null to accept.
export function implausible(score, mode, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "a run cannot end before it started"
  if (elapsedMs > MAX_RUN_MS) return "this run token has expired"

  if (mode === "endless") {
    // Nothing resets the board, so the snake runs out of room long before this.
    if (score > ENDLESS_CEILING) return "endless is capped by the size of the board"
  } else {
    // Each level costs a fade out and a fade in that nothing can skip past.
    const transitions = (levelForScore(score) - 1) * LEVEL_TRANSITION_MS
    if (elapsedMs < transitions) return "too quick for the levels that score would have cleared"
  }

  const allowance = OPENING_ALLOWANCE + (POINTS_PER_SECOND * elapsedMs) / 1000
  if (score > allowance) return "too many points for the time taken"
  return null
}

export async function clientHash(request, salt) {
  const address = request.headers.get("cf-connecting-ip") || "unknown"
  const data = new TextEncoder().encode(`${salt || ""}:${address}`)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

// One statement per board. BOARD_SIZE is a module constant, never user input.
export function boardStatement(db, window) {
  const sql = `
    SELECT score, level, mode, party, created_at
    FROM scores
    ${window ? "WHERE created_at >= datetime('now', ?)" : ""}
    ORDER BY score DESC, created_at ASC
    LIMIT ${BOARD_SIZE}
  `
  const statement = db.prepare(sql)
  return window ? statement.bind(window) : statement
}

export function shapeBoard(rows) {
  return (rows || []).map((row, index) => ({
    rank: index + 1,
    score: Number(row.score),
    level: Number(row.level),
    mode: row.mode,
    party: Boolean(row.party),
    at: row.created_at
  }))
}
