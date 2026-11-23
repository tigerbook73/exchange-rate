import { addDays, getBeijingDateString } from "./date";
import { dayStart, retainedDate } from "./intraday";
import type { RateRecord } from "./rates-db";
import {
  emptyCollectionState,
  SYNC_SCHEMA,
  type CollectionState,
  type IntradayPoint,
  type SyncResponse,
} from "./server-types";

interface MetaRow {
  schema_version: number;
  dataset_id: string;
  revision: number;
  cursor_floor: number;
  state_json: string;
  gap_source_json?: string | null;
}
interface SnapshotRow extends MetaRow {
  daily_json: string;
  points_json: string;
  deleted_json: string;
}
export class ResetRequired extends Error {}

export async function readMeta(db: D1Database, fillThrough?: string) {
  // Read the tail's real anchor only when a new Beijing day needs maintenance,
  // in the same snapshot and round trip as the collection state.
  const gapSource = fillThrough
    ? `, CASE WHEN COALESCE(json_extract(state_json, '$.dailyFilledThrough'), '') < ?
       THEN (SELECT value_json FROM daily_rates WHERE date <= ?
         AND json_extract(value_json, '$.source') != 'carried-forward'
         ORDER BY date DESC LIMIT 1) END AS gap_source_json`
    : "";
  let query = db.prepare(
    `SELECT schema_version, dataset_id, revision, cursor_floor, state_json${gapSource} FROM collection_state WHERE id = 1`,
  );
  if (fillThrough) query = query.bind(fillThrough, fillThrough);
  const row = await query.first<MetaRow>();
  if (!row) throw new Error("Database not initialized");
  return {
    ...row,
    gapSource: row.gap_source_json
      ? (JSON.parse(row.gap_source_json) as RateRecord)
      : null,
    state: {
      ...emptyCollectionState(),
      ...JSON.parse(row.state_json),
    } as CollectionState,
  };
}

/** A single SQL read gives current entities and cursor the same database snapshot. */
export async function readSync(
  db: D1Database,
  cursor: string | null,
  now = Date.now(),
): Promise<SyncResponse> {
  let revision = -1;
  let dataset = "";
  if (cursor) {
    const match = /^([a-f0-9]{32})\.(\d+)$/.exec(cursor);
    if (!match || !Number.isSafeInteger(Number(match[2])))
      throw new ResetRequired();
    dataset = match[1];
    revision = Number(match[2]);
  }
  const from = retainedDate(now);
  const historyFrom = addDays(getBeijingDateString(new Date(now)), -365);
  const meta = await db
    .prepare(
      `SELECT schema_version, dataset_id, revision, cursor_floor, state_json,
    (SELECT json_group_array(json(value_json)) FROM (SELECT value_json FROM daily_rates INDEXED BY daily_revision WHERE date >= ? AND revision > ? ORDER BY date)) AS daily_json,
    (SELECT json_group_array(json(value_json)) FROM (SELECT value_json FROM intraday_points INDEXED BY intraday_revision WHERE date >= ? AND revision > ? ORDER BY minute)) AS points_json,
    (SELECT json_group_array(entity_key) FROM (SELECT DISTINCT entity_key FROM sync_changes WHERE revision > ? AND entity = 'daily' AND NOT EXISTS (SELECT 1 FROM daily_rates WHERE date = entity_key))) AS deleted_json
    FROM collection_state WHERE id = 1`,
    )
    .bind(historyFrom, revision, from, revision, revision)
    .first<SnapshotRow>();
  if (!meta) throw new Error("Database not initialized");
  if (
    cursor &&
    (dataset !== meta.dataset_id ||
      revision < meta.cursor_floor ||
      revision > meta.revision)
  )
    throw new ResetRequired();
  const state: CollectionState = {
    ...emptyCollectionState(),
    ...JSON.parse(meta.state_json),
  };
  if (
    state.live &&
    (state.live.minute < dayStart(from) ||
      state.live.minute <= Math.floor(now / 300000) * 300000 ||
      now - state.live.minute > 300000)
  )
    state.live = null;
  return {
    schema: SYNC_SCHEMA,
    datasetId: meta.dataset_id,
    revision: meta.revision,
    cursor: `${meta.dataset_id}.${meta.revision}`,
    mode: cursor ? "delta" : "snapshot",
    generatedAt: new Date(now).toISOString(),
    retainedFrom: from,
    historyFrom,
    daily: JSON.parse(meta.daily_json),
    points: JSON.parse(meta.points_json),
    deletedDaily: JSON.parse(meta.deleted_json),
    deletedPoints: [],
    state,
  };
}

