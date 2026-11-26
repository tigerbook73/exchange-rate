// Deployment preflight uses this incompatible structure generation, not a D1 migration number,
// API protocol number, or changing quote revision. Additive migrations stay on 1.
export const DATABASE_SCHEMA = 1;
export class DatabaseSchemaError extends Error {
  constructor() {
    super("数据库结构尚未与当前服务兼容");
  }
}
export function assertDatabaseSchema(version: number) {
  if (version !== DATABASE_SCHEMA) throw new DatabaseSchemaError();
}

/** Explicit deployment/local preflight, never a per-request/cron query. */
export async function checkDatabaseCompatibility(db: D1Database) {
  const row = await db
    .prepare("SELECT schema_version, write_id FROM collection_state WHERE id=1")
    .first<{ schema_version: number; write_id: string | null }>();
  if (!row) throw new Error("Database not initialized");
  assertDatabaseSchema(row.schema_version);
  await db
    .prepare(
      "SELECT (SELECT low_units FROM push_devices LIMIT 1) AS low_units, (SELECT status FROM push_events LIMIT 1) AS status",
    )
    .first();
  const alertIndex = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='push_events_device_kind'",
    )
    .first();
  if (!alertIndex) throw new DatabaseSchemaError();
}
