// Validation, shaping and the SQL windows behind the charts.
//
// Treat the boards as a community gimmick, not a trustworthy leaderboard.
// Anybody can post a number to a public endpoint; what this file does is keep
// the damage bounded, idempotent and rate-limited, which is as far as a game
// with no accounts can reasonably go.

import { levelForScore } from "../public/snake/Game.js"

export const MAX_SCORE = 100000
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
