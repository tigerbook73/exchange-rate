import { expect, test, type Page } from "@playwright/test";
import { addDays, getBeijingDateString } from "../src/lib/date";
import {
  emptyCollectionState,
  type SyncResponse,
} from "../src/lib/server-types";

const TODAY = getBeijingDateString();
const datasetId = "a".repeat(32);
function payload(revision = 1, incremental = false): SyncResponse {
  const now = Date.now();
  const minute = Math.floor(now / 60000) * 60000;
  const state = emptyCollectionState();
  state.lastSuccess = {
    minute,
    requestedAt: new Date(now).toISOString(),
    receivedAt: new Date(now).toISOString(),
    publishedAt: new Date(now).toISOString(),
    date: TODAY,
    priceUnits: 47500 + (revision - 1) * 100,
  };
  state.lastCheckedAt = new Date(now).toISOString();
  state.lastAttemptMinute = minute;
  state.lastFinalized = Math.floor(minute / 300000) * 300000;
  state.live =
    minute > state.lastFinalized
      ? {
          minute,
          priceUnits: state.lastSuccess.priceUnits,
          sourceMinute: minute,
          sourceRequestedAt: state.lastSuccess.requestedAt,
          publishedAt: state.lastSuccess.publishedAt,
          isFallback: false,
          kind: "live",
        }
      : null;
  return {
    schema: 1,
    datasetId,
    revision,
    cursor: `${datasetId}.${revision}`,
    mode: incremental ? "delta" : "snapshot",
    generatedAt: new Date(now).toISOString(),
    retainedFrom: addDays(TODAY, -2),
    historyFrom: addDays(TODAY, -365),
    state,
    daily: incremental
      ? []
      : Array.from({ length: 10 }, (_, i) => ({
          date: addDays(TODAY, -i),
          huiSell: 4.75 + i * 0.001,
          publishedAt: i === 0 ? state.lastSuccess!.publishedAt : null,
          source: i === 0 ? "today" : "history",
          carriedFromDate: null,
        })),
    points: [],
    deletedDaily: [],
    deletedPoints: [],
  };
}

async function mockApis(page: Page) {
  // Legacy compatibility routes are mocked too; new UI must never need them.
  await page.route(/\/api\/(today|history)(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Legacy request unexpected" },
    }),
  );
  await page.route(/\/api\/intraday(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { points: [], live: null } }),
  );
  await page.route(/\/api\/sync(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: payload(
        1,
        new URL(route.request().url()).searchParams.has("cursor"),
      ),
    }),
  );
}
test.beforeEach(async ({ page }) => {
  await mockApis(page);
});

