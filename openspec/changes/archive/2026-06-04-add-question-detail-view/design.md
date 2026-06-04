# Design: add-question-detail-view

## Why

使用者在「單題練習」流程中希望能在選題前後查看題目的完整資料（題幹、參考答案、評分要點、常見錯誤）以利複習。目前資料庫已存有 `reference_answer`、`key_points`、`common_mistakes` 等欄位，但前端沒有任何介面可以瀏覽。本變更新增一個唯讀詳情頁，讓使用者可以複習，並可從詳情頁直接開始練習這題。

## What changes

### 後端

- 新增 `GET /questions/{question_id}` 端點，回傳該題完整欄位（含 `reference_answer`、`key_points`、`common_mistakes`、`tags`）。
- 不存在的 `question_id` 回 404，非合法 UUID 回 422（FastAPI 預設），無 token 回 401（沿用 `verify_token`）。
- 既有 `GET /questions` 列表端點不變更（敏感欄位不在列表傳輸）。

### 前端

- 新增動態路由 `/questions/[id]`，顯示題目文字、類別 / 難度 / 標籤、參考答案、評分要點、常見錯誤五個區塊。
- 詳情頁有兩個底部按鈕：「返回選題」與「開始練習這題」。後者沿用既有 `createSession('single', provider)` → `/interview?...&question_id=...` 流程，與 `/questions/select` 的 `handleSelect` 完全一致。
- 在 `/questions/select` 每張題卡上新增「查看內容」次要按鈕，與既有「選擇練習」主要 CTA 並列。
- `provider` 透過 query string 在三個頁面之間傳遞，保持選題 → 詳情 → 練習一致。

### 範圍外（明確排除）

- 不修改 SM2 排程或 attempt 計分邏輯。
- 不改變 multi mode 流程或 `/interview` 頁面本身。
- 不在練習進行中（`/interview`）暴露參考答案。
- 不對「列表頁」端點擴充欄位。

## Architecture

### 整體流程

```
┌──────────────────────────────┐         ┌────────────────────────────┐
│  /questions/select           │         │  /questions/[id]  (NEW)    │
│  (列表 + 篩選)               │  push() │  (詳情：題目+參考答案+     │
│                              │ ──────▶ │   評分要點+常見錯誤)       │
│  每張題卡：                  │         │                            │
│   ‧ 選擇練習 (既有)          │         │  按鈕：                    │
│   ‧ 查看內容 (NEW)           │ ◀────── │   ‧ 返回選題               │
└──────────────┬───────────────┘  back   │   ‧ 開始練習這題 ──┐       │
               │                         └────────────────────┼───────┘
               │ createSession + push                         │
               ▼                                              │
┌──────────────────────────────┐                              │
│  /interview?mode=single&...  │ ◀────────────────────────────┘
└──────────────────────────────┘
```

詳情頁為唯讀展示，不修改任何 DB 狀態。「開始練習這題」沿用既有 single mode 流程，SM2 與 attempt 行為無分叉。

### Components

**後端**

| 檔案 | 變更 |
|---|---|
| `backend/app/routers/questions.py` | 新增 `GET /questions/{question_id}` 路由，依賴 `verify_token`、`get_db`；題目不存在時 raise `HTTPException(404, "Question not found")` |
| `backend/app/services/sm2.py` | 新增 `get_question_detail(db, question_id) -> dict | None`，SELECT 完整欄位 |

回傳 JSON shape：

```json
{
  "question_id": "uuid",
  "question_text": "...",
  "category": "...",
  "difficulty": "easy|medium|hard",
  "tags": ["..."],
  "reference_answer": "...",
  "key_points": [ { /* JSONB 結構 */ } ],
  "common_mistakes": ["...", "..."]
}
```

**前端**

| 檔案 | 變更 |
|---|---|
| `frontend/lib/api.ts` | 新增 `QuestionDetail` interface 與 `getQuestion(id: string): Promise<QuestionDetail>` |
| `frontend/app/questions/[id]/page.tsx` | **新增**：詳情頁 client component；Header、題目區、參考答案區、評分要點區、常見錯誤區、底部按鈕列 |
| `frontend/app/questions/select/page.tsx` | 在每張題卡的「選擇練習」旁加「查看內容」次要按鈕（outline 樣式） |

樣式沿用 `globals.css` CSS 變數（`--color-surface`、`--color-text-primary` 等）與 `select/page.tsx` 卡片風格，不引入新設計 token。

