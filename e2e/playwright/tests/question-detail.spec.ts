import { expect, test, type Page } from "@playwright/test";

const QUESTION_ID = "aaaa0000-0000-0000-0000-000000000001";
const PROVIDER = "openai";
const DETAIL_URL = `/questions/${QUESTION_ID}?provider=${PROVIDER}`;

const FULL_DETAIL = {
  question_id: QUESTION_ID,
  question_text: "請說明 JWT Token 的結構與運作流程，包含雙 Token 機制的優缺點。",
  category: "auth",
  difficulty: "medium",
  tags: ["auth", "jwt"],
  reference_answer:
    "JWT 由 header、payload、signature 三段組成，使用 base64url 編碼後以點號連接。雙 Token 機制使用短效 access token 與長效 refresh token，可降低 token 外洩風險。",
  key_points: [
    { point: "解釋 JWT 三段結構", weight: 0.5 },
    { point: "說明雙 Token 機制的優缺點", weight: 0.5 },
  ],
  common_mistakes: [
    "未說明 signature 的驗證流程",
    "未提及 token 外洩後的失效策略",
  ],
};

const LIST_QUESTIONS = [
  {
    question_id: QUESTION_ID,
    question_text: FULL_DETAIL.question_text,
    category: FULL_DETAIL.category,
    difficulty: FULL_DETAIL.difficulty,
    tags: FULL_DETAIL.tags,
    sm2: { last_score: 72 },
  },
];

async function mockDetail(page: Page, override: Partial<typeof FULL_DETAIL> = {}) {
  await page.route(`**/api/questions/${QUESTION_ID}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...FULL_DETAIL, ...override }),
      });
    } else {
      await route.continue();
    }
  });
}

async function mockList(page: Page) {
  await page.route("**/api/questions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(LIST_QUESTIONS),
      });
    } else {
      await route.continue();
    }
  });
}

test("Entry from selection list preserves provider", async ({ page }) => {
  await mockList(page);
  await mockDetail(page);

  await page.goto(`/questions/select?provider=${PROVIDER}`);

  const viewButton = page.getByRole("button", { name: "查看內容" }).first();
  await viewButton.click();

  await expect(page).toHaveURL(new RegExp(`/questions/${QUESTION_ID}\\?provider=${PROVIDER}`));
});

test("All four regions render", async ({ page }) => {
  await mockDetail(page);

  await page.goto(DETAIL_URL);

  await expect(page.getByText(FULL_DETAIL.question_text)).toBeVisible();
  await expect(page.getByText("auth", { exact: true })).toBeVisible();
  await expect(page.getByText("medium", { exact: true })).toBeVisible();
  await expect(page.getByText(/JWT 由 header、payload、signature/)).toBeVisible();
  await expect(page.getByText("解釋 JWT 三段結構")).toBeVisible();
  await expect(page.getByText("未說明 signature 的驗證流程")).toBeVisible();
});

test("Empty key_points renders fallback", async ({ page }) => {
  await mockDetail(page, { key_points: [] });

  await page.goto(DETAIL_URL);

  await expect(page.getByText("（尚無評分要點）")).toBeVisible();
});

test("Empty common_mistakes renders fallback", async ({ page }) => {
  await mockDetail(page, { common_mistakes: [] });

  await page.goto(DETAIL_URL);

  await expect(page.getByText("（尚無常見錯誤紀錄）")).toBeVisible();
});

test("Network failure shows retry", async ({ page }) => {
  await page.route(`**/api/questions/${QUESTION_ID}`, async (route) => {
    await route.abort("failed");
  });

  await page.goto(DETAIL_URL);

  await expect(
    page.getByText("無法連線到後端伺服器，請確認伺服器已啟動後重試。")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
});

test("Question not found shows empty state", async ({ page }) => {
  await page.route(`**/api/questions/${QUESTION_ID}`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Question not found" }),
    });
  });

  await page.goto(DETAIL_URL);

  await expect(page.getByText("找不到這題，可能已被移除。")).toBeVisible();
  await expect(page.getByRole("button", { name: "返回選題" })).toBeVisible();
});

test("Other fetch errors show generic retry", async ({ page }) => {
  await page.route(`**/api/questions/${QUESTION_ID}`, async (route) => {
    await route.fulfill({ status: 500, body: "Internal Server Error" });
  });

  await page.goto(DETAIL_URL);

  await expect(page.getByText("無法載入題目內容，請稍後再試。")).toBeVisible();
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
});

test("Start practice creates session and navigates", async ({ page }) => {
  await mockDetail(page);

  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: "new-session-uuid",
          mode: "single",
          eval_provider: PROVIDER,
          status: "active",
          started_at: new Date().toISOString(),
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto(DETAIL_URL);

  await page.getByRole("button", { name: "開始練習這題" }).click();

  await expect(page).toHaveURL(
    new RegExp(
      `/interview\\?session_id=new-session-uuid&mode=single&provider=${PROVIDER}&question_id=${QUESTION_ID}`
    )
  );
});

test("createSession failure shows inline error", async ({ page }) => {
  await mockDetail(page);

  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    } else {
      await route.continue();
    }
  });

  await page.goto(DETAIL_URL);

  await page.getByRole("button", { name: "開始練習這題" }).click();

  await expect(page.getByText("建立練習失敗，請稍後再試。")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/questions/${QUESTION_ID}`));
});

test("Return preserves provider", async ({ page }) => {
  await mockDetail(page);

  await page.goto(DETAIL_URL);

  await page.getByRole("button", { name: "返回選題" }).click();

  await expect(page).toHaveURL(new RegExp(`/questions/select\\?provider=${PROVIDER}`));
});
