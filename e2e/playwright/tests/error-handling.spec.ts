import { expect, test } from "@playwright/test";

const INTERVIEW_URL = "/interview?session_id=test-err-session&mode=single&provider=openai";

async function grantMicrophone(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () =>
          ({ getTracks: () => [], getAudioTracks: () => [] }) as unknown as MediaStream,
      },
      writable: true,
    });
  });
}

// ── Home page ────────────────────────────────────────────────────────────────

test("home: network error shows inline banner, no alert", async ({ page }) => {
  await page.route("**/sessions", async (route) => {
    await route.abort("failed");
  });

  let alertFired = false;
  page.on("dialog", async (d) => { alertFired = true; await d.dismiss(); });

  await page.goto("/");
  await page.locator("button").filter({ hasText: "開始面試" }).click();

  await expect(page.locator("text=無法連線到後端伺服器")).toBeVisible();
  expect(alertFired).toBe(false);
});

test("home: 429 error shows quota message in inline banner", async ({ page }) => {
  await page.route("**/sessions", async (route) => {
    await route.fulfill({ status: 429, body: "Too Many Requests" });
  });

  await page.goto("/");
  await page.locator("button").filter({ hasText: "開始面試" }).click();

  await expect(page.locator("text=API 使用額度不足")).toBeVisible();
});

test("home: 404 error shows model not found message", async ({ page }) => {
  await page.route("**/sessions", async (route) => {
    await route.fulfill({ status: 404, body: "Not Found" });
  });

  await page.goto("/");
  await page.locator("button").filter({ hasText: "開始面試" }).click();

  await expect(page.locator("text=指定的 AI 模型不存在")).toBeVisible();
});

test("home: banner clears on retry attempt", async ({ page }) => {
  let callCount = 0;
  await page.route("**/sessions", async (route) => {
    callCount++;
    if (callCount === 1) {
      await route.abort("failed");
    } else {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: "retry-session-123",
          mode: "single",
          eval_provider: "openai",
          status: "active",
          started_at: new Date().toISOString(),
        }),
      });
    }
  });

  await page.goto("/");
  await page.locator("button").filter({ hasText: "開始面試" }).click();
  await expect(page.locator("text=無法連線到後端伺服器")).toBeVisible();

  // Second click clears the banner and navigates
  await page.locator("button").filter({ hasText: "開始面試" }).click();
  await expect(page).toHaveURL(/\/interview\?session_id=retry-session-123/);
});

// ── Interview page — ErrorOverlay ────────────────────────────────────────────

test("interview: ApiError (429) shows red ErrorOverlay", async ({ page }) => {
  await grantMicrophone(page);
  await page.route("**/realtime/client-secret", async (route) => {
    await route.fulfill({ status: 429, body: "quota exceeded" });
  });

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "允許並開始" }).click();

  await expect(page.locator("h2", { hasText: "連線發生錯誤" })).toBeVisible({ timeout: 8000 });
  await expect(page.locator("text=API 使用額度不足")).toBeVisible();
  await expect(page.locator("text=系統錯誤")).toBeVisible();
});

test("interview: network error shows amber ErrorOverlay", async ({ page }) => {
  await grantMicrophone(page);
  await page.route("**/realtime/client-secret", async (route) => {
    await route.abort("failed");
  });

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "允許並開始" }).click();

  await expect(page.locator("h2", { hasText: "無法連線到伺服器" })).toBeVisible({ timeout: 8000 });
  await expect(page.locator("text=無法連線到後端伺服器")).toBeVisible();
  await expect(page.locator("text=連線錯誤")).toBeVisible();
});

test("interview: ErrorOverlay '返回首頁' navigates to home", async ({ page }) => {
  await grantMicrophone(page);
  await page.route("**/realtime/client-secret", async (route) => {
    await route.abort("failed");
  });

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "允許並開始" }).click();
  await expect(page.locator("h2", { hasText: "無法連線到伺服器" })).toBeVisible({ timeout: 8000 });

  await page.getByRole("button", { name: "返回首頁" }).click();
  await expect(page).toHaveURL("/");
});

test("interview: ErrorOverlay '重試' dismisses overlay and retries", async ({ page }) => {
  await grantMicrophone(page);
  let callCount = 0;
  await page.route("**/realtime/client-secret", async (route) => {
    callCount++;
    await route.abort("failed");
  });

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "允許並開始" }).click();
  await expect(page.locator("h2", { hasText: "無法連線到伺服器" })).toBeVisible({ timeout: 8000 });

  const firstCount = callCount;
  await page.getByRole("button", { name: "重試" }).click();

  // Overlay briefly disappears, then reappears after second failed attempt
  await expect(page.locator("h2", { hasText: "無法連線到伺服器" })).toBeVisible({ timeout: 8000 });
  expect(callCount).toBeGreaterThan(firstCount);
});