### Data flow

**情境 A：從選題列表進入詳情頁**

```
User clicks「查看內容」 → router.push(`/questions/${id}?provider=${provider}`)
   → /questions/[id]/page.tsx mounts
   → useEffect: getQuestion(id)
   → GET /api/questions/{id} → FastAPI → sm2.get_question_detail()
   → SELECT q.* FROM questions WHERE id = :id
   → 200 JSON / 404
   → setState → render 5 個區塊
```

**情境 B：從詳情頁直接開始練習**

```
User clicks「開始練習這題」
   → createSession('single', provider) → POST /api/sessions
   → router.push(`/interview?session_id=...&mode=single&provider=...&question_id=...`)
```

與 `/questions/select` 的 `handleSelect` 完全相同路徑。

**情境 C：返回**

```
「返回選題」→ router.push(`/questions/select?provider=${provider}`)
```

### Error handling

**後端**

| 情境 | 行為 |
|---|---|
| `question_id` 非合法 UUID | 422（FastAPI 預設） |
| 題目不存在 | 404 `{"detail": "Question not found"}` |
| 無 / 錯誤 token | 401（`verify_token`） |
| DB 故障 | 500（沿用既有全域處理） |

**前端**

| 情境 | UI 反應 | 文案 |
|---|---|---|
| fetch 失敗（`TypeError`） | 錯誤卡 + 重試 | 「無法連線到後端伺服器，請確認伺服器已啟動後重試。」 |
| 404 | 空狀態卡 + 返回按鈕 | 「找不到這題，可能已被移除。」 |
| 其他 4xx/5xx | 錯誤卡 + 重試 | 「無法載入題目內容，請稍後再試。」 |
| `createSession` 失敗 | inline 紅色錯誤，按鈕恢復可點 | 「建立練習失敗，請稍後再試。」 |
| `key_points` 空陣列 | 區塊顯示「（尚無評分要點）」灰字 | — |
| `common_mistakes` 空陣列 | 區塊顯示「（尚無常見錯誤紀錄）」灰字 | — |

`key_points` 個別 entry 缺欄位時容錯地只渲染既有欄位，不整頁壞掉。

### Testing

**後端 e2e（`e2e/api/`）**

- `GET /questions/{valid_id}` → 200，payload 含 `reference_answer`、`key_points`、`common_mistakes`
- `GET /questions/{nonexistent_uuid}` → 404 `{"detail": "Question not found"}`
- `GET /questions/{not-a-uuid}` → 422
- `GET /questions/{id}` 無 token → 401
- 回傳 shape 涵蓋 `Question` model 全部欄位

**前端 e2e（`e2e/playwright/`）**

- 從 `/questions/select` 點任一題卡的「查看內容」→ 導向 `/questions/{id}?provider=...`，畫面出現四區塊
- 詳情頁點「返回選題」→ 回到 `/questions/select?provider=...`
- 詳情頁點「開始練習這題」→ 導向 `/interview?session_id=...&mode=single&provider=...&question_id=...`
- 直接訪問 `/questions/{nonexistent_uuid}` → 顯示「找不到這題」+ 返回按鈕
- 後端離線情境（fetch 攔截）→ 顯示「無法連線到後端伺服器」錯誤卡 + 重試

**驗證流程**

1. `make test-env-up`
2. `make test-api`
3. `cd frontend && npm run lint && npm run build`
4. `make test-ui`
5. `make test-env-down`

## Out of scope

- 詳情頁不顯示使用者的歷史 attempt 紀錄（屬於另一個 review 流程）。
- 不提供詳情頁編輯題目功能（題目透過 Notion 同步管理）。
- 不在 `/interview` 練習進行中加任何「查看參考答案」入口。
- 不擴充 `GET /questions` 列表端點欄位。

## Probable next steps

- `spec-driven-dev:writing-plans`（必要，下一步）：將本設計拆解成 OpenSpec 格式 `tasks.md` 檢查清單。
- `spec-driven-dev:writing-uml`（**不需要**）：本變更只有單一同步請求、無複雜狀態機或多 actor 互動，§ Architecture 的 ASCII 已足夠。
- `spec-driven-dev:writing-figma`（**可選**）：詳情頁是新 UI，但既有 `/questions/select` 已有清楚的卡片 / token 慣例可循。如想先在 Figma 確認版型可加，跳過直接照既有風格實作也安全。
