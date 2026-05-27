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
        "reference_answer": """JWT token 是一種「無狀態（Stateless）認證」。
後端不需要在資料庫或記憶體中保存使用者的登入 Session 狀態，而是將使用者的身分與權限資訊打包成 Claims，透過簽名保護資料完整性後，交由前端保管。

## 核心觀念

1. **Header（標頭）：**
宣告這個 Token 的類型（通常為 JWT）以及所使用的簽名演算法（例如 HMAC SHA256 或 RSA）。

2. **Payload（內容／聲明）：**
存放實際的資料，稱為 Claims。通常會包含 `user_id`、`role`（權限角色）以及 `exp`（過期時間戳記）。

3. **Signature（簽名）：**
將 Header 與 Payload 組合後，加上只有後端才知道的 Secret Key（密鑰），透過 Header 指定的演算法計算出的雜湊值。這確保了 Token 在傳輸過程中即使遭到攔截，也無法被竄改。

組合起來的結構如下：

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

Header、Payload、Signature 三個部分分別以 `.` 作為分隔，並轉換為 Base64Url 編碼字串後組合而成。

## 核發與使用流程

1. **使用者登入：**
前端將使用者輸入的帳號與密碼，透過 POST 請求發送給後端 API 進行身分驗證。

2. **後端核發 Token：**
後端比對資料庫中的帳號密碼。驗證無誤後，將使用者的基本資訊與過期時間寫入 Payload，以伺服器的 Secret Key 產生 Signature，最後將組合好的 JWT 回傳給前端。

3. **前端儲存 Token：**
前端收到 JWT 後需妥善儲存，實務上最好的存放方式是 **HttpOnly Cookie**。

4. **前端攜帶 Token 發送請求：**
當前端需要存取受保護的 API（例如獲取會員資料、進行結帳）時，會在 HTTP Request 的 Authorization Header 中帶上 Token，標準格式為：`Bearer <你的_JWT_Token>`。

5. **後端驗證 Token：**
後端收到請求後，會以自己的 Secret Key 重新計算 Token 的 Signature，並與傳入的值比對。若一致且未過期，即判定身分合法，放行請求並回傳資料。

## 使用 JWT 的注意事項

**1. 不要在 JWT Token 中放入敏感資訊**
Payload 僅經過 Base64Url 編碼，並未加密，絕對不能存放密碼或任何敏感個資。

**2. Cross-site 攻擊的風險**
任何人持有 Token 都能與後端進行溝通，因此存在 Cross-site 攻擊的風險，常見類型有兩種：
- **XSS（跨站指令碼攻擊）：** 駭客在有 XSS 漏洞的網站中注入惡意 JavaScript，當已登入且 `localStorage` 中存有 JWT 的使用者瀏覽時，瀏覽器會執行該惡意程式碼，使駭客得以竊取 JWT Token。
- **CSRF（跨站請求偽造）：** 使用者在尚未登出的情況下，被誘騙點擊或造訪駭客建立的惡意網站，該網站中隱藏了自動發送表單或 API 請求的程式碼，藉此透過使用者的身分發送惡意請求。

為避免 XSS，避免將 JWT Token 存放於 `localStorage` 或 `sessionStorage`。
為避免 CSRF，可在存有 JWT 的 Cookie 上加設 `SameSite=Strict` 或 `SameSite=Lax` 屬性，限制瀏覽器在跨站請求時不自動夾帶 Cookie；或採用 Double Submit Cookie 的方式，讓後端同時驗證瀏覽器自動帶上的 Cookie Token，以及前端手動置入 Header（或 Body）的 Token 是否一致。

**3. JWT Token 發行後難以主動銷毀**
Session 可隨時被銷毀，但 JWT 的設計原則是在過期前持續有效。為兼顧安全性與使用者體驗，現代系統通常會同時發行兩種 Token：

| Token 類型 | 壽命 | 用途 |
|-----------|------|------|
| **Access Token** | 極短（如 15 分鐘） | 放在 HTTP Header 中隨每次請求攜帶，用於存取 API 資料。即使外洩，損害的時間窗口也很小。 |
| **Refresh Token** | 較長（如 7 至 30 天） | 通常嚴格保存於 HttpOnly Cookie 中。當 Access Token 過期時，前端會在背景以它向後端換取新的 Access Token，使用者無需重新輸入帳密。 |""",
    },
    {
        "id": uuid.uuid4(),
        "notion_id": "3667c329-f14b-802f-9141-ee47cf61f6ca",
        "text": "解釋時間複雜度（Time Complexity）與 Big O 符號，並舉例說明常見的複雜度級別。",
        "category": "algorithms",
        "difficulty": "medium",
        "tags": ["algorithms", "time-complexity", "big-o", "cs-fundamentals"],
        "reference_answer": """演算法的時間複雜度是用來定性描述演算法執行時間隨輸入量增長的函式。在工程上通常用 **Big O 符號** 表示。

## 常見複雜度級別（從最快到最慢）

### O(1) - 常數時間 (Constant Time)
不管資料量多少，執行時間固定。
- **情境：** Redis Key 讀取、Python Dictionary 取值
```python
def get_first_item(items):
    return items[0]
```

### O(log n) - 對數時間 (Logarithmic Time)
每次操作將搜尋範圍縮小一半，資料量大幅增加時執行時間只微微增加。
- **情境：** 資料庫 B-Tree 索引查詢、二分搜尋法
```python
def binary_search(sorted_list, target):
    left, right = 0, len(sorted_list) - 1
    while left <= right:
        mid = (left + right) // 2
        if sorted_list[mid] == target:
            return mid
        elif sorted_list[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1
```

### O(n) - 線性時間 (Linear Time)
執行時間隨資料量等比例增加，有一層迴圈跑遍所有資料。
- **情境：** 遍歷 List 轉換格式、在未排序資料中搜尋
```python
def process_all_users(users):
    for user in users:
        format_data(user)
```

### O(n log n) - 線性對數時間 (Linearithmic Time)
大多數高效能排序演算法的速度極限。
- **情境：** Python 內建 `sort()` / `sorted()`（底層是 Timsort）、Merge Sort
```python
def sort_my_data(data):
    return sorted(data)
```

### O(n^2) - 平方時間 (Quadratic Time)
資料量增大時執行時間呈平方暴增，是效能殺手。
- **情境：** 雙層巢狀迴圈比對資料（未用 Set/Dict 建立索引）
```python
def find_duplicates(array1, array2):
    for item1 in array1:
        for item2 in array2:
            if item1 == item2:
                return True
    return False
```

### O(2^n) - 指數時間 (Exponential Time)
資料量每增加 1，執行時間就翻倍，實務上極度危險。
- **情境：** 未經快取優化的遞迴（如原始費氏數列）
```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
```

### O(n!) - 階乘時間 (Factorial Time)
最慢的複雜度，資料量稍大即無法計算。
- **情境：** 全排列暴力解（旅行推銷員問題 TSP）
```python
import itertools
def get_all_permutations(items):
    return list(itertools.permutations(items))
```

## 實務心法

排序：**O(1) < O(log n) < O(n) < O(n log n) < O(n^2) < O(2^n) < O(n!)**

1. 利用 **Hash Table（Python 的 Dictionary / Set）** 將 O(n^2) 比對降為 O(n)。
2. 對頻繁搜尋的資料確保資料庫有建索引，讓查詢維持在 O(log n)。
3. 巢狀 `for` 迴圈要有警覺心；遞迴函數要評估是否引發 O(2^n) 的運算災難。""",
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
