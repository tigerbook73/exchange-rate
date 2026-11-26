CREATE TABLE push_devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json TEXT NOT NULL,
  low_units INTEGER,
  high_units INTEGER,
  low_enabled INTEGER NOT NULL DEFAULT 0,
  high_enabled INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  last_test_at INTEGER NOT NULL DEFAULT 0,
  CHECK (low_units IS NULL OR low_units BETWEEN 1 AND 1000000),
  CHECK (high_units IS NULL OR high_units BETWEEN 1 AND 1000000),
  CHECK (low_units IS NULL OR high_units IS NULL OR low_units < high_units)
);
CREATE TABLE push_events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('low', 'high', 'test')),
  price_units INTEGER,
  threshold_units INTEGER,
  published_at TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'expired', 'cancelled'))
);
CREATE INDEX push_events_due ON push_events(status, next_attempt_at);
CREATE INDEX push_events_device ON push_events(device_id, created_at DESC);
CREATE INDEX push_events_created ON push_events(created_at);
