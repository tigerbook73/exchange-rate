import { openDB, type DBSchema } from "idb";
import type { AlertEvent, NotificationReceipt } from "../contracts/alert-types";
interface ReadReceipt extends NotificationReceipt {
  pending: 0 | 1;
}
interface ReceiptDB extends DBSchema {
  reads: {
    key: string;
    value: ReadReceipt;
    indexes: { pending: number; expiresAt: number };
  };
}
async function database() {
  return openDB<ReceiptDB>("fx-notification-reads", 1, {
    upgrade(db) {
      const store = db.createObjectStore("reads", { keyPath: "id" });
      store.createIndex("pending", "pending");
      store.createIndex("expiresAt", "expiresAt");
    },
  });
}
export function parseReceipt(value: unknown): NotificationReceipt | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" &&
    /^[a-z0-9:-]{1,128}$/.test(v.id) &&
    typeof v.token === "string" &&
    /^[a-f0-9]{64}$/.test(v.token) &&
    typeof v.expiresAt === "number" &&
    Number.isFinite(v.expiresAt)
    ? { id: v.id, token: v.token, expiresAt: v.expiresAt }
    : null;
}
export async function rememberNotificationRead(receipt: NotificationReceipt) {
  const db = await database();
  try {
    await db.put("reads", { ...receipt, pending: 1 });
  } finally {
    db.close();
  }
}
export async function notificationWasRead(id: string) {
  const db = await database();
  try {
    return Boolean(await db.get("reads", id));
  } finally {
    db.close();
  }
}
export async function visibleAlertEvents(
  events: AlertEvent[],
  now = Date.now(),
) {
  const db = await database();
  try {
    return (
      await Promise.all(
        events.map(async (event) =>
          event.expiresAt > now && !(await db.get("reads", event.id))
            ? event
            : null,
        ),
      )
    ).filter((event): event is AlertEvent => event !== null);
  } finally {
    db.close();
  }
}
export async function flushNotificationReads(
  fetcher = fetch,
  now = Date.now(),
) {
  const db = await database();
  try {
    // Retain read tombstones until the notification's lifetime ends, so a retry
    // arriving after a click cannot display the same event again.
    const expired = await db.getAllKeysFromIndex(
      "reads",
      "expiresAt",
      IDBKeyRange.upperBound(now),
      20,
    );
    const cleanup = db.transaction("reads", "readwrite");
    for (const id of expired) await cleanup.store.delete(id);
    await cleanup.done;
    for (const receipt of await db.getAllFromIndex("reads", "pending", 1, 3)) {
      try {
        const response = await fetcher("/api/alerts/read", {
          method: "POST",
          cache: "no-store",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: receipt.id, token: receipt.token }),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) await db.put("reads", { ...receipt, pending: 0 });
      } catch {
        /* Offline clicks remain local and are retried on the next wake. */
      }
    }
  } finally {
    db.close();
  }
}
export function wakeNotificationMaintenance() {
  navigator.serviceWorker?.controller?.postMessage({
    type: "MAINTAIN_ALERT_NOTIFICATIONS",
  });
}
