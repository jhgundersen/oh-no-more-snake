// The charts: posting a finished run, and reading the four boards back.
//
// Nothing identifying is sent. A run is a score, whether it was Levels or
// Endless, whether Party Mode was on, and when it ended — there is no name to
// enter and nowhere to put one.

import { levelName } from "./Game.js"

const ENDPOINT = "api/scores"
const RUNS_ENDPOINT = "api/runs"
const PENDING_KEY = "omasnake/scores/pending"

export const PERIOD_LABELS = {
  day: "24 hours",
  week: "7 days",
  month: "30 days",
  all: "All time"
}

// `crypto.randomUUID` exists only in a secure context, so over plain http —
// a phone pointed at a laptop on the LAN, say — it is simply not there, and
// asking for one threw where the score was posted. `getRandomValues` has no
// such restriction, and a version 4 UUID is only sixteen bytes with six bits
// pinned, so this needs nothing the page cannot have.
export function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; ++i) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 1

  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0"))
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-")
}

// A run that could not be posted waits in local storage rather than being
// lost — the next game over sends it along with its own.
function readPending(store) {
  try {
    const raw = store.getItem(PENDING_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.slice(0, 20) : []
  } catch {
    return []
  }
}

function writePending(store, runs) {
  try {
    store.setItem(PENDING_KEY, JSON.stringify(runs.slice(0, 20)))
  } catch {
    // A full or locked-down store just means the queue does not survive.
  }
}

export class Charts {
  constructor({ store, onChange = () => {} }) {
    this.store = store
    this.onChange = onChange
    this.boards = null
    this.runs = 0
    this.state = "idle" // idle | loading | ready | error
    this.submitting = false
    this.token = null
  }

  // Taken at the start of a run, not the end. The server stamps it with its
  // own clock and reads its own clock again when the score arrives, so how
  // long the run took is never something this page gets to claim.
  async startRun() {
    this.token = null
    try {
      const response = await fetch(RUNS_ENDPOINT, { method: "POST" })
      if (!response.ok) return
      this.token = (await response.json()).token || null
    } catch {
      // No token, no chart entry. The game itself does not care.
    }
  }

  async load() {
    if (this.state === "loading") return
    this.state = this.boards ? this.state : "loading"
    this.onChange()
    try {
      const response = await fetch(ENDPOINT, { headers: { accept: "application/json" } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      this.apply(await response.json())
    } catch {
      this.state = "error"
      this.onChange()
    }
  }

  apply(payload) {
    this.boards = payload.periods || null
    this.runs = Number(payload.runs || 0)
    this.state = this.boards ? "ready" : "error"
    this.onChange()
  }

  // Called once per finished run. Failures queue and are retried on the next
  // one, which is why this never rejects.
  async submit(run) {
    try {
      await this.post(run)
    } catch {
      // Nothing about posting a score is worth interrupting a game over for.
      this.submitting = false
    }
  }

  async post(run) {
    const queued = readPending(this.store)
    // A run with no token cannot be charted, so it is not worth queueing.
    if (run && this.token) {
      queued.push({ ...run, eventId: uuid(), token: this.token })
      this.token = null
    }
    if (!queued.length || this.submitting) return
    this.submitting = true

    const remaining = []
    for (const entry of queued) {
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(entry)
        })
        if (response.ok) {
          this.apply(await response.json())
          continue
        }
        // A rejected run is a run the server will never take. Only keep the
        // ones that failed for a reason that might pass later.
        if (response.status >= 500 || response.status === 429) remaining.push(entry)
      } catch {
        remaining.push(entry)
      }
    }

    writePending(this.store, remaining)
    this.submitting = false
  }
}

// "3 minutes ago" out of an SQLite `datetime('now')` string, which is UTC with
// a space instead of a T and no zone marker.
export function relativeTime(value, now = Date.now()) {
  const parsed = Date.parse(/[TZ]/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(parsed)) return ""
  const seconds = Math.max(0, Math.round((now - parsed) / 1000))
  if (seconds < 60) return "just now"
  const units = [
    ["minute", 60],
    ["hour", 60],
    ["day", 24],
    ["week", 7]
  ]
  let amount = seconds
  let label = "second"
  for (const [name, size] of units) {
    if (amount < size) break
    amount = Math.floor(amount / size)
    label = name
  }
  return `${amount} ${label}${amount === 1 ? "" : "s"} ago`
}

// The shape of a run, for the line under the score.
export function describeRun(entry) {
  const parts = [entry.mode === "endless" ? "Endless" : `Level ${levelName(entry.level)}`]
  if (entry.party) parts.push("Party")
  return parts.join(" · ")
}
