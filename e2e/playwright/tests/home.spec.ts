import { expect, test } from "@playwright/test";

test("home page shows 3 mode cards", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("h1")).toContainText("選擇面試模式");
  await expect(page.locator("button").filter({ hasText: "Single Mode" })).toBeVisible();
  await expect(page.locator("button").filter({ hasText: "Mock Interview" })).toBeVisible();
  await expect(page.locator("button").filter({ hasText: "Weak Review" })).toBeVisible();
});

test("clicking a mode card changes active selection", async ({ page }) => {
  await page.goto("/");
  const mockCard = page.locator("button").filter({ hasText: "Mock Interview" });

  await mockCard.click();

  await expect(mockCard).toHaveAttribute("style", /border-width: 2px/);
});

test("clicking a provider button changes active provider", async ({ page }) => {
  await page.goto("/");
  const claudeButton = page.locator("button").filter({ hasText: "Claude" });

  await claudeButton.click();

  await expect(claudeButton).toHaveAttribute("style", /border-width: 1\.5px/);
});

test("clicking start session navigates to interview page", async ({ page }) => {
  await page.route("**/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: "test-session-uuid-1234",
          mode: "single",
          eval_provider: "openai",
          status: "active",
          started_at: new Date().toISOString(),
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/");
  await page.locator("button").filter({ hasText: "開始面試" }).click();

  await expect(page).toHaveURL(/\/interview\?session_id=test-session-uuid-1234/);
});

test("API failure on start shows inline error banner (no alert)", async ({ page }) => {
  await page.route("**/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
      return;
    }
    await route.continue();
  });

  let alertFired = false;
  page.on("dialog", async (dialog) => {
    alertFired = true;
    await dialog.dismiss();
  });

  await page.goto("/");
  await page.locator("button").filter({ hasText: "開始面試" }).click();

  await expect(page.locator("text=伺服器發生錯誤")).toBeVisible();
  expect(alertFired).toBe(false);
});
