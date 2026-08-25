-- A run token is spent when the score it signed is stored, so one token can
-- only ever produce one row. Older rows predate tokens and are left NULL:
-- SQLite lets a unique index hold any number of NULLs.
ALTER TABLE scores ADD COLUMN run_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS scores_run_id ON scores (run_id);
