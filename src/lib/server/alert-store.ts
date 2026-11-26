import type {
  AlertSettings,
  AlertStatus,
  AlertNotification,
  DeviceSubscription,
} from "../contracts/alert-types";
import type { QuoteSample } from "../contracts/server-types";
import { ALERT_TTL, MAX_PUSH_DEVICES } from "../domain/price-alerts";
import { sendPush, vapidKeys } from "./push";

export function enqueueAlertStatements(
  db: D1Database,
  quote: QuoteSample,
  now: number,
  writeId: string,
  revision: number,
) {
  return [
    db
      .prepare(
        `INSERT OR IGNORE INTO push_events
      (id, device_id, kind, price_units, threshold_units, published_at, created_at, expires_at, next_attempt_at)
      SELECT d.id || ':' || d.generation || ':' || j.value, d.id, j.value, ?,
        CASE j.value WHEN 'low' THEN d.low_units ELSE d.high_units END, ?, ?, ?, ?
      FROM push_devices d CROSS JOIN json_each('["low","high"]') j
      WHERE d.updated_at <= ? AND ((j.value='low' AND d.low_enabled=1 AND ? <= d.low_units)
        OR (j.value='high' AND d.high_enabled=1 AND ? >= d.high_units))
      AND EXISTS (SELECT 1 FROM collection_state WHERE id=1 AND write_id=? AND revision=?)`,
      )
      .bind(
        quote.priceUnits,
        quote.publishedAt,
        now,
        Math.min(now + ALERT_TTL, Date.parse(quote.publishedAt) + ALERT_TTL),
        now,
        Date.parse(quote.requestedAt),
        quote.priceUnits,
        quote.priceUnits,
        writeId,
        revision,
      ),
    db
      .prepare(
        `UPDATE push_devices SET
      low_enabled=CASE WHEN EXISTS (SELECT 1 FROM push_events WHERE id=push_devices.id || ':' || generation || ':low') THEN 0 ELSE low_enabled END,
      high_enabled=CASE WHEN EXISTS (SELECT 1 FROM push_events WHERE id=push_devices.id || ':' || generation || ':high') THEN 0 ELSE high_enabled END
      WHERE (low_enabled=1 OR high_enabled=1)
      AND EXISTS (SELECT 1 FROM collection_state WHERE id=1 AND write_id=? AND revision=?)`,
      )
      .bind(writeId, revision),
  ];
}
export async function registerDevice(
  db: D1Database,
  id: string,
  tokenHash: string,
  subscription: DeviceSubscription,
  settings: AlertSettings,
  now: number,
) {
  const result = await db
    .prepare(
      `INSERT INTO push_devices (id, token_hash, endpoint, subscription_json, low_units, high_units, low_enabled, high_enabled, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM push_devices) < ?
    ON CONFLICT(endpoint) DO NOTHING`,
    )
    .bind(
      id,
      tokenHash,
      subscription.endpoint,
      JSON.stringify(subscription),
      settings.lowUnits,
      settings.highUnits,
      Number(settings.lowEnabled),
      Number(settings.highEnabled),
      now,
      MAX_PUSH_DEVICES,
    )
    .run();
  return result.meta.changes === 1;
}
export async function readAlertStatus(
  db: D1Database,
  id: string,
): Promise<AlertStatus> {
  const row = await db
    .prepare(
      `SELECT low_units, high_units, low_enabled, high_enabled FROM push_devices WHERE id=?`,
    )
    .bind(id)
    .first<{
      low_units: number | null;
      high_units: number | null;
      low_enabled: number;
      high_enabled: number;
    }>();
  if (!row) throw new Error("设备订阅不存在");
  const events = await db
    .prepare(
      `SELECT kind, status, created_at AS createdAt, price_units AS priceUnits FROM push_events WHERE device_id=? ORDER BY created_at DESC LIMIT 5`,
    )
    .bind(id)
    .all<AlertStatus["recent"][number]>();
  return {
    lowUnits: row.low_units,
    highUnits: row.high_units,
    lowEnabled: Boolean(row.low_enabled),
    highEnabled: Boolean(row.high_enabled),
    recent: events.results,
  };
}
export async function updateAlertSettings(
  db: D1Database,
  id: string,
  settings: AlertSettings,
  now: number,
) {
  await db.batch([
    db
      .prepare(
        `UPDATE push_events SET status='cancelled' WHERE device_id=? AND status='pending'`,
      )
      .bind(id),
    db
      .prepare(
        `UPDATE push_devices SET low_units=?, high_units=?, low_enabled=?, high_enabled=?, generation=generation+1, updated_at=? WHERE id=?`,
      )
      .bind(
        settings.lowUnits,
        settings.highUnits,
        Number(settings.lowEnabled),
        Number(settings.highEnabled),
        now,
        id,
      ),
  ]);
}
export async function enqueueTest(db: D1Database, id: string, now: number) {
  const eventId = crypto.randomUUID();
  // The timestamp fences concurrent requests without a diagnostic write per cron tick.
  const result = await db.batch([
    db
      .prepare(
        `UPDATE push_devices SET last_test_at=? WHERE id=? AND last_test_at <= ?`,
      )
      .bind(now, id, now - 60_000),
    db
      .prepare(
        `INSERT INTO push_events (id, device_id, kind, created_at, expires_at, next_attempt_at)
      SELECT ?, id, 'test', ?, ?, ? FROM push_devices WHERE id=? AND last_test_at=? AND changes()=1`,
      )
      .bind(eventId, now, now + ALERT_TTL, now, id, now),
  ]);
  return result[1].meta.changes === 1;
}
interface PendingEvent {
  id: string;
  device_id: string;
  kind: "low" | "high" | "test";
  price_units: number | null;
  threshold_units: number | null;
  published_at: string | null;
  expires_at: number;
  attempts: number;
}
function notification(event: PendingEvent): AlertNotification {
  const direction = event.kind === "low" ? "低价" : "高价";
  return {
    title: event.kind === "test" ? "汇率提醒已连接" : `澳元${direction}提醒`,
    body:
      event.kind === "test"
        ? "这台设备可以接收汇率通知。"
        : `当前 ¥${(event.price_units! / 10000).toFixed(4)}，已达到 ${event.kind === "low" ? "≤" : "≥"} ¥${(event.threshold_units! / 10000).toFixed(4)}\n报价时间：${event.published_at?.replace("T", " ").replace(/(?:\+08:00|Z)$/, "")}（北京时间）`,
    tag: event.id,
    url: "/",
  };
}
export async function dispatchAlerts(
  db: D1Database,
  rawKeys: string,
  now = Date.now(),
  fetcher = fetch,
) {
  const keys = vapidKeys(rawKeys);
  // Two sends at most per invocation: bounded encryption CPU and network fan-out.
  for (let i = 0; i < 2; i++) {
    const event = await db
      .prepare(
        `UPDATE push_events SET attempts=attempts+1, next_attempt_at=?
      WHERE id=(SELECT id FROM push_events WHERE status='pending' AND next_attempt_at<=? AND expires_at>? AND attempts<3 ORDER BY next_attempt_at, id LIMIT 1)
      RETURNING *`,
      )
      .bind(now + 60_000, now, now)
      .first<PendingEvent>();
    if (!event) break;
    const device = await db
      .prepare(
        `SELECT subscription_json FROM push_devices WHERE id=? AND EXISTS (SELECT 1 FROM push_events WHERE id=? AND status='pending')`,
      )
      .bind(event.device_id, event.id)
      .first<{ subscription_json: string }>();
    if (!device) continue;
    const remaining = Math.ceil((event.expires_at - Date.now()) / 1000);
    if (remaining <= 0) {
      await db
        .prepare(
          "UPDATE push_events SET status='expired' WHERE id=? AND status='pending'",
        )
        .bind(event.id)
        .run();
      continue;
    }
    let status = 0;
    try {
      status = await sendPush(
        JSON.parse(device.subscription_json),
        notification(event),
        keys,
        remaining,
        fetcher,
      );
    } catch {
      /* Retry once per minute, never expose subscription addresses in logs. */
    }
    if (status === 404 || status === 410) {
      await db
        .prepare("DELETE FROM push_devices WHERE id=?")
        .bind(event.device_id)
        .run();
    } else {
      const outcome =
        status >= 200 && status < 300
          ? "sent"
          : event.attempts >= 3 ||
              (status >= 400 &&
                status < 500 &&
                status !== 408 &&
                status !== 429)
            ? "failed"
            : "pending";
      await db
        .prepare(
          `UPDATE push_events SET status=? WHERE id=? AND status='pending'`,
        )
        .bind(outcome, event.id)
        .run();
      console.log(JSON.stringify({ task: "push", outcome, status }));
    }
  }
  await db.batch([
    db
      .prepare(
        `UPDATE push_events SET status='expired' WHERE id IN (SELECT id FROM push_events WHERE status='pending' AND expires_at<=? LIMIT 20)`,
      )
      .bind(now),
    db
      .prepare(
        `DELETE FROM push_events WHERE id IN (SELECT id FROM push_events WHERE status!='pending' AND created_at<? LIMIT 20)`,
      )
      .bind(now - 30 * 86400_000),
  ]);
}
