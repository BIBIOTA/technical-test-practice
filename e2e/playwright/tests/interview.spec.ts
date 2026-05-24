import { expect, test } from "@playwright/test";

const INTERVIEW_URL = "/interview?session_id=test-session-uuid&mode=single&provider=openai";

async function denyMicrophone(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
      writable: true,
    });
  });
}

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

async function mockRealtimeStartup(page: import("@playwright/test").Page) {
  await page.route("**/realtime/client-secret", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        client_secret: "test-secret",
        expires_at: null,
        openai_session_id: "test-openai-session",
      }),
    });
  });

  await page.route("https://api.openai.com/v1/realtime**", async (route) => {
    await route.fulfill({ status: 500, body: "blocked in e2e" });
  });
}

test("interview page shows mic permission overlay on load", async ({ page }) => {
  await page.goto(INTERVIEW_URL);

  await expect(page.locator("text=需要麥克風權限")).toBeVisible();
  await expect(page.locator("button", { hasText: "允許並開始" })).toBeVisible();
});

test("denied mic shows error overlay", async ({ page }) => {
  await denyMicrophone(page);

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "允許並開始" }).click();

  await expect(page.locator("text=麥克風存取被拒")).toBeVisible();
});

test("back button after mic denial navigates to home", async ({ page }) => {
  await denyMicrophone(page);

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "允許並開始" }).click();
  await expect(page.locator("text=麥克風存取被拒")).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();

  await expect(page).toHaveURL("/");
});

test("can switch between transcript and eval tabs", async ({ page }) => {
  await grantMicrophone(page);
  await mockRealtimeStartup(page);

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "允許並開始" }).click();
  await expect(page.locator("text=需要麥克風權限")).not.toBeVisible({ timeout: 5000 });

  const evalTab = page.locator("button", { hasText: "評分結果" });
  const transcriptTab = page.locator("button", { hasText: "對話紀錄" });

  await evalTab.click();
  await expect(evalTab).toHaveCSS("font-weight", "600");

  await transcriptTab.click();
  await expect(transcriptTab).toHaveCSS("font-weight", "600");
});

test("end session button navigates back to home", async ({ page }) => {
  await grantMicrophone(page);
  await mockRealtimeStartup(page);

  await page.route("**/sessions/*/complete", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session_id: "test-session-uuid", status: "completed" }),
    });
  });

  await page.goto(INTERVIEW_URL);
  await page.locator("button", { hasText: "允許並開始" }).click();
  await expect(page.locator("text=需要麥克風權限")).not.toBeVisible({ timeout: 5000 });

  await page.locator("button", { hasText: "結束面試" }).click();

  await expect(page).toHaveURL("/");
});