export async function commitCollection(
  db: D1Database,
  expectedRevision: number,
  state: CollectionState,
  points: IntradayPoint[],
  daily: RateRecord[],
  now: number,
  task: "minute" | "history" | "demo" | "repair" = "minute",
) {
  const revision = expectedRevision + 1;
  // A write marker fences this atomic batch without a lock, lease or release.
  // A losing revision must not write entities using the winning revision.
  const token = crypto.randomUUID();
  const guard =
    "EXISTS (SELECT 1 FROM collection_state WHERE id = 1 AND write_id = ? AND revision = ?)";
  const commands = [
    db
      .prepare(
        `UPDATE collection_state SET state_json = ?, revision = ?, write_id = ?
         WHERE id = 1 AND revision = ?
         AND (? != 'minute' OR COALESCE(json_extract(state_json, '$.lastAttemptMinute'), -1) < ?)`,
      )
      .bind(
        JSON.stringify(state),
        revision,
        token,
        expectedRevision,
        task,
        state.lastAttemptMinute,
      ),
  ];
  if (points.length)
    commands.push(
      db
        .prepare(
          `INSERT INTO intraday_points (minute, date, value_json, revision)
    SELECT json_extract(value, '$.minute'), strftime('%Y-%m-%d', json_extract(value, '$.minute') / 1000 + 28800, 'unixepoch'), value, ?
    FROM json_each(?) WHERE ${guard}
    ON CONFLICT(minute) DO UPDATE SET value_json = excluded.value_json, revision = excluded.revision`,
        )
        .bind(revision, JSON.stringify(points), token, revision),
    );
  if (daily.length)
    commands.push(
      db
        .prepare(
          `INSERT INTO daily_rates (date, value_json, revision)
    SELECT json_extract(value, '$.date'), value, ? FROM json_each(?) WHERE ${guard}
    ON CONFLICT(date) DO UPDATE SET value_json = excluded.value_json, revision = excluded.revision
    WHERE json_extract(excluded.value_json, '$.source') != 'carried-forward'
       OR (json_extract(daily_rates.value_json, '$.source') = 'carried-forward'
           AND (json_extract(daily_rates.value_json, '$.huiSell') != json_extract(excluded.value_json, '$.huiSell')
             OR json_extract(daily_rates.value_json, '$.carriedFromDate') IS NOT json_extract(excluded.value_json, '$.carriedFromDate')))`,
        )
        .bind(revision, JSON.stringify(daily), token, revision),
    );
  if (daily.length)
    commands.push(
      db
        .prepare(
          `INSERT INTO sync_changes (revision, entity, entity_key, created_at)
    SELECT ?, 'daily', date, ? FROM daily_rates WHERE revision = ? AND ${guard}`,
        )
        .bind(revision, now, revision, token, revision),
    );
  commands.push(
    db
      .prepare(
        `INSERT INTO sync_changes (revision, entity, entity_key, created_at) SELECT ?, 'state', 'aud', ? WHERE ${guard}`,
      )
      .bind(revision, now, token, revision),
  );
  const result = await db.batch(commands);
  return result[0].meta.changes === 1;
}

/** Bounded maintenance; readers enforce the retention boundary even if this fails. */
export async function cleanupDatabase(db: D1Database, now: number) {
  const changesBefore = now - 3 * 86_400_000;
  await db.batch([
    db
      .prepare(
        "DELETE FROM intraday_points WHERE minute IN (SELECT minute FROM intraday_points WHERE date < ? LIMIT 400)",
      )
      .bind(retainedDate(now)),
    db
      .prepare(
        "DELETE FROM collection_runs WHERE rowid IN (SELECT rowid FROM collection_runs WHERE created_at < ? LIMIT 500)",
      )
      .bind(now - 30 * 86_400_000),
    db
      .prepare(
        "UPDATE collection_state SET cursor_floor = max(cursor_floor, COALESCE((SELECT max(revision) FROM (SELECT revision FROM sync_changes WHERE created_at < ? ORDER BY revision LIMIT 500)), 0)) WHERE id = 1",
      )
      .bind(changesBefore),
    db
      .prepare(
        "DELETE FROM sync_changes WHERE rowid IN (SELECT rowid FROM sync_changes WHERE created_at < ? AND revision <= (SELECT cursor_floor FROM collection_state WHERE id = 1) ORDER BY revision LIMIT 500)",
      )
      .bind(changesBefore),
  ]);
}
