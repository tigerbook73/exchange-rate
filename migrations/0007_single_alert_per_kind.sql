DELETE FROM push_events WHERE created_at <= unixepoch('now') * 1000 - 86400000;
DELETE FROM push_events WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY device_id, kind ORDER BY created_at DESC, rowid DESC) AS position
    FROM push_events
  ) WHERE position > 1
);
CREATE UNIQUE INDEX push_events_device_kind ON push_events(device_id, kind);
