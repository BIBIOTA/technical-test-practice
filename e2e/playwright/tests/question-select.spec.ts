import { expect, test } from "@playwright/test";

const QUESTIONS_URL = "/questions/select?provider=openai";

const MOCK_QUESTIONS = [
  {
    question_id: "aaaa0000-0000-0000-0000-000000000001",
    question_text: "請說明 JWT Token 的結構與運作流程，包含雙 Token 機制的優缺點。",
    category: "auth",
    difficulty: "medium",
    tags: ["auth", "jwt"],
    sm2: { last_score: 72 },
  },
  {
    question_id: "bbbb0000-0000-0000-0000-000000000002",
    question_text: "請說明 BDD 是什麼？與 TDD 有何差異？",
    category: "testing",
    difficulty: "easy",
    tags: ["bdd", "testing"],
    sm2: { last_score: null },
  },
];

async function mockQuestions(page: import("@playwright/test").Page) {
  await page.route("**/questions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_QUESTIONS),
      });
    } else {
      await route.continue();
    }
  });
}

test("question browser page shows list of questions", async ({ page }) => {
  await mockQuestions(page);
  await page.goto(QUESTIONS_URL);

  await expect(page.locator("h1")).toContainText("選擇練習題目");
  await expect(page.getByText("請說明 JWT Token")).toBeVisible();
  await expect(page.getByText("請說明 BDD 是什麼")).toBeVisible();
});

test("shows last score when available and 尚未練習 when null", async ({ page }) => {
  await mockQuestions(page);
  await page.goto(QUESTIONS_URL);

  await expect(page.getByText("上次：72 分")).toBeVisible();
  await expect(page.getByText("尚未練習")).toBeVisible();
});

test("category filter shows only matching questions", async ({ page }) => {
  await mockQuestions(page);
  await page.goto(QUESTIONS_URL);

  await page.selectOption("select >> nth=0", "auth");

  await expect(page.getByText("請說明 JWT Token")).toBeVisible();
  await expect(page.getByText("請說明 BDD 是什麼")).not.toBeVisible();
});

test("difficulty filter shows only matching questions", async ({ page }) => {
  await mockQuestions(page);
  await page.goto(QUESTIONS_URL);

  await page.selectOption("select >> nth=1", "easy");

  await expect(page.getByText("請說明 BDD 是什麼")).toBeVisible();
  await expect(page.getByText("請說明 JWT Token")).not.toBeVisible();
});

test("selecting a question creates session and navigates to interview with question_id", async ({ page }) => {
  await mockQuestions(page);

  await page.route("**/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: "new-session-uuid",
          mode: "single",
          eval_provider: "openai",
          status: "active",
          started_at: new Date().toISOString(),
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto(QUESTIONS_URL);

  const firstSelectButton = page.getByRole("button", { name: "選擇練習" }).first();
  await firstSelectButton.click();

  await expect(page).toHaveURL(
    /\/interview\?session_id=new-session-uuid&mode=single&provider=openai&question_id=aaaa0000/
  );
});

test("API error shows error message with retry button", async ({ page }) => {
  await page.route("**/questions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 500, body: "Internal Server Error" });
    } else {
      await route.continue();
    }
  });

  await page.goto(QUESTIONS_URL);

  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
});

test("empty filtered result shows 沒有符合條件的題目", async ({ page }) => {
  await page.route("**/questions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            question_id: "cccc0000-0000-0000-0000-000000000003",
            question_text: "What is dependency injection?",
            category: "backend",
            difficulty: "easy",
            tags: [],
            sm2: { last_score: null },
          },
          {
            question_id: "dddd0000-0000-0000-0000-000000000004",
            question_text: "Explain JWT auth flow.",
            category: "auth",
            difficulty: "medium",
            tags: ["auth"],
            sm2: { last_score: null },
          },
        ]),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto(QUESTIONS_URL);
  await page.selectOption("select >> nth=0", "auth");
  await page.selectOption("select >> nth=1", "easy");

  await expect(page.getByText("沒有符合條件的題目")).toBeVisible();
});

test("back button navigates to home", async ({ page }) => {
  await mockQuestions(page);
  await page.goto(QUESTIONS_URL);

  await page.getByRole("button", { name: "← 返回" }).click();

  await expect(page).toHaveURL("/");
});
