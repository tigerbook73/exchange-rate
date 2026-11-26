import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const publicKey = "B" + "a".repeat(86);
const initial = {
  lowUnits: 46000,
  highUnits: 48000,
  lowEnabled: false,
  highEnabled: true,
  recent: [
    {
      id: "a:1:low",
      expiresAt: Date.now() + 86400000,
      kind: "low",
      status: "sent",
      createdAt: Date.now(),
      priceUnits: 45000,
    },
  ],
};
test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  await page.addInitScript(() =>
    Object.defineProperty(Notification, "permission", {
      value: "granted",
      configurable: true,
    }),
  );
  await page.route("**/api/alerts/config", (route) =>
    route.fulfill({ json: { publicKey } }),
  );
  await page.route("**/api/sync*", (route) =>
    route.fulfill({ status: 503, json: { error: "Waiting" } }),
  );
});
test("enrollment requires an invite and preserves notification permission until the user clicks", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", {
      value: "default",
      configurable: true,
    });
    Notification.requestPermission = async () => {
      throw new Error("permission was requested");
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "价格提醒", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const enable = page.getByRole("button", { name: "开启通知并保存" });
  await expect(enable).toBeDisabled();
  await page.getByLabel("共享邀请码").fill("invite");
  await page.getByLabel("低价提醒（≤）", { exact: true }).check();
  await page.getByLabel("低价阈值").fill("4.60");
  await expect(enable).toBeEnabled();
  await enable.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "permission was requested",
  );
});
test("reloads server rule state, explicitly rearms, queues a test and cancels only this device", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("fx-alert-device-token", "a".repeat(72)),
  );
  let status = initial;
  await page.route("**/api/alerts/device", async (route) => {
    expect(route.request().headers().authorization).toBe(
      `Bearer ${"a".repeat(72)}`,
    );
    if (route.request().method() === "PUT")
      status = { ...status, ...route.request().postDataJSON(), recent: [] };
    await route.fulfill({
      json: route.request().method() === "DELETE" ? { deleted: true } : status,
    });
  });
  await page.route("**/api/alerts/test", (route) =>
    route.fulfill({ status: 202, json: { queued: true } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "价格提醒", exact: true }).click();
  await expect(page.getByLabel("低价阈值")).toHaveValue("4.6000");
  await expect(
    page.getByLabel("低价提醒（≤）", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel("高价提醒（≥）", { exact: true })).toBeChecked();
  await expect(page.getByText(/低价提醒 · 已提交推送/)).toBeVisible();
  await page.getByLabel("低价提醒（≤）", { exact: true }).check();
  await page.getByRole("button", { name: "保存并更新提醒" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.getByRole("button", { name: "测试通知", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已排队");
  await page.getByRole("button", { name: "取消订阅" }).click();
  await expect(page.getByRole("status")).toContainText("已取消");
  expect(
    await page.evaluate(() => localStorage.getItem("fx-alert-device-token")),
  ).toBeNull();
});
test("keeps draft inputs on server failure and rejects an inverted threshold before sending", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("fx-alert-device-token", "a".repeat(72)),
  );
  await page.route("**/api/alerts/device", (route) =>
    route.fulfill({ json: initial }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "价格提醒", exact: true }).click();
  await expect(page.getByLabel("低价阈值")).toHaveValue("4.6000");
  await page.getByLabel("低价阈值").fill("4.9");
  await page.getByRole("button", { name: "保存并更新提醒" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "低价阈值须小于高价阈值",
  );
  await page.getByLabel("低价阈值").fill("4.5");
  await page.route("**/api/alerts/device", (route) =>
    route.fulfill({ status: 503, json: { error: "服务暂不可用" } }),
  );
  await page.getByRole("button", { name: "保存并更新提醒" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "服务暂不可用",
  );
  await expect(page.getByLabel("低价阈值")).toHaveValue("4.5");
});
test("explains denied permission and allows closing the dialog on a small screen", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(Notification, "permission", {
      value: "denied",
      configurable: true,
    }),
  );
  await page.setViewportSize({ width: 390, height: 660 });
  await page.goto("/");
  await page.getByRole("button", { name: "价格提醒", exact: true }).click();
  await expect(
    page.getByText("通知权限已关闭，请先在系统或浏览器设置中允许通知。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开启通知并保存" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "关闭价格提醒" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("bell follows subscription, arrival, clearing, expiry and unsubscription", async ({
  page,
}) => {
  let current = { ...initial, recent: [] as typeof initial.recent };
  await page.route("**/api/alerts/device", (route) =>
    route.fulfill({ json: current }),
  );
  await page.goto("/");
  const bell = page.getByRole("button", { name: "价格提醒", exact: true });
  await expect(bell).toHaveAttribute("data-notification-state", "unsubscribed");
  await page.evaluate(() => {
    localStorage.setItem("fx-alert-device-token", "a".repeat(72));
    window.dispatchEvent(new Event("storage"));
  });
  await expect(bell).toHaveAttribute(
    "data-notification-state",
    "subscribed-empty",
  );
  current = initial;
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "ALERT_NOTIFICATIONS_CHANGED" },
      }),
    ),
  );
  await expect(bell).toHaveAttribute(
    "data-notification-state",
    "subscribed-unread",
  );
  current = { ...initial, recent: [] };
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "ALERT_NOTIFICATIONS_CHANGED" },
      }),
    ),
  );
  await expect(bell).toHaveAttribute(
    "data-notification-state",
    "subscribed-empty",
  );
  current = {
    ...initial,
    recent: [{ ...initial.recent[0], expiresAt: Date.now() - 1 }],
  };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(bell).toHaveAttribute(
    "data-notification-state",
    "subscribed-empty",
  );
  await page.evaluate(() => {
    localStorage.removeItem("fx-alert-device-token");
    window.dispatchEvent(new Event("storage"));
  });
  await expect(bell).toHaveAttribute("data-notification-state", "unsubscribed");
});

test("an offline read clears the bell without losing the subscription", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("fx-alert-device-token", "a".repeat(72)),
  );
  let unavailable = false;
  await page.route("**/api/alerts/device", (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: "offline" } })
      : route.fulfill({ json: initial }),
  );
  await page.goto("/");
  const bell = page.getByRole("button", { name: "价格提醒", exact: true });
  await expect(bell).toHaveAttribute(
    "data-notification-state",
    "subscribed-unread",
  );
  await page.evaluate(async () => {
    const req = indexedDB.open("fx-notification-reads", 1);
    const db = await new Promise<IDBDatabase>(
      (resolve) => (req.onsuccess = () => resolve(req.result)),
    );
    const tx = db.transaction("reads", "readwrite");
    tx.objectStore("reads").put({
      id: "a:1:low",
      token: "a".repeat(64),
      expiresAt: Date.now() + 86400000,
      pending: 1,
    });
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  });
  unavailable = true;
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "ALERT_NOTIFICATIONS_CHANGED" },
      }),
    ),
  );
  await expect(bell).toHaveAttribute(
    "data-notification-state",
    "subscribed-empty",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("fx-alert-device-token")),
  ).toBe("a".repeat(72));
});
