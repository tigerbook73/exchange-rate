import { expect, test } from "@playwright/test";
import { getBeijingDateString } from "../src/lib/date";

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

const TODAY = getBeijingDateString();

// A 10-day window with one intentional gap (like the real source's missing
// Sundays), ending today, so the sync's carried-forward fill has something
// to do.
const HISTORY_SERIES = Array.from({ length: 10 }, (_, i) => addDays(TODAY, -i))
  .filter((date) => date !== addDays(TODAY, -3)) // simulate one missing day
  .map((date, i) => ({ date, huiSell: 4.75 + i * 0.001 }));

async function mockApis(page: import("@playwright/test").Page) {
  await page.route("**/api/today", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bank: "icbc",
        currency: "aud",
        date: TODAY,
        publishedAt: `${TODAY}T10:30:00+08:00`,
        huiSell: 4.75,
      }),
    }),
  );
  await page.route("**/api/history", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bank: "icbc",
        currency: "aud",
        field: "huiSell",
        series: HISTORY_SERIES,
      }),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockApis(page);
});

test("shows the current rate card from mocked API data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("4.7500")).toBeVisible();
  await expect(page.getByText(/更新于/)).toBeVisible();
  // A fresh "today" quote shouldn't carry the card's stale/carried-forward
  // note (the chart's own "○" caption is a separate, unrelated element).
  await expect(page.getByText(/⚠/)).not.toBeVisible();
});

test("switches chart range without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto("/");
  await expect(page.getByText("4.7500")).toBeVisible();

  for (const label of ["7 天", "全部", "30 天"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }

  expect(errors).toEqual([]);
});

test("marks the gap day with a hollow point and an explanatory tooltip", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("4.7500")).toBeVisible();
  await expect(
    page.getByText("○ 空心点：数据未更新，沿用前一日"),
  ).toBeVisible();
});

test("follows the system color scheme (no manual toggle)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByText("4.7500")).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const lightBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  const darkBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  expect(darkBg).not.toBe(lightBg);
});

test("shows the last known rate (with a loading note) instead of a blank state while syncing", async ({
  page,
}) => {
  // Delay the mocked history response so the initial cached-vs-syncing gap
  // is observable, then seed IndexedDB with a prior value before the app's
  // own sync runs.
  await page.addInitScript(() => {
    const req = indexedDB.open("fx-cache", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("rates", { keyPath: "date" });
    };
    req.onsuccess = () => {
      req.result.transaction("rates", "readwrite").objectStore("rates").put({
        date: "2020-01-01",
        huiSell: 4.1234,
        publishedAt: null,
        source: "history",
        carriedFromDate: null,
      });
    };
  });

  await page.unroute("**/api/history");
  await page.route("**/api/history", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bank: "icbc",
        currency: "aud",
        field: "huiSell",
        series: HISTORY_SERIES,
      }),
    });
  });

  await page.goto("/");

  // While the sync is still in flight, the card shows the seeded value plus
  // an inline loading note — never a blank "loading" placeholder.
  await expect(page.getByText("4.1234")).toBeVisible();
  await expect(page.getByText("（加载中…）")).toBeVisible();

  // Once the sync resolves, the note disappears and the fresh value takes
  // over, without the card ever having changed structure.
  await expect(page.getByText("4.7500")).toBeVisible();
  await expect(page.getByText("（加载中…）")).not.toBeVisible();
});
