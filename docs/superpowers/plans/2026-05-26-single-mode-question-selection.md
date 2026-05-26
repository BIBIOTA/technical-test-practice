# Single Mode Question Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users browse all questions and pick a specific one before starting a Single Mode interview session.

**Architecture:** Add a `GET /questions` list endpoint and a `question_id` filter to `GET /questions/next` on the backend. On the frontend, add a question browser page at `/questions/select` that Single Mode routes through; pass the selected `question_id` via URL to the interview page; `RealtimeClient` injects it when the AI calls `get_next_question`.

**Tech Stack:** FastAPI, SQLAlchemy (async raw SQL), Next.js 14 (App Router), TypeScript, Tailwind CSS, Playwright

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `backend/app/services/sm2.py` | Add `question_id` param to `select_next_question`; add `list_questions` |
| Modify | `backend/app/routers/questions.py` | Expose `GET /questions` and update `GET /questions/next` to accept `question_id` |
| Modify | `e2e/api/tests/test_questions.py` | Tests for new endpoints |
| Modify | `frontend/lib/api.ts` | Add `QuestionSummary`, `listQuestions()`, update `getNextQuestion()` |
| Modify | `frontend/lib/realtimeClient.ts` | Accept `pinnedQuestionId` option |
| Create | `frontend/app/questions/select/page.tsx` | Question browser UI |
| Modify | `frontend/app/page.tsx` | Single Mode → `/questions/select`, not session create |
| Modify | `frontend/app/interview/page.tsx` | Read `question_id` from URL, pass to `RealtimeClient` |
| Modify | `e2e/playwright/tests/home.spec.ts` | Update and add home page routing tests |
| Create | `e2e/playwright/tests/question-select.spec.ts` | Playwright tests for question browser |

---

## Task 1: Backend — `question_id` filter in `select_next_question`

**Files:**
- Modify: `backend/app/services/sm2.py`
- Modify: `backend/app/routers/questions.py`
- Test: `e2e/api/tests/test_questions.py`

- [ ] **Step 1: Write the failing API test**

Add to `e2e/api/tests/test_questions.py`:

```python
def test_get_next_question_by_id(client, question_id):
    response = client.get(f"/questions/next?question_id={question_id}&mode=single")

    assert response.status_code == 200
    body = response.json()
    assert body["question_id"] == question_id
    assert "question_text" in body
    assert "sm2" in body


def test_get_next_question_by_id_not_found(client):
    fake_id = "00000000-0000-0000-0000-000000000000"
    response = client.get(f"/questions/next?question_id={fake_id}&mode=single")

    assert response.status_code == 404
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
make test-env-up
cd e2e && python -m pytest api/tests/test_questions.py::test_get_next_question_by_id api/tests/test_questions.py::test_get_next_question_by_id_not_found -v
```

Expected: FAIL — the endpoint does not yet accept `question_id`.

- [ ] **Step 3: Add `question_id` parameter to `select_next_question` in `sm2.py`**

Replace the function signature and add the new filter block. The full updated function (replace everything from `async def select_next_question` to the end of the function):

```python
async def select_next_question(
    db: AsyncSession,
    session_id: uuid.UUID | None = None,
    category: str | None = None,
    difficulty: str | None = None,
    mode: str | None = None,
    question_id: uuid.UUID | None = None,
) -> dict | None:
    filters = ["1=1"]
    params: dict = {}

    if question_id:
        filters.append("q.id = :question_id")
        params["question_id"] = str(question_id)
    else:
        if category:
            filters.append("q.category = :category")
            params["category"] = category

        if difficulty:
            filters.append("q.difficulty = :difficulty")
            params["difficulty"] = difficulty

        if mode == "weak_review":
            filters.append("s.next_review_at <= NOW()")
            filters.append("s.last_score < 60")

        if session_id:
            filters.append(
                "q.id NOT IN (SELECT question_id FROM attempts WHERE session_id = :session_id)"
            )
            params["session_id"] = str(session_id)

    where_clause = " AND ".join(filters)

    query = text(f"""
        SELECT
            q.id,
            q.text,
            q.category,
            q.difficulty,
            q.reference_answer,
            q.tags,
            s.ease_factor,
            s.interval_days,
            s.repetitions,
            s.next_review_at,
            s.last_score
        FROM questions q
        LEFT JOIN sm2_states s ON s.question_id = q.id
        WHERE {where_clause}
        ORDER BY
            (s.id IS NULL) DESC,
            (s.next_review_at <= NOW()) DESC,
            s.next_review_at ASC NULLS FIRST,
            s.last_score ASC NULLS FIRST
        LIMIT 1
    """)

    result = await db.execute(query, params)
    row = result.mappings().first()
    if row is None:
        return None
    return dict(row)
```

