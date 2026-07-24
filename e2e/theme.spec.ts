import { expect, test } from "@playwright/test";

test("switches between light and dark theme", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("工商银行澳币购汇价")).toBeVisible();

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
