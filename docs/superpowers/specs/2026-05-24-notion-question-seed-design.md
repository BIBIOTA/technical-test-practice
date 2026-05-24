# Notion 題庫匯入設計

**日期**：2026-05-24  
**狀態**：已核准

## 目標

將 Notion「面試考題回顧」中的 4 道真實面試題目匯入 PostgreSQL `questions` 表，並補充/優化不完整的參考答案。

## 範圍

**匯入來源**：Notion 頁面「面試考題回顧」（`3667c329-f14b-8072-aa0b-c62fddcc72d5`）

**不在範圍**：「面試題目」主動準備題（高併發、SQL效能、微服務）

## 實作方案

Python seed script（方案 A）：

- **檔案**：`backend/scripts/seed_questions.py`
- **連線**：使用 SQLAlchemy，讀取環境變數 `DATABASE_URL`
- **冪等**：以 `notion_id` 做 upsert，可重複執行
- **執行**：`docker-compose exec backend python scripts/seed_questions.py`

## 題目清單

### Q1 — LLM串接設計

| 欄位 | 值 |
|------|-----|
| notion_id | `3667c329-f14b-8019-841a-d9e0f77c173d` |
| category | `llm-engineering` |
| difficulty | `hard` |
| tags | `llm`, `backend`, `frontend`, `async` |

**題目**：如何處理 LLM 的串接，需要關注什麼？前端串接上有什麼要注意的？

**參考答案**：採用 Notion 原始完整內容（後端權限控管、Prompt分層、輸出格式控制、非同步處理、RPM/TPM控制、錯誤處理、SSE/Polling/WebSocket選擇、可觀測性）。

---

### Q2 — BDD

| 欄位 | 值 |
|------|-----|
| notion_id | `3687c329-f14b-80ff-8eaf-d2ab5b9ca201` |
| category | `testing` |
| difficulty | `easy` |
| tags | `testing`, `bdd`, `agile` |

**題目**：請說明 BDD（Behavior-Driven Development）是什麼？與 TDD 有何差異？

**參考答案**（Claude 補寫）：

BDD 是 TDD 的延伸，核心差異在於它用接近自然語言的方式（Given / When / Then）描述系統行為，讓開發者、測試人員、PM 都能共同讀懂驗收條件。

格式範例（Gherkin 語法）：
```
Given 使用者已登入
When 使用者送出結帳
Then 系統應扣除庫存並寄出確認信
```

優點：減少需求理解落差，自動化測試即文件。
常見工具：Cucumber（Java/JS）、Behave（Python）、SpecFlow（.NET）。
與 TDD 差異：TDD 是開發者視角（以 unit test 驅動程式碼），BDD 是行為視角（以業務情境驅動整個 feature）。

---

### Q3 — JWT Token

| 欄位 | 值 |
|------|-----|
| notion_id | `3687c329-f14b-807d-bc80-db5c449fe2db` |
| category | `auth` |
| difficulty | `medium` |
| tags | `auth`, `jwt`, `security` |

**題目**：請說明 JWT Token 的結構與運作流程。

**參考答案**：採用 Notion 原始完整內容（Header/Payload/Signature 結構、核發與使用流程、HttpOnly Cookie vs LocalStorage、雙 Token 機制）。

---

### Q4 — 黑箱/白箱測試

| 欄位 | 值 |
|------|-----|
| notion_id | `3687c329-f14b-8022-96bb-f54da7d43283` |
| category | `testing` |
| difficulty | `easy` |
| tags | `testing`, `qa`, `white-box`, `black-box` |

**題目**：什麼是黑箱測試（Black-box Testing）與白箱測試（White-box Testing）？請比較兩者差異並舉例。

**參考答案**：採用 Notion 原始完整內容（定義、角色、比喻、常見應用、靜態分析工具）。

---

## Category 規劃

| Category | 說明 |
|----------|------|
| `llm-engineering` | LLM 串接、Prompt 設計、AI 工程 |
| `testing` | BDD、TDD、黑白箱測試、測試工具 |
| `auth` | JWT、OAuth、Session、安全認證 |

（未來可擴充：`database`、`distributed-systems`、`microservices`、`api-design`）
