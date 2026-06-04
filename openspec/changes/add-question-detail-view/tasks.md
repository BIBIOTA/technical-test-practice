# Tasks: add-question-detail-view

## 1. Backend — question detail service
- [x] 1.1 Add `get_question_detail(db, question_id)` service in `backend/app/services/sm2.py`
  - Acceptance: WHEN called with an existing UUID THEN returns a dict containing `question_id`, `question_text`, `category`, `difficulty`, `tags`, `reference_answer`, `key_points`, `common_mistakes` AND WHEN called with a nonexistent UUID THEN returns `None`
  - Depends on: -
  - Independence: independent

## 2. Backend — question detail router
- [x] 2.1 Add `GET /questions/{question_id}` endpoint in `backend/app/routers/questions.py`
  - Acceptance: WHEN the endpoint receives a valid existing UUID THEN responds 200 with the full payload from 1.1 AND WHEN the UUID does not exist THEN raises `HTTPException(404, "Question not found")` AND WHEN the path parameter is not a valid UUID THEN FastAPI returns 422 AND WHEN the token is missing or invalid THEN `verify_token` returns 401
  - Depends on: 1.1
  - Independence: serial

## 3. Backend — API e2e tests
- [x] 3.1 Add API e2e tests for `GET /questions/{id}` under `e2e/api/`
  - Acceptance: WHEN tests run against the seeded test DB THEN they cover (a) 200 with full payload shape including `reference_answer`, `key_points`, `common_mistakes`; (b) 404 with `{"detail": "Question not found"}` for a nonexistent UUID; (c) 422 for a malformed UUID; (d) 401 without an auth token
  - Depends on: 2.1
  - Independence: serial

## 4. Frontend — API client
- [x] 4.1 Add `QuestionDetail` interface and `getQuestion(id)` function to `frontend/lib/api.ts`
  - Acceptance: WHEN `getQuestion(id)` is called THEN it sends `GET /api/questions/{id}` via `apiFetch` and returns a typed `QuestionDetail` matching the backend payload (all fields from 1.1)
  - Depends on: -
  - Independence: parallel-safe

## 5. Frontend — question detail page
- [x] 5.1 Create `frontend/app/questions/[id]/page.tsx` skeleton with header, loading state, fetch effect
  - Acceptance: WHEN the route mounts THEN it reads `id` via `useParams()` and `provider` via `useSearchParams()` (default `"openai"`), calls `getQuestion(id)` in a `useEffect`, and displays a "載入中..." indicator until the fetch resolves AND THEN the page reuses the same header chrome as `frontend/app/questions/select/page.tsx`
  - Depends on: 4.1
  - Independence: serial
- [x] 5.2 Render four content sections (question text with category/difficulty/tags chips, reference answer, key_points, common_mistakes)
  - Acceptance: WHEN data resolves THEN the page renders the question text together with category/difficulty/tags chips reusing the color logic from `select/page.tsx`; the reference answer as readable text; the `key_points` list (with per-item fallback if individual entries are missing fields); the `common_mistakes` list AND WHEN `key_points` is an empty array THEN that section displays "（尚無評分要點）" in gray AND WHEN `common_mistakes` is an empty array THEN that section displays "（尚無常見錯誤紀錄）" in gray
  - Depends on: 5.1
  - Independence: serial
- [x] 5.3 Add bottom button row with "返回選題" and "開始練習這題"
  - Acceptance: WHEN the user clicks "返回選題" THEN the router navigates to `/questions/select?provider=${provider}` AND WHEN the user clicks "開始練習這題" THEN it calls `createSession('single', provider)` and navigates to `/interview?session_id=${sid}&mode=single&provider=${provider}&question_id=${id}` AND WHEN `createSession` fails THEN an inline error message "建立練習失敗，請稍後再試。" is shown and the button re-enables
  - Depends on: 5.1
  - Independence: serial
- [x] 5.4 Handle fetch error states (network, 404, other 4xx/5xx)
  - Acceptance: WHEN the fetch fails with `TypeError` THEN an error card with retry button shows "無法連線到後端伺服器，請確認伺服器已啟動後重試。" AND WHEN the response is 404 THEN an empty-state card with a "返回選題" button shows "找不到這題，可能已被移除。" AND WHEN any other error occurs THEN an error card with retry shows "無法載入題目內容，請稍後再試。"
  - Depends on: 5.1
  - Independence: serial

## 6. Frontend — add "查看內容" button to selection page
- [x] 6.1 Add a secondary "查看內容" button beside the "選擇練習" CTA on each card in `frontend/app/questions/select/page.tsx`
  - Acceptance: WHEN the user clicks "查看內容" on any question card THEN the router pushes to `/questions/${q.question_id}?provider=${provider}` AND THEN the button uses an outline (secondary) style so it does not visually compete with "選擇練習"
  - Depends on: -
  - Independence: parallel-safe

## 7. Frontend — Playwright e2e tests
- [x] 7.1 Add Playwright e2e cases for the detail page flow under `e2e/playwright/`
  - Acceptance: WHEN tests run against the test stack THEN they cover (a) clicking "查看內容" on a card navigates to `/questions/{id}?provider=...` and renders the four content regions; (b) clicking "返回選題" returns to `/questions/select?provider=...`; (c) clicking "開始練習這題" navigates to `/interview?session_id=...&mode=single&provider=...&question_id=...`; (d) directly visiting `/questions/{nonexistent_uuid}` shows the "找不到這題" empty state with a back button; (e) an intercepted `fetch` network failure shows the "無法連線到後端伺服器" error card with a retry button
  - Depends on: 5.4, 6.1
  - Independence: serial

## 8. Verification
- [x] 8.1 Run end-to-end verification per CLAUDE.md
  - Acceptance: WHEN `make test-env-up` succeeds AND `make test-api` passes AND `cd frontend && npm run lint && npm run build` passes AND `make test-ui` passes AND `make test-env-down` cleans up THEN the change is ready to archive
  - Depends on: 3.1, 7.1
  - Independence: serial

## Optional artifacts
- [ ] PlantUML diagrams (spec-driven-dev:writing-uml) — deferred: 本變更僅有單一同步請求，無複雜流程/狀態機，writing-plans 階段確認不需要
- [ ] Figma designs (spec-driven-dev:writing-figma) — deferred: 沿用既有 `select/page.tsx` 的卡片與 token 慣例，writing-plans 階段確認不需要
