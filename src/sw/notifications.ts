import {
  flushNotificationReads,
  notificationWasRead,
  parseReceipt,
  rememberNotificationRead,
} from "../lib/client/notification-receipts";
import { ALERT_RETENTION } from "../lib/domain/price-alerts";

declare const self: ServiceWorkerGlobalScope;
const tags = new Set(["fx-alert-low", "fx-alert-high", "fx-alert-test"]);
async function changed() {
  for (const client of await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  }))
    client.postMessage({ type: "ALERT_NOTIFICATIONS_CHANGED" });
}
export async function clearExpiredNotifications(now = Date.now(), all = false) {
  for (const notification of await self.registration.getNotifications()) {
    const receipt = parseReceipt(notification.data?.receipt);
    const owned =
      tags.has(notification.tag) ||
      ["澳元低价提醒", "澳元高价提醒", "汇率提醒已连接"].includes(
        notification.title,
      );
    if (owned && (all || !receipt || receipt.expiresAt <= now))
      notification.close();
  }
}
export async function showAlertNotification(value: unknown, now = Date.now()) {
  if (!value || typeof value !== "object") return;
  const data = value as Record<string, unknown>;
  if (
    typeof data.title !== "string" ||
    typeof data.body !== "string" ||
    typeof data.tag !== "string"
  )
    return;
  const receipt = parseReceipt(data.receipt);
  await clearExpiredNotifications(now);
  if (
    !receipt ||
    receipt.expiresAt <= now ||
    receipt.expiresAt > now + ALERT_RETENTION ||
    (await notificationWasRead(receipt.id))
  )
    return;
  // One stable tag per direction replaces that direction's existing notification.
  if (!tags.has(data.tag)) return;
  for (const notification of await self.registration.getNotifications({
    tag: data.tag,
  })) {
    const previous = parseReceipt(notification.data?.receipt);
    if (
      previous &&
      Number(notification.data?.createdAt) > Number(data.createdAt)
    )
      return;
    notification.close();
  }
  await self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    icon: "/icons/icon-192.png",
    data: {
      receipt,
      createdAt: typeof data.createdAt === "number" ? data.createdAt : now,
      url: "/",
    },
  });
  await changed();
}
export async function readAlertNotification(notification: Notification) {
  notification.close();
  const receipt = parseReceipt(notification.data?.receipt);
  try {
    if (receipt) await rememberNotificationRead(receipt);
  } finally {
    await changed();
  }
  await flushNotificationReads();
  await changed();
}
export async function maintainAlertNotifications(all = false) {
  await clearExpiredNotifications(Date.now(), all);
  await flushNotificationReads();
  await changed();
}
