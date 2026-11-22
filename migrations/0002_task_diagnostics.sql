CREATE TABLE collection_runs_v2 (
  task TEXT NOT NULL,
  minute INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  PRIMARY KEY(task, minute)
);
INSERT INTO collection_runs_v2 SELECT 'minute', minute, created_at, status, error FROM collection_runs;
DROP TABLE collection_runs;
ALTER TABLE collection_runs_v2 RENAME TO collection_runs;
CREATE INDEX runs_created ON collection_runs(created_at);
