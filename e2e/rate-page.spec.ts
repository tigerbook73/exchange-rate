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

test("switches between light and dark theme", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("4.7500")).toBeVisible();

  await page.getByRole("button", { name: /亮色/ }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const lightBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  await page.getByRole("button", { name: /暗色/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const darkBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  expect(darkBg).not.toBe(lightBg);
});
