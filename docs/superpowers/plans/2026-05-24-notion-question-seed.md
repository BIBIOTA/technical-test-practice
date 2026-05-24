# Notion 題庫匯入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `backend/scripts/seed_questions.py`，將面試考題回顧的 4 道題目 upsert 進 PostgreSQL `questions` 表。

**Architecture:** 單一 Python async script，使用 SQLAlchemy asyncpg engine（與 backend 相同的 driver），以 `notion_id` 為 conflict target 做 upsert，可重複執行不重複插入。

**Tech Stack:** Python 3.12, SQLAlchemy 2.x async, asyncpg, PostgreSQL `INSERT ... ON CONFLICT DO UPDATE`

---

## File Structure

| 動作 | 路徑 | 說明 |
|------|------|------|
| Create | `backend/scripts/__init__.py` | 空檔，讓 scripts 成為 package |
| Create | `backend/scripts/seed_questions.py` | Seed script 主體 |

---

## Task 1: 建立 scripts 目錄與 seed script

**Files:**
- Create: `backend/scripts/__init__.py`
- Create: `backend/scripts/seed_questions.py`

- [ ] **Step 1: 建立 `backend/scripts/__init__.py`（空檔）**

```bash
touch backend/scripts/__init__.py
```

- [ ] **Step 2: 建立 `backend/scripts/seed_questions.py`**

寫入以下完整內容：

```python
"""
Seed script: 將 Notion 面試考題回顧匯入 questions 表。
執行方式（在 backend container 內）：
  docker-compose exec backend python scripts/seed_questions.py
執行方式（本機，需先 export DATABASE_URL）：
  DATABASE_URL=postgresql+asyncpg://interview:interview@localhost:5432/interview_practice \
  python backend/scripts/seed_questions.py
"""

import asyncio
import os
import sys
import uuid

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# 讓 app 模組可被 import（從 backend/ 執行時需要）
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.models.question import Question  # noqa: E402

QUESTIONS = [
    {
        "id": uuid.uuid4(),
        "notion_id": "3667c329-f14b-8019-841a-d9e0f77c173d",
        "text": "如何處理 LLM 的串接，需要關注什麼？前端串接上有什麼要注意的？",
        "category": "llm-engineering",
        "difficulty": "hard",
        "tags": ["llm", "backend", "frontend", "async"],
        "reference_answer": """## 一、後端 LLM 串接設計

LLM 應被視為「不穩定、昂貴、有限流量、輸出不可完全信任」的外部服務。

### 1. 後端權限控管
- API Key 不能暴露在前端，應由後端控管
- model 選擇由後端決定（簡單任務用便宜 model，複雜推理用高階 model）
- system prompt / business rules 在後端維護，避免前端竄改
- 呼叫 LLM 前仍需檢查使用者身分與權限

### 2. Prompt 分層與 Prompt Injection 防護
Prompt 分三層：System Prompt（角色定義）、Business Rules（業務邏輯）、User Input（最不可信）。
使用 XML tag 隔離 user input：
```xml
<user_input>
使用者輸入放這裡
</user_input>
```
後端仍需驗證結果，prompt 隔離只能降低風險。

### 3. LLM 輸出格式控制
要求 LLM 回傳固定 JSON schema，優先使用 provider 的 structured output / function calling。
後端需做：JSON parse → schema validation → enum validation → 長度限制 → 格式錯誤時 fallback（重試 / 預設值 / 標記人工處理）。

### 4. 批次任務與非同步處理
LLM latency 不穩定，不讓前端等待單一 HTTP response。
模式：前端送任務 → 後端回傳 `job_id` → 前端透過 polling / SSE 取得進度。
任務狀態：queued → processing → completed / failed / cancelled。
注意 idempotency：retry 不應重複產生副作用。

### 5. RPM / TPM 控制
- Semaphore：控制單一 process 的同時請求數
- Redis Rate Limiter：跨 worker 的總流量（RPM / TPM）
- quota check + consume 必須是 atomic operation（Redis Lua Script）

### 6. 錯誤處理與 Fallback
可重試錯誤：timeout、429、5xx、invalid JSON。
使用 exponential backoff，設定最大重試次數。
Fallback：切換 model → 切換 provider → rule-based fallback → 標記人工處理。

## 二、前端串接設計

### Polling / SSE / WebSocket 選擇
| 方式 | 適合情境 |
|------|---------|
| Polling | 低頻查詢、報表進度、簡單任務狀態 |
| SSE | LLM streaming、任務進度推送、partial results |
| WebSocket | 聊天室、多人協作、高頻雙向互動 |

LLM 串接場景優先選 SSE，WebSocket 除非真的需要雙向高頻互動。

## 三、可觀測性

每次 LLM 呼叫必須記錄：request_id、job_id、user_id、provider/model/prompt_version、input/output tokens、latency_ms、status、retry_count、cost。

監控指標：success_rate、p95_latency、daily_cost、invalid_json_rate。""",
    },
    {
        "id": uuid.uuid4(),
        "notion_id": "3687c329-f14b-80ff-8eaf-d2ab5b9ca201",
        "text": "請說明 BDD（Behavior-Driven Development）是什麼？與 TDD 有何差異？",
        "category": "testing",
        "difficulty": "easy",
        "tags": ["testing", "bdd", "agile"],
        "reference_answer": """BDD（Behavior-Driven Development，行為驅動開發）是 TDD 的延伸，核心差異在於它用接近自然語言的方式（Given / When / Then）描述系統行為，讓開發者、測試人員、PM 都能共同讀懂驗收條件，確保產出符合商業需求。

## Gherkin 語法範例

```gherkin
Feature: 使用者結帳

  Scenario: 庫存充足時成功結帳
    Given 使用者已登入
    And 商品庫存大於 0
    When 使用者送出結帳
    Then 系統應扣除庫存
    And 系統應寄出訂單確認信
