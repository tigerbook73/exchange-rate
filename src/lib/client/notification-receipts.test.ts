import { beforeEach, it, expect, vi } from "vitest";
import { deleteDB } from "idb";
import {
  rememberNotificationRead,
  notificationWasRead,
  flushNotificationReads,
  visibleAlertEvents,
} from "./notification-receipts";
const receipt = {
  id: "a:1:low",
  token: "a".repeat(64),
  expiresAt: Date.now() + 86400000,
};
beforeEach(async () => {
  await deleteDB("fx-notification-reads");
});
it("remembers offline reads, retries after wake, and retains a tombstone to suppress redelivery", async () => {
  await rememberNotificationRead(receipt);
  await flushNotificationReads(
    vi.fn(async () => {
      throw new TypeError("offline");
    }),
  );
  expect(await notificationWasRead(receipt.id)).toBe(true);
  const send = vi.fn<typeof fetch>(
    async () => new Response("{}", { status: 200 }),
  );
  await flushNotificationReads(send);
  expect(send).toHaveBeenCalledTimes(1);
  await flushNotificationReads(send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(await notificationWasRead(receipt.id)).toBe(true);
  await flushNotificationReads(send, receipt.expiresAt);
  expect(await notificationWasRead(receipt.id)).toBe(false);
});
it("filters read and expired notifications without removing the subscription or other direction", async () => {
  const now = Date.now();
  await rememberNotificationRead(receipt);
  const event = {
    id: receipt.id,
    expiresAt: receipt.expiresAt,
    kind: "low" as const,
    status: "sent" as const,
    createdAt: now,
    priceUnits: 45000,
  };
  const visible = await visibleAlertEvents(
    [
      event,
      { ...event, id: "a:1:high", kind: "high" },
      { ...event, id: "old", expiresAt: now },
    ],
    now,
  );
  expect(visible.map((e) => e.kind)).toEqual(["high"]);
});
