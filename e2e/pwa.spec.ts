import { expect, test } from "@playwright/test";
import { addDays, getBeijingDateString } from "../src/lib/date";
import {
  emptyCollectionState,
  type SyncResponse,
} from "../src/lib/server-types";

test("production service worker controls the page and reloads cached data offline", async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    "Run against the production local OpenNext preview",
  );
  const now = Date.now();
  const date = getBeijingDateString(new Date(now));
  const state = emptyCollectionState();
  state.lastCheckedAt = new Date(now).toISOString();
  state.lastSuccess = {
    minute: Math.floor(now / 60000) * 60000,
    requestedAt: new Date(now).toISOString(),
    receivedAt: new Date(now).toISOString(),
    publishedAt: new Date(now).toISOString(),
    priceUnits: 47500,
    date,
  };
  const data: SyncResponse = {
    schema: 1,
    datasetId: "b".repeat(32),
    revision: 1,
    cursor: `${"b".repeat(32)}.1`,
    mode: "snapshot",
    generatedAt: new Date(now).toISOString(),
    retainedFrom: addDays(date, -2),
    historyFrom: addDays(date, -365),
    daily: [
      {
        date,
        huiSell: 4.75,
        publishedAt: state.lastSuccess.publishedAt,
        source: "today",
        carriedFromDate: null,
      },
    ],
    points: [],
    deletedDaily: [],
    deletedPoints: [],
    state,
  };
  // Context routing includes requests initiated by the service worker itself.
  await context.route("**/api/**", (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has("cursor")
        ? { ...data, mode: "delta", daily: [] }
        : data,
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.reload();
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("4.7500", { exact: true })).toBeVisible();
  await expect(page.getByText("离线 · 显示已缓存数据")).toBeVisible();
  await page.getByRole("button", { name: "7 天", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
});
