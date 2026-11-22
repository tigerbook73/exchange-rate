CREATE TABLE collection_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  dataset_id TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  revision INTEGER NOT NULL DEFAULT 0,
  cursor_floor INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempt_minute INTEGER
);
INSERT INTO collection_state (id) VALUES (1);
CREATE TABLE intraday_points (
  minute INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL
);
CREATE INDEX intraday_date ON intraday_points(date);
CREATE TABLE daily_rates (
  date TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL
);
CREATE TABLE collection_runs (
  minute INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT
);
CREATE TABLE sync_changes (
  revision INTEGER NOT NULL,
  entity TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (revision, entity, entity_key)
);
CREATE INDEX changes_created ON sync_changes(created_at);
