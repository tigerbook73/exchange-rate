import { beforeEach, it, expect, vi } from "vitest";
import { deleteDB } from "idb";
import {
  showAlertNotification,
  readAlertNotification,
  clearExpiredNotifications,
} from "./notifications";
import { rememberNotificationRead } from "../lib/client/notification-receipts";
const now = Date.now();
const receipt = {
  id: "a:1:low",
  token: "a".repeat(64),
  expiresAt: now + 86400000,
};
const payload = {
  title: "澳元低价提醒",
  body: "test",
  tag: "fx-alert-low",
  createdAt: now,
  receipt,
};
let active: Notification[] = [];
let displayed: ReturnType<typeof vi.fn>;
function fakeNotification(id: string, kind = "low", createdAt = now) {
  const n = {
    tag: `fx-alert-${kind}`,
    title: `澳元${kind === "low" ? "低" : "高"}价提醒`,
    timestamp: createdAt,
    data: { receipt: { ...receipt, id }, createdAt },
    close: vi.fn(() => {
      active = active.filter((x) => x !== n);
    }),
  } as unknown as Notification;
  return n;
}
beforeEach(async () => {
  await deleteDB("fx-notification-reads");
  active = [];
  displayed = vi.fn(async (title: string, options: NotificationOptions) => {
    const n = fakeNotification(
      options.data.receipt.id,
      options.tag!.split("-").at(-1)!,
      options.data.createdAt,
    );
    Object.assign(n, { title, data: options.data });
    active.push(n);
  });
  vi.stubGlobal("self", {
    registration: {
      getNotifications: vi.fn(async (options?: { tag: string }) =>
        active.filter((n) => !options || n.tag === options.tag),
      ),
      showNotification: displayed,
    },
    clients: { matchAll: async () => [] },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});
it("replaces only the same direction and suppresses out-of-order and already read deliveries", async () => {
  active = [fakeNotification("old"), fakeNotification("high", "high")];
  await showAlertNotification(payload, now);
  expect(active.map((n) => n.tag).sort()).toEqual([
    "fx-alert-high",
    "fx-alert-low",
  ]);
  await showAlertNotification(
    { ...payload, createdAt: now - 1, receipt: { ...receipt, id: "older" } },
    now,
  );
  expect(displayed).toHaveBeenCalledTimes(1);
  await rememberNotificationRead({ ...receipt, id: "read" });
  await showAlertNotification(
    { ...payload, receipt: { ...receipt, id: "read" } },
    now,
  );
  expect(displayed).toHaveBeenCalledTimes(1);
});
it("closes a clicked notification and submits a scoped receipt", async () => {
  const n = fakeNotification(receipt.id);
  active = [n];
  await readAlertNotification(n);
  expect(n.close).toHaveBeenCalled();
  expect(active).toHaveLength(0);
  expect(fetch).toHaveBeenCalledWith(
    "/api/alerts/read",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ id: receipt.id, token: receipt.token }),
    }),
  );
});
it("clears notifications after 24 hours on the next wake and ignores expired pushes", async () => {
  active = [fakeNotification("old")];
  await clearExpiredNotifications(receipt.expiresAt);
  expect(active).toHaveLength(0);
  await showAlertNotification(payload, receipt.expiresAt);
  expect(displayed).not.toHaveBeenCalled();
});