- [ ] **Step 4: Update `GET /questions/next` router to accept `question_id`**

In `backend/app/routers/questions.py`, replace the entire file:

```python
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, verify_token
from app.services.sm2 import select_next_question

router = APIRouter(prefix="/questions", tags=["questions"])


@router.get("/next")
async def get_next_question(
    session_id: uuid.UUID | None = None,
    category: str | None = None,
    difficulty: str | None = None,
    mode: str | None = None,
    question_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    question = await select_next_question(
        db,
        session_id=session_id,
        category=category,
        difficulty=difficulty,
        mode=mode,
        question_id=question_id,
    )
    if question is None:
        raise HTTPException(status_code=404, detail="No available question")

    return {
        "question_id": str(question["id"]),
        "question_text": question["text"],
        "category": question["category"],
        "difficulty": question["difficulty"],
        "tags": question["tags"] or [],
        "sm2": {
            "ease_factor": question["ease_factor"],
            "interval_days": question["interval_days"],
            "next_review_at": str(question["next_review_at"]) if question["next_review_at"] else None,
            "last_score": question["last_score"],
        },
    }
```

Note: `GET /questions` will be added in Task 2 — keep this file as-is for now (the import for `text` and `list_questions` will come in Task 2).

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
cd e2e && python -m pytest api/tests/test_questions.py::test_get_next_question_by_id api/tests/test_questions.py::test_get_next_question_by_id_not_found -v
```

Expected: PASS for both tests.

- [ ] **Step 6: Run full API test suite to check for regressions**

```bash
make test-api
```

Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/sm2.py backend/app/routers/questions.py e2e/api/tests/test_questions.py
git commit -m "feat(backend): add question_id filter to GET /questions/next"
```

---

## Task 2: Backend — `GET /questions` list endpoint

**Files:**
- Modify: `backend/app/services/sm2.py`
- Modify: `backend/app/routers/questions.py`
- Test: `e2e/api/tests/test_questions.py`

- [ ] **Step 1: Write the failing API test**

Add to `e2e/api/tests/test_questions.py`:

```python
def test_list_questions(client, question_id):
    response = client.get("/questions")

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) >= 1

    ids = [q["question_id"] for q in body]
    assert question_id in ids

    first = next(q for q in body if q["question_id"] == question_id)
    assert "question_text" in first
    assert "category" in first
    assert "difficulty" in first
    assert isinstance(first["tags"], list)
    assert "sm2" in first
    assert "last_score" in first["sm2"]


def test_list_questions_filter_by_category(client, question_id):
    response = client.get("/questions?category=backend")

    assert response.status_code == 200
    body = response.json()
    assert all(q["category"] == "backend" for q in body)


def test_list_questions_filter_by_difficulty(client, question_id):
    response = client.get("/questions?difficulty=easy")

    assert response.status_code == 200
    body = response.json()
    assert all(q["difficulty"] == "easy" for q in body)


def test_list_questions_no_token(anon_client):
    response = anon_client.get("/questions")

    assert response.status_code == 401
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd e2e && python -m pytest api/tests/test_questions.py::test_list_questions api/tests/test_questions.py::test_list_questions_filter_by_category api/tests/test_questions.py::test_list_questions_filter_by_difficulty api/tests/test_questions.py::test_list_questions_no_token -v
```

Expected: FAIL — `GET /questions` route does not exist yet (404).

- [ ] **Step 3: Add `list_questions` to `sm2.py`**

Append this function to the end of `backend/app/services/sm2.py`:

```python
async def list_questions(
    db: AsyncSession,
    category: str | None = None,
    difficulty: str | None = None,
) -> list[dict]:
    filters = ["1=1"]
    params: dict = {}

    if category:
        filters.append("q.category = :category")
        params["category"] = category

    if difficulty:
        filters.append("q.difficulty = :difficulty")
        params["difficulty"] = difficulty

    where_clause = " AND ".join(filters)

    query = text(f"""
        SELECT
            q.id,
            q.text,
            q.category,
            q.difficulty,
            q.tags,
            s.last_score
        FROM questions q
        LEFT JOIN sm2_states s ON s.question_id = q.id
        WHERE {where_clause}
        ORDER BY q.category, q.difficulty
    """)

    result = await db.execute(query, params)
    rows = result.mappings().all()

    return [
        {
            "question_id": str(row["id"]),
            "question_text": row["text"],
            "category": row["category"],
            "difficulty": row["difficulty"],
            "tags": row["tags"] or [],
            "sm2": {"last_score": row["last_score"]},
        }
        for row in rows
    ]
```