test("loads the current valid date without a three-day selector", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await expect(page.getByText(/服务端检查于/)).toHaveCount(0);
  await expect(
    page.getByText("数据来自快易理财网及工商银行网站。仅供参考。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "30 天", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "1 日", exact: true }).click();
  await expect(page.getByText(new RegExp(`^${TODAY}(?: |$)`))).toBeVisible();
  await expect(page.getByRole("group", { name: "日内日期" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "图表类型" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "1 日", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("canvas")).toBeVisible();
});

test("shows the last valid source date until today's quote arrives", async ({
  page,
}) => {
  let fresh = false;
  const previousDate = addDays(TODAY, -1);
  await page.route(/\/api\/sync(?:\?.*)?$/, (route) => {
    const data = payload(
      fresh ? 2 : 1,
      new URL(route.request().url()).searchParams.has("cursor"),
    );
    if (!fresh) {
      data.state.lastSuccess!.publishedAt = `${previousDate}T22:00:00+08:00`;
      data.state.lastSuccess!.date = previousDate;
    }
    return route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "1 日", exact: true }).click();
  await expect(page.getByText(previousDate, { exact: true })).toBeVisible();
  await expect(page.getByText(/更新于 .*今天无更新/)).toBeVisible();
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  fresh = true;
  await page.getByRole("button", { name: "刷新汇率" }).click();
  await expect(page.getByText(new RegExp(`^${TODAY}(?: |$)`))).toBeVisible();
  await expect(page.getByText("4.7600", { exact: true })).toBeVisible();
  await expect(page.getByText(/尚无今日有效报价/)).toHaveCount(0);
});

test("shows only the observed intraday time range with a prior-close reference", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00+08:00`));
  await page.route(/\/api\/sync(?:\?.*)?$/, (route) => {
    const data = payload();
    data.state.live = null;
    data.points = ["10:00", "10:10"].map((time, index) => ({
      minute: Date.parse(`${TODAY}T${time}:00+08:00`),
      priceUnits: 47500 + index * 100,
      sourceMinute: Date.parse(`${TODAY}T${time}:00+08:00`),
      sourceRequestedAt: `${TODAY}T${time}:05+08:00`,
      publishedAt: `${TODAY}T${time}:00+08:00`,
      isFallback: false,
      kind: "fixed" as const,
    }));
    return route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "1 日", exact: true }).click();
  await expect(
    page.getByText(`${TODAY} 10:00–10:10`, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
});

test("preserves existing history ranges", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("/");
  for (const label of ["7 天", "30 天", "90 天", "半年", "一年", "1 日"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  expect(errors).toEqual([]);
});

test("follows system themes on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(
    await page
      .locator("canvas")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(100);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("keeps one crosshair during mouse and touch movement", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "7 天", exact: true }).click();
  const canvas = page.locator("canvas");
  const line = page.locator("[data-chart-crosshair]");
  const cdp = await page.context().newCDPSession(page);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const rect = (await canvas.boundingBox())!;
    const y = rect.y + rect.height / 2;
    for (const fraction of [0.2, 0.4, 0.8, 0.3, 0.7]) {
      await page.mouse.move(rect.x + rect.width * fraction, y);
      await expect(line).toHaveCount(1);
      await expect(line).toBeVisible();
    }
    const previous = await line.evaluate((el) => el.style.left);
    await page.mouse.move(rect.x + rect.width * 0.9, y);
    await expect
      .poll(() => line.evaluate((el) => el.style.left))
      .not.toBe(previous);
    await page.mouse.move(1, 1);
    await expect(line).toBeHidden();
    for (const [i, fraction] of [0.25, 0.65, 0.35, 0.8].entries()) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: i === 0 ? "touchStart" : "touchMove",
        touchPoints: [{ x: rect.x + rect.width * fraction, y }],
      });
      await expect(line).toHaveCount(1);
      await expect(line).toBeVisible();
    }
    await expect(line).toHaveCSS("width", "2px");
    await expect(line).toHaveCSS("transform", "none");
    await expect(line).toHaveCSS("transition-duration", "0s");
    const left = await line.evaluate((el) => parseFloat(el.style.left));
    expect(Number.isInteger(left)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`crosshair-drag-${colorScheme}.png`),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await cdp.detach();
});

test("scrolls the range row with arrows without horizontal page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const group = page.getByRole("group", { name: "时间范围" });
  await expect(
    group.getByRole("button", { name: "向右移动时间范围" }),
  ).toBeVisible();
  await group.getByRole("button", { name: "向右移动时间范围" }).click();
  await expect(
    group.getByRole("button", { name: "向左移动时间范围" }),
  ).toBeVisible();
  await group.getByRole("button", { name: "一年", exact: true }).click();
  await expect(
    group.getByRole("button", { name: "一年", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: "向左移动时间范围" }).click();
  await group.getByRole("button", { name: "1 日", exact: true }).click();
  await expect(
    group.getByRole("button", { name: "1 日", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("refreshes incrementally without downloading all history again", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route(/\/api\/sync(?:\?.*)?$/, (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      json: payload(requests.length, requests.length > 1),
    });
  });
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "刷新汇率" }).click();
  await expect(page.getByText("4.7600", { exact: true })).toBeVisible();
  expect(new URL(requests[1]).searchParams.get("cursor")).toBe(
    `${datasetId}.1`,
  );
  await page.getByRole("button", { name: "7 天", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
});

test("keeps legacy local data visible while initial snapshot loads", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const request = indexedDB.open("fx-cache", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("rates", { keyPath: "date" });
    request.onsuccess = () => {
      const tx = request.result.transaction("rates", "readwrite");
      tx.objectStore("rates").put({
        date: "2020-01-01",
        huiSell: 4.1234,
        publishedAt: null,
        source: "history",
        carriedFromDate: null,
      });
      tx.oncomplete = () => request.result.close();
    };
  });
  await page.route(/\/api\/sync(?:\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({ json: payload() });
  });
  await page.goto("/");
  await expect(page.getByText("4.1234", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status", { name: "正在刷新汇率" }),
  ).toBeVisible();
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
});

for (const event of ["visibilitychange", "pageshow", "focus"] as const) {
  test(`uses an incremental request on ${event}`, async ({ page }) => {
    let count = 0;
    await page.route(/\/api\/sync(?:\?.*)?$/, (route) =>
      route.fulfill({ json: payload(++count, count > 1) }),
    );
    await page.goto("/");
    await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
    await page.evaluate((event) => {
      if (event === "visibilitychange")
        document.dispatchEvent(new Event(event));
      else if (event === "pageshow")
        window.dispatchEvent(
          new PageTransitionEvent(event, { persisted: true }),
        );
      else window.dispatchEvent(new Event(event));
    }, event);
    await expect(page.getByText("4.7600", { exact: true })).toBeVisible();
    expect(count).toBe(2);
  });
}

test("recovers an expired cursor with a bounded snapshot", async ({ page }) => {
  let expired = false;
  await page.route(/\/api\/sync(?:\?.*)?$/, (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      expired = true;
      return route.fulfill({ status: 409, json: { resetRequired: true } });
    }
    return route.fulfill({ json: payload(expired ? 2 : 1) });
  });
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "刷新汇率" }).click();
  await expect(page.getByText("4.7600", { exact: true })).toBeVisible();
  expect(expired).toBe(true);
});

test("reloads once on an incompatible API and keeps old data if the new client is not available", async ({
  page,
}) => {
  let incompatible = false;
  await page.route(/\/api\/sync(?:\?.*)?$/, (route) =>
    incompatible
      ? route.fulfill({
          status: 426,
          json: {
            error: "client_upgrade_required",
            schema: 2,
            resetClientCache: true,
          },
        })
      : route.fulfill({ json: payload() }),
  );
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  let reloads = 0;
  page.on("domcontentloaded", () => {
    reloads++;
  });
  incompatible = true;
  await page.getByRole("button", { name: "刷新汇率" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "自动更新未完成" }),
  ).toBeVisible();
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  expect(reloads).toBe(1);
  await page.getByRole("button", { name: "刷新汇率" }).click();
  await expect(page.getByRole("button", { name: "刷新汇率" })).toBeEnabled();
  expect(reloads).toBe(1);
});

test("rebuilds old local data after a compatible upgraded snapshot and keeps static resources", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "icbc-rate:api-upgrade",
      JSON.stringify({ fromSchema: 0, targetSchema: 1 }),
    );
    const request = indexedDB.open("fx-cache", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("rates", { keyPath: "date" });
    request.onsuccess = () => {
      const tx = request.result.transaction("rates", "readwrite");
      tx.objectStore("rates").put({
        date: "2020-01-01",
        huiSell: 4.1234,
        publishedAt: null,
        source: "history",
        carriedFromDate: null,
      });
      tx.oncomplete = () => request.result.close();
    };
    void (async () => {
      const cache = await caches.open("upgrade-test");
      await cache.put("/api/sync?schema=0", new Response("old-api"));
      await cache.put("/test-static-resource.js", new Response("static"));
    })();
  });
  await page.route(/\/api\/sync(?:\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ json: payload() });
  });
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  const state = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fx-cache");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const old = await new Promise((resolve) => {
      const request = db
        .transaction("rates")
        .objectStore("rates")
        .get("2020-01-01");
      request.onsuccess = () => resolve(Boolean(request.result));
    });
    db.close();
    const cache = await caches.open("upgrade-test");
    return {
      old,
      ticket: sessionStorage.getItem("icbc-rate:api-upgrade"),
      oldApi: Boolean(await cache.match("/api/sync?schema=0")),
      staticResource: Boolean(await cache.match("/test-static-resource.js")),
    };
  });
  expect(state).toEqual({
    old: false,
    ticket: null,
    oldApi: false,
    staticResource: true,
  });
});

test("polls once per minute in foreground and stops while hidden", async ({
  page,
}) => {
  await page.clock.install();
  let count = 0;
  await page.route(/\/api\/sync(?:\?.*)?$/, (route) =>
    route.fulfill({ json: payload(++count, count > 1) }),
  );
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(page.getByText("4.7600", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    }),
  );
  await page.clock.fastForward(120_000);
  expect(count).toBe(2);
});

test("coalesces wake events while preserving the last quote", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  let count = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/sync(?:\?.*)?$/, async (route) => {
    count++;
    await ready;
    await route.fulfill({ json: payload(2, true) });
  });
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
  await expect.poll(() => count).toBe(1);
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status", { name: "正在刷新汇率" }),
  ).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const price = page.getByText("4.7500", { exact: true });
    const status = page.getByRole("status", { name: "正在刷新汇率" });
    const priceRect = await price.boundingBox();
    const statusRect = await status.boundingBox();
    const fontSize = await price.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    expect(statusRect!.x).toBeGreaterThanOrEqual(
      priceRect!.x + priceRect!.width,
    );
    expect(statusRect!.height / fontSize).toBeGreaterThan(0.6);
    expect(statusRect!.height / fontSize).toBeLessThanOrEqual(1.1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await expect(page.getByText("（加载中…）")).toHaveCount(0);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    if (colorScheme === "dark")
      await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: testInfo.outputPath(`refresh-${colorScheme}.png`),
    });
  }
  release();
  await expect(page.getByText("4.7600", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "正在刷新汇率" })).toHaveCount(
    0,
  );
  expect(count).toBe(1);
});

test("preserves downloaded data offline and after a server failure", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await page.route(/\/api\/sync(?:\?.*)?$/, (route) =>
    route.fulfill({ status: 503, json: { error: "Not ready" } }),
  );
  await page.getByRole("button", { name: "刷新汇率" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "尚未就绪" }),
  ).toBeVisible();
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/离线 · 显示已缓存数据/)).toBeVisible();
  await page.getByRole("button", { name: "7 天", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
});
