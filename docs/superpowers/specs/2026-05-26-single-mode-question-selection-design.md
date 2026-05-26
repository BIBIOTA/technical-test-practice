# Single Mode 自選題目 Design

**日期**：2026-05-26  
**模式範圍**：Single Mode 僅此功能受影響，Mock 與 Weak Review 行為不變

---

## 背景

目前 Single Mode 由 SM-2 算法自動決定出題，使用者無法主動選擇練習哪道題。此功能讓使用者在進入面試前，先瀏覽題目清單並手動挑選一道題練習。

---

## 使用者流程

```
首頁選 Single Mode → 點「開始面試」
  → 跳轉 /questions/select?provider=<evalProvider>

題目瀏覽頁：
  - 顯示 category / difficulty 篩選器
  - 列出所有題目卡片（預覽文字 / 類別 / 難度 / 上次得分）
  - 使用者點「選擇練習」

  → createSession(mode="single", eval_provider)
  → router.push(`/interview?session_id=...&mode=single&provider=...&question_id=...`)

面試頁：
  - 從 URL 讀取 question_id
  - new RealtimeClient(sessionId, mode, callbacks, { pinnedQuestionId })
  - 當 AI 呼叫 get_next_question 時，RealtimeClient 帶入 pinnedQuestionId
  - 後端 /questions/next?question_id=<uuid> 直接回傳指定題目
```

---

## 後端變更

### 1. 新增 `GET /questions` 列表端點

**路由**：`backend/app/routers/questions.py`

```
GET /questions?category=<str>&difficulty=<str>
```

- 查詢 `questions LEFT JOIN sm2_states`
- 支援可選的 `category` 與 `difficulty` 過濾
- 回傳陣列，每筆包含：`question_id`, `question_text`, `category`, `difficulty`, `tags`, `sm2.last_score`
- 一次全撈，不分頁（題目量少）

### 2. 修改 `GET /questions/next` 支援 `question_id`

**路由**：`backend/app/routers/questions.py`  
**Service**：`backend/app/services/sm2.py`（`select_next_question`）

新增可選參數 `question_id: uuid.UUID | None`：
- 若有值，`WHERE q.id = :question_id`，忽略 SM-2 排序邏輯
- 若無值，行為與現在完全相同

不需要資料庫 migration。

---

## 前端變更

### 1. 新增題目瀏覽頁

**路徑**：`frontend/app/questions/select/page.tsx`

#### 頁面結構

```
Header（同首頁）
標題：「選擇練習題目」  副標：Single Mode

篩選器列：
  [全部類別 ▾]  [全部難度 ▾]

題目清單（垂直卡片）
  ┌────────────────────────────────────────────────┐
  │ ● auth    medium    上次：72 分                │
  │ 請說明 JWT Token 的結構與運作流程...            │
  │                               [選擇練習]       │
  └────────────────────────────────────────────────┘
  ...

[← 返回]
```

#### 卡片欄位

| 欄位 | 來源 | 備註 |
|------|------|------|
| 類別 badge | `category` | 沿用首頁 color map |
| 難度 badge | `difficulty` | easy / medium / hard |
| 題目預覽 | `text` 前 60 字 | 截斷加 … |
| 上次得分 | `sm2.last_score` | null 顯示「尚未練習」|
| 選擇按鈕 | — | 建立 session 後跳轉面試 |

#### 行為

- 頁面載入時呼叫 `listQuestions()` 取得所有題目
- 篩選器在前端過濾（不重新打 API）
- 點「選擇練習」後呼叫 `createSession`，完成後 `router.push` 到面試頁（含 `question_id`）
- 建立 session 中顯示 loading 狀態，失敗時顯示 inline error

### 2. 修改首頁行為

**路徑**：`frontend/app/page.tsx`

`handleStart()` 中，若 `selectedMode === "single"`，改跳轉到 `/questions/select?provider=<evalProvider>`，不再直接建立 session。Mock / Weak Review 維持原流程。

### 3. 修改 `listQuestions` — api.ts

**路徑**：`frontend/lib/api.ts`

新增：

```ts
export interface QuestionSummary {
  question_id: string;
  question_text: string;
  category: string;
  difficulty: string;
  tags: string[];
  sm2: { last_score: number | null };
}

export function listQuestions(category?: string, difficulty?: string): Promise<QuestionSummary[]>
```

### 4. 修改 RealtimeClient

**路徑**：`frontend/lib/realtimeClient.ts`

- 建構子新增 `options?: { pinnedQuestionId?: string }`
- 當 AI 呼叫 `get_next_question` 時，若 `pinnedQuestionId` 有值，帶入 `question_id` 參數呼叫後端

---

## 錯誤處理

| 情境 | 處理方式 |
|------|---------|
| `GET /questions` 失敗 | 頁面顯示錯誤訊息 + 重試按鈕 |
| 題目列表為空 | 顯示「目前沒有可用的題目」空狀態 |
| 篩選後結果為空 | 顯示「沒有符合條件的題目」，篩選器保留 |
| `createSession` 失敗 | 按鈕下方 inline error，按鈕恢復可點擊 |
| 面試頁 `question_id` 無效（404）| RealtimeClient `onError` → toast 警告 |

---

## 範圍外（不在本次實作）

- 題目新增 / 編輯 / 刪除
- Mock 和 Weak Review 模式行為
- 題目列表分頁