- [ ] **Step 4: Add `GET /questions` route to `questions.py`**

Replace the entire `backend/app/routers/questions.py` with the version that includes both endpoints:

```python
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, verify_token
from app.services.sm2 import list_questions as sm2_list_questions
from app.services.sm2 import select_next_question

router = APIRouter(prefix="/questions", tags=["questions"])


@router.get("")
async def get_questions(
    category: str | None = None,
    difficulty: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> list[dict]:
    return await sm2_list_questions(db, category=category, difficulty=difficulty)


@router.get("/next")
async def get_next_question(
    session_id: uuid.UUID | None = None,
    category: str | None = None,
    difficulty: str | None = None,
    mode: str | None = None,
    question_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    question = await select_next_question(
        db,
        session_id=session_id,
        category=category,
        difficulty=difficulty,
        mode=mode,
        question_id=question_id,
    )
    if question is None:
        raise HTTPException(status_code=404, detail="No available question")

    return {
        "question_id": str(question["id"]),
        "question_text": question["text"],
        "category": question["category"],
        "difficulty": question["difficulty"],
        "tags": question["tags"] or [],
        "sm2": {
            "ease_factor": question["ease_factor"],
            "interval_days": question["interval_days"],
            "next_review_at": str(question["next_review_at"]) if question["next_review_at"] else None,
            "last_score": question["last_score"],
        },
    }
```

- [ ] **Step 5: Run the new tests and confirm they pass**

```bash
cd e2e && python -m pytest api/tests/test_questions.py::test_list_questions api/tests/test_questions.py::test_list_questions_filter_by_category api/tests/test_questions.py::test_list_questions_filter_by_difficulty api/tests/test_questions.py::test_list_questions_no_token -v
```

Expected: PASS for all four tests.

- [ ] **Step 6: Run full API test suite**

```bash
make test-api
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/sm2.py backend/app/routers/questions.py e2e/api/tests/test_questions.py
git commit -m "feat(backend): add GET /questions list endpoint"
```

---

## Task 3: Frontend — Update `api.ts`

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add `QuestionSummary` interface and `listQuestions` function**

In `frontend/lib/api.ts`, after the `NextQuestion` interface, add:

```typescript
export interface QuestionSummary {
  question_id: string;
  question_text: string;
  category: string;
  difficulty: string;
  tags: string[];
  sm2: { last_score: number | null };
}

export function listQuestions(category?: string, difficulty?: string): Promise<QuestionSummary[]> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);
  const qs = params.toString();
  return apiFetch(`/questions${qs ? `?${qs}` : ""}`);
}
```

- [ ] **Step 2: Update `getNextQuestion` to accept `questionId`**

Replace the existing `getNextQuestion` function:

```typescript
export function getNextQuestion(
  sessionId: string,
  mode: string,
  category?: string,
  difficulty?: string,
  questionId?: string
): Promise<NextQuestion> {
  const params = new URLSearchParams({ session_id: sessionId, mode });
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);
  if (questionId) params.set("question_id", questionId);
  return apiFetch(`/questions/next?${params}`);
}
```

- [ ] **Step 3: Lint check**

```bash
cd frontend && npm run lint
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(frontend): add listQuestions and questionId param to getNextQuestion"
```

---

## Task 4: Frontend — Update `RealtimeClient` with `pinnedQuestionId`

**Files:**
- Modify: `frontend/lib/realtimeClient.ts`

- [ ] **Step 1: Add `pinnedQuestionId` field and constructor option**

In `frontend/lib/realtimeClient.ts`, update the class definition. Add the private field after `private currentQuestionId`:

```typescript
private pinnedQuestionId: string | null;
```

Update the constructor signature and body (replace the existing constructor):

```typescript
constructor(
  sessionId: string,
  mode: string,
  callbacks: RealtimeCallbacks,
  options?: { pinnedQuestionId?: string }
) {
  this.sessionId = sessionId;
  this.mode = mode;
  this.callbacks = callbacks;
  this.pinnedQuestionId = options?.pinnedQuestionId ?? null;
}
```

- [ ] **Step 2: Use `pinnedQuestionId` in `handleToolCall`**

In the `get_next_question` branch of `handleToolCall`, replace:

```typescript
const q = await getNextQuestion(
  this.sessionId,
  args.mode ?? this.mode,
  args.category,
  args.difficulty
);
```

with:

```typescript
const q = await getNextQuestion(
  this.sessionId,
  args.mode ?? this.mode,
  args.category,
  args.difficulty,
  this.pinnedQuestionId ?? undefined
);
```

- [ ] **Step 3: Lint check**

```bash
cd frontend && npm run lint
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/realtimeClient.ts
git commit -m "feat(frontend): add pinnedQuestionId option to RealtimeClient"
```

---

## Task 5: Frontend — Create question browser page

**Files:**
- Create: `frontend/app/questions/select/page.tsx`

- [ ] **Step 1: Create the file**

Create `frontend/app/questions/select/page.tsx` with this content:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createSession, listQuestions, type QuestionSummary } from "../../../lib/api";
import { parseConnectionError } from "../../../lib/errors";

const CATEGORY_COLORS: Record<string, string> = {
  "llm-engineering": "#6C63FF",
  "testing": "#4ECDC4",
  "auth": "#F59E0B",
  "backend": "#10B981",
  "frontend": "#3B82F6",
};
const DEFAULT_COLOR = "#6B7280";

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "#10B981",
  medium: "#F59E0B",
  hard: "#EF4444",
};

function catColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? DEFAULT_COLOR;
}

function diffColor(diff: string): string {
  return DIFFICULTY_COLORS[diff] ?? DEFAULT_COLOR;
}

