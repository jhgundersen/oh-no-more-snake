// Two routes and the static game. There is no session, no cookie and no name
// anywhere in here: a run is a score, a shape and a timestamp.

import {
  BOARD_SIZE,
  MAX_SUBMISSIONS_PER_MINUTE,
  PERIODS,
  boardStatement,
  clientHash,
  implausible,
  json,
  parseScoreReport,
  shapeBoard
} from "./scores.js"
import { issueRunToken, readRunToken } from "./runtoken.js"

const PERIOD_NAMES = Object.keys(PERIODS)

async function readBoards(env) {
  const statements = PERIOD_NAMES.map(name => boardStatement(env.DB, PERIODS[name]))
  statements.push(env.DB.prepare("SELECT COUNT(*) AS runs FROM scores"))
  const results = await env.DB.batch(statements)

  const periods = {}
  PERIOD_NAMES.forEach((name, index) => {
    periods[name] = shapeBoard(results[index].results)
  })
  return {
    periods,
    runs: Number(results[PERIOD_NAMES.length].results?.[0]?.runs || 0),
    size: BOARD_SIZE
  }
}

async function withinRateLimit(request, env) {
  const hash = await clientHash(request, env.RATE_LIMIT_SALT)
  const bucket = Math.floor(Date.now() / 60000)
  const row = await env.DB.prepare(`
    INSERT INTO submission_limits (client_hash, minute_bucket, submissions)
    VALUES (?, ?, 1)
    ON CONFLICT(client_hash, minute_bucket)
    DO UPDATE SET submissions = submissions + 1
    RETURNING submissions
  `).bind(hash, bucket).first()
  return Number(row?.submissions || 1) <= MAX_SUBMISSIONS_PER_MINUTE
}

async function recordScore(request, env) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: "invalid JSON" }, 400)
  }
  const report = parseScoreReport(body)
  if (!report) return json({ error: "expected an eventId, a score, a mode and a party flag" }, 400)

  const run = await readRunToken(env.RUN_TOKEN_SECRET, body.token)
  if (!run) return json({ error: "a run token issued by POST /api/runs is required" }, 400)

  // Both ends of the clock are the server's, so the page never gets to say how
  // long its own run took.
  const refusal = implausible(report.score, report.mode, Date.now() - run.issuedAt)
  if (refusal) return json({ error: refusal }, 422)

  if (!(await withinRateLimit(request, env))) {
    return json({ error: "too many scores; try again shortly" }, 429, { "retry-after": "60" })
  }

  // Two constraints, one statement. OR IGNORE on the event id makes a retry of
  // the same run safe, and the unique index on run_id makes a second score off
  // one token impossible.
  await env.DB.prepare(`
    INSERT OR IGNORE INTO scores (event_id, run_id, score, level, mode, party)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(report.eventId, run.nonce, report.score, report.level, report.mode, report.party ? 1 : 0).run()

  return json(await readBoards(env))
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Signing is stateless, so handing these out costs nothing and needs no
    // rate limit. Holding one is not the scarce thing — the time it measures is.
    if (url.pathname === "/api/runs") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { allow: "POST" })
      if (!env.RUN_TOKEN_SECRET) return json({ error: "run tokens are not configured" }, 503)
      const { token } = await issueRunToken(env.RUN_TOKEN_SECRET)
      return json({ token }, 200, { "cache-control": "no-store" })
    }

    if (url.pathname === "/api/scores") {
      if (request.method === "GET") {
        // Half a minute of staleness is not worth a database round trip per
        // reader, and the charts are not a live scoreboard.
        return json(await readBoards(env), 200, { "cache-control": "public, max-age=30" })
      }
      if (request.method === "POST") {
        if (!env.RUN_TOKEN_SECRET) return json({ error: "run tokens are not configured" }, 503)
        return recordScore(request, env)
      }
      return json({ error: "method not allowed" }, 405, { allow: "GET, POST" })
    }
    return env.ASSETS.fetch(request)
  }
}