```

## 與 TDD 的差異

| 比較點 | TDD | BDD |
|--------|-----|-----|
| 視角 | 開發者（以 unit test 驅動程式碼） | 業務行為（以情境驅動整個 feature） |
| 語言 | 程式語言（assert） | 自然語言（Given/When/Then） |
| 讀者 | 工程師 | 工程師 + PM + QA |
| 粒度 | 函式 / 類別層級 | 功能 / 情境層級 |

## 優點
- 減少需求理解落差（三方共同定義驗收條件）
- 自動化測試即文件，spec 與實作同步

## 常見工具
- Cucumber（Java / JavaScript）
- Behave（Python）
- SpecFlow（.NET）""",
    },
    {
        "id": uuid.uuid4(),
        "notion_id": "3687c329-f14b-807d-bc80-db5c449fe2db",
        "text": "請說明 JWT Token 的結構與運作流程。",
        "category": "auth",
        "difficulty": "medium",
        "tags": ["auth", "jwt", "security"],
        "reference_answer": """JWT（JSON Web Token）是一種「無狀態（Stateless）認證」機制。後端不需在 DB 保存 Session，而是將使用者身分打包、加密簽名後交給前端保管。

## 結構（三段 Base64 以 . 分隔）

| 部分 | 說明 |
|------|------|
| Header | 宣告 token 類型（JWT）與簽名演算法（HS256 / RS256） |
| Payload | 存放 Claims：user_id、role、exp（過期時間）。**注意：只有 Base64 編碼，未加密，不能放密碼或敏感個資** |
| Signature | Header + Payload + Secret Key 計算出的 hash，防止竄改 |

## 核發與使用流程

1. 前端 POST 帳密 → 後端驗證
2. 後端將 user_id、role、exp 寫入 Payload，用 Secret Key 簽名，回傳 JWT
3. 前端儲存 token：
   - **HttpOnly Cookie（最推薦）**：JS 無法讀取，防 XSS
   - LocalStorage：實作簡單但 XSS 風險高
4. 前端帶 `Authorization: Bearer <token>` 發送請求
5. 後端用 Secret Key 重算 Signature 比對，驗證未過期即放行

## 雙 Token 機制

| Token | 壽命 | 用途 |
|-------|------|------|
| Access Token | 短（15 分鐘） | 隨 API 請求攜帶，外洩損害有限 |
| Refresh Token | 長（7-30 天） | 存 HttpOnly Cookie，Access Token 過期時換新的 |

## JWT 的限制
JWT 一旦發行，在過期前很難直接作廢（stateless 的代價）。
解法：縮短 Access Token 有效期、維護 token blacklist（犧牲部分 stateless 優點）。""",
    },
    {
        "id": uuid.uuid4(),
        "notion_id": "3687c329-f14b-8022-96bb-f54da7d43283",
        "text": "什麼是黑箱測試（Black-box Testing）與白箱測試（White-box Testing）？請比較兩者差異並舉例。",
        "category": "testing",
        "difficulty": "easy",
        "tags": ["testing", "qa", "white-box", "black-box"],
        "reference_answer": """## 黑箱測試（Black-box Testing）

把軟體當成「黑盒子」，測試人員**不需要知道程式碼內部實作**，只驗證「輸入 A → 是否得到預期輸出 B」。

- **關注重點**：功能正確性、UI 流程、是否符合需求規格
- **執行角色**：QA 工程師、測試人員、一般使用者
- **比喻**：買了新電視，按遙控器電源鍵電視會亮；不需要懂電路板
- **常見應用**：功能測試、壓力測試、UAT（使用者驗收測試）

## 白箱測試（White-box Testing）

把軟體當成「玻璃盒」，測試人員**清楚內部架構與程式碼邏輯**，針對每個條件分支進行測試。

- **關注重點**：程式碼覆蓋率、邏輯分支、安全漏洞、效能
- **執行角色**：開發工程師本身
- **比喻**：修車技師不只看車能不能發動，還打開引擎蓋檢查每個零件
- **常見應用**：Unit Test、Integration Test、靜態程式碼分析

## 比較表

| 比較點 | 黑箱測試 | 白箱測試 |
|--------|---------|---------|
| 需要看程式碼 | 否 | 是 |
| 執行者 | QA / 使用者 | 開發工程師 |
| 測試粒度 | 功能 / 系統層級 | 函式 / 分支層級 |
| 適合發現 | 需求不符、UI bug | 邏輯錯誤、安全漏洞 |

## 常見靜態分析工具（白箱）

| 語言 | 工具 |
|------|------|
| TypeScript / JS | ESLint、tsc |
| Python | Ruff、Mypy |
| PHP | PHPStan、Psalm |
| 跨語言 | SonarQube、Snyk |""",
    },
]


async def seed() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        # 嘗試從 app.config 讀取（在 container 內執行時有 .env）
        try:
            from app.config import settings
            database_url = settings.database_url
        except Exception:
            print("ERROR: DATABASE_URL 未設定")
            sys.exit(1)

    engine = create_async_engine(database_url, echo=False)
    AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async with AsyncSessionLocal() as session:
        for q in QUESTIONS:
            stmt = (
                insert(Question)
                .values(**q)
                .on_conflict_do_update(
                    index_elements=["notion_id"],
                    set_={
                        "text": q["text"],
                        "category": q["category"],
                        "difficulty": q["difficulty"],
                        "reference_answer": q["reference_answer"],
                        "tags": q["tags"],
                    },
                )
            )
            await session.execute(stmt)
        await session.commit()

    await engine.dispose()
    print(f"Done: {len(QUESTIONS)} questions upserted")


if __name__ == "__main__":
    asyncio.run(seed())
```

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/__init__.py backend/scripts/seed_questions.py
git commit -m "feat: add seed script for Notion interview question bank"
```

---

## Task 2: 執行 seed script 並驗證

**Files:** 無新增，只執行驗證

- [ ] **Step 1: 確認 Docker 環境已啟動**

```bash
docker-compose ps
```

Expected output：postgres、backend、frontend 均為 `Up` 狀態。

若未啟動：
```bash
docker-compose up -d
```

- [ ] **Step 2: 執行 seed script**

```bash
docker-compose exec backend python scripts/seed_questions.py
```

Expected output：
```
Done: 4 questions upserted
```

- [ ] **Step 3: 驗證資料已寫入**

```bash
docker-compose exec postgres psql -U interview -d interview_practice \
  -c "SELECT notion_id, category, difficulty, LEFT(text, 40) as text FROM questions ORDER BY created_at;"
```

Expected：4 筆資料，category 為 `llm-engineering`、`testing`（×2）、`auth`，difficulty 各為 `hard`、`easy`、`medium`、`easy`。

- [ ] **Step 4: 驗證冪等（重複執行不產生重複）**

```bash
docker-compose exec backend python scripts/seed_questions.py
```

Expected output：
```
Done: 4 questions upserted
```

再確認 DB 仍只有 4 筆：
```bash
docker-compose exec postgres psql -U interview -d interview_practice \
  -c "SELECT COUNT(*) FROM questions;"
```

Expected：`count = 4`

- [ ] **Step 5: Commit（如有任何小修正）**

```bash
git add -p
git commit -m "fix: seed script adjustments after verification"
```

若執行無誤則跳過此步。