function QuestionSelectContent() {
  const router = useRouter();
  const params = useSearchParams();
  const provider = params.get("provider") ?? "openai";

  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setFetchError(null);
    try {
      setQuestions(await listQuestions());
    } catch (err) {
      setFetchError(parseConnectionError(err).message);
    } finally {
      setLoading(false);
    }
  }

  const categories = Array.from(new Set(questions.map((q) => q.category))).sort();

  const filtered = questions.filter((q) => {
    if (categoryFilter !== "all" && q.category !== categoryFilter) return false;
    if (difficultyFilter !== "all" && q.difficulty !== difficultyFilter) return false;
    return true;
  });

  async function handleSelect(question: QuestionSummary) {
    setStartError(null);
    setStartingId(question.question_id);
    try {
      const session = await createSession("single", provider);
      router.push(
        `/interview?session_id=${session.session_id}&mode=single&provider=${provider}&question_id=${question.question_id}`
      );
    } catch (err) {
      setStartError(parseConnectionError(err).message);
      setStartingId(null);
    }
  }

  const selectStyle = {
    background: "var(--color-surface)",
    borderColor: "var(--color-border)",
    color: "var(--color-text-primary)",
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header
        className="flex items-center justify-between px-10 border-b"
        style={{ height: 64, borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
            style={{ background: "var(--color-primary)" }}
          >
            I
          </div>
          <span className="font-semibold text-lg" style={{ color: "var(--color-text-primary)" }}>
            Interview Practice
          </span>
        </div>
        <button
          onClick={() => router.push("/")}
          className="text-sm px-4 py-2 rounded-lg border transition-all"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)", background: "var(--color-surface-elevated)" }}
        >
          ← 返回
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center gap-8" style={{ padding: "48px 120px" }}>
        <div className="text-center">
          <h1 className="font-bold text-4xl mb-2" style={{ color: "var(--color-text-primary)" }}>
            選擇練習題目
          </h1>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>Single Mode</p>
        </div>

        <div className="flex gap-3 w-full max-w-3xl">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm"
            style={selectStyle}
          >
            <option value="all">全部類別</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={difficultyFilter}
            onChange={(e) => setDifficultyFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm"
            style={selectStyle}
          >
            <option value="all">全部難度</option>
            {(["easy", "medium", "hard"] as const).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-3xl">
          {loading && (
            <p className="text-sm text-center py-6" style={{ color: "var(--color-text-secondary)" }}>
              載入中...
            </p>
          )}

          {fetchError && (
            <div
              className="flex flex-col gap-3 items-center py-6"
              style={{ background: "#F0444414", border: "1px solid #F0444440", borderRadius: 10 }}
            >
              <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{fetchError}</p>
              <button
                onClick={load}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-primary)" }}
              >
                重試
              </button>
            </div>
          )}

          {!loading && !fetchError && filtered.length === 0 && (
            <p className="text-sm text-center py-6" style={{ color: "var(--color-text-secondary)" }}>
              {questions.length === 0 ? "目前沒有可用的題目" : "沒有符合條件的題目"}
            </p>
          )}

          {filtered.map((q) => {
            const cc = catColor(q.category);
            const dc = diffColor(q.difficulty);
            const isStarting = startingId === q.question_id;
            return (
              <div
                key={q.question_id}
                className="flex items-center justify-between gap-4 px-5 py-4 rounded-xl border"
                style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
              >
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={{ background: `${cc}1F`, color: cc }}
                    >
                      {q.category}
                    </span>
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={{ background: `${dc}1F`, color: dc }}
                    >
                      {q.difficulty}
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                      {q.sm2.last_score !== null ? `上次：${q.sm2.last_score} 分` : "尚未練習"}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-primary)" }}>
                    {q.question_text.length > 60 ? q.question_text.slice(0, 60) + "…" : q.question_text}
                  </p>
                </div>
                <button
                  onClick={() => handleSelect(q)}
                  disabled={startingId !== null}
                  className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
                  style={{ background: "var(--color-primary)" }}
                >
                  {isStarting ? "建立中..." : "選擇練習"}
                </button>
              </div>
            );
          })}

          {startError && (
            <div
              className="px-4 py-3 text-sm"
              style={{ background: "#F0444414", border: "1px solid #F0444440", borderRadius: 10, color: "var(--color-text-primary)" }}
            >
              {startError}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function QuestionSelectPage() {
  return (
    <Suspense fallback={<div>載入中...</div>}>
      <QuestionSelectContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Lint and build check**

```bash
cd frontend && npm run lint && npm run build
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/questions/select/page.tsx
git commit -m "feat(frontend): add question browser page at /questions/select"
```

---

## Task 6: Frontend — Update home page Single Mode routing + Playwright tests

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `e2e/playwright/tests/home.spec.ts`

- [ ] **Step 1: Write the new Playwright test for Single Mode routing**

In `e2e/playwright/tests/home.spec.ts`, replace the test `"clicking start session navigates to interview page"` with these two tests:

```typescript
test("Single Mode start navigates to question selection page", async ({ page }) => {
  await page.goto("/");
  // Single Mode is selected by default
  await page.locator("button").filter({ hasText: "開始面試" }).click();

  await expect(page).toHaveURL(/\/questions\/select\?provider=openai/);
});

test("Mock Mode start creates session and navigates to interview page", async ({ page }) => {
  await page.route("**/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: "test-session-uuid-1234",
          mode: "mock",
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
  await page.locator("button").filter({ hasText: "Mock Interview" }).click();
  await page.locator("button").filter({ hasText: "開始面試" }).click();

  await expect(page).toHaveURL(/\/interview\?session_id=test-session-uuid-1234/);
});
```

Also update the `"API failure on start shows inline error banner (no alert)"` test to use Mock mode (since Single mode no longer calls the API on start). Replace the test body:

```typescript
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
  await page.locator("button").filter({ hasText: "Mock Interview" }).click();
  await page.locator("button").filter({ hasText: "開始面試" }).click();

  await expect(page.locator("text=伺服器發生錯誤")).toBeVisible();
  expect(alertFired).toBe(false);
});
```

- [ ] **Step 2: Run the Playwright home tests and confirm they fail**

```bash
make test-env-up
cd e2e && npx playwright test playwright/tests/home.spec.ts --reporter=line
```

Expected: `"Single Mode start navigates to question selection page"` fails (still goes to interview), others may fail too.

- [ ] **Step 3: Update `handleStart` in `frontend/app/page.tsx`**

Replace the `handleStart` function:

```typescript
async function handleStart() {
  setSessionError(null);

  if (selectedMode === "single") {
    router.push(`/questions/select?provider=${evalProvider}`);
    return;
  }

  setLoading(true);
  try {
    const session = await createSession(selectedMode, evalProvider);
    router.push(
      `/interview?session_id=${session.session_id}&mode=${selectedMode}&provider=${evalProvider}`
    );
  } catch (err) {
    const { message } = parseConnectionError(err);
    setSessionError(message);
  } finally {
    setLoading(false);
  }
}
```

- [ ] **Step 4: Run the Playwright home tests and confirm they pass**

```bash
cd e2e && npx playwright test playwright/tests/home.spec.ts --reporter=line
```

Expected: All 6 tests pass.

- [ ] **Step 5: Lint check**

```bash
cd frontend && npm run lint
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx e2e/playwright/tests/home.spec.ts
git commit -m "feat(frontend): route Single Mode through question browser page"
```

---

## Task 7: Frontend — Interview page reads `question_id` from URL

**Files:**
- Modify: `frontend/app/interview/page.tsx`

- [ ] **Step 1: Read `question_id` from URL and pass to `RealtimeClient`**

In `frontend/app/interview/page.tsx`, update `InterviewContent`:

After the existing `const provider = params.get("provider") ?? "openai";` line, add:

```typescript
const questionId = params.get("question_id") ?? undefined;
```

Then find where `RealtimeClient` is constructed (inside `startSession`):

```typescript
const client = new RealtimeClient(sessionId, mode, {
```

Replace it with:

```typescript
const client = new RealtimeClient(sessionId, mode, {
  onTranscript: (msg) => setTranscripts((prev) => {
    if (msg.isTyping) {
      return [...prev.filter((m) => !(m.role === msg.role && m.isTyping)), msg];
    }
    return [...prev.filter((m) => !(m.role === msg.role && m.isTyping)), msg];
  }),
  onQuestion: (q) => {
    setCurrentQuestion({
      question_id: q.question_id,
      question_text: q.question_text,
      category: q.category,
      difficulty: q.difficulty,
      tags: [],
      sm2: { ease_factor: null, interval_days: null, next_review_at: null, last_score: null },
    });
    setQuestionIndex((i) => i + 1);
  },
  onEvalResult: (result) => {
    setEvalResult(result as EvaluationResult);
    setAnswerSummary(result.summary);
    setIsCompleted(true);
    setActiveTab("eval");
  },
  onStatusChange: setConnectionStatus,
  onError: (msg) => {
    const parsed = parseConnectionError(new Error(msg));
    setToastError({ ...parsed, severity: "warning" });
  },
}, { pinnedQuestionId: questionId });
```

The only change is adding `, { pinnedQuestionId: questionId }` as the fourth constructor argument.

- [ ] **Step 2: Lint check**

```bash
cd frontend && npm run lint
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/interview/page.tsx
git commit -m "feat(frontend): pass question_id from URL to RealtimeClient as pinnedQuestionId"
```

---

## Task 8: Playwright tests for question browser page

**Files:**
- Create: `e2e/playwright/tests/question-select.spec.ts`

- [ ] **Step 1: Create the test file**

Create `e2e/playwright/tests/question-select.spec.ts`:

```typescript
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
        ]),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto(QUESTIONS_URL);
  await page.selectOption("select >> nth=0", "auth");

  await expect(page.getByText("沒有符合條件的題目")).toBeVisible();
});

test("back button navigates to home", async ({ page }) => {
  await mockQuestions(page);
  await page.goto(QUESTIONS_URL);

  await page.getByRole("button", { name: "← 返回" }).click();

  await expect(page).toHaveURL("/");
});
```

- [ ] **Step 2: Run the Playwright tests**

```bash
cd e2e && npx playwright test playwright/tests/question-select.spec.ts --reporter=line
```

Expected: All 7 tests pass.

- [ ] **Step 3: Run the full test suite**

```bash
make test
```

Expected: All API and Playwright tests pass.

- [ ] **Step 4: Commit**

```bash
git add e2e/playwright/tests/question-select.spec.ts
git commit -m "test(e2e): add Playwright tests for question browser page"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `GET /questions` list endpoint | Task 2 |
| `GET /questions/next?question_id=` | Task 1 |
| Question browser page at `/questions/select` | Task 5 |
| Category + difficulty filters (client-side) | Task 5 |
| Card shows text preview / category / difficulty / last score | Task 5 |
| Single Mode home → `/questions/select` | Task 6 |
| Mock/Weak Review home behavior unchanged | Task 6 (not modified) |
| `RealtimeClient` pinnedQuestionId | Task 4 |
| Interview page reads `question_id` from URL | Task 7 |
| Error: fetch failure → retry button | Task 5 + Task 8 |
| Error: empty filtered result message | Task 5 + Task 8 |
| Error: `createSession` failure → inline error | Task 5 + Task 8 |

All requirements covered.

**Placeholder scan:** None found. All steps have exact code, exact commands, and expected output.

**Type consistency:**
- `QuestionSummary.question_id` (string) used consistently across `api.ts`, `page.tsx`, Playwright mock data
- `RealtimeClient` constructor 4th arg `{ pinnedQuestionId?: string }` matches usage in `interview/page.tsx`
- `getNextQuestion` 5th param `questionId?: string` matches call in `realtimeClient.ts`
- `list_questions` in `sm2.py` matches import alias `sm2_list_questions` in `questions.py`
