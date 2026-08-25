-- One row per finished run. There are no names and no accounts: a score, what
-- kind of run produced it, and when. That is the whole record.
CREATE TABLE IF NOT EXISTS scores (
  event_id   TEXT PRIMARY KEY,
  score      INTEGER NOT NULL,
  level      INTEGER NOT NULL,
  mode       TEXT NOT NULL,
  party      INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The four boards are all "highest scores, newest window first", so one index
-- ordered the way they are read serves every one of them.
CREATE INDEX IF NOT EXISTS scores_by_time ON scores (created_at DESC);
CREATE INDEX IF NOT EXISTS scores_by_score ON scores (score DESC, created_at ASC);

-- Submissions per hashed address per minute. The hash is salted with a Worker
-- secret, so this cannot be walked back to an address.
CREATE TABLE IF NOT EXISTS submission_limits (
  client_hash   TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  submissions   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_hash, minute_bucket)
);
