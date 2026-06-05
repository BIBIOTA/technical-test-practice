# 題庫 Rubric 結構化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 `Question` 加結構化評分欄位 (`key_points`, `common_mistakes`)、重寫 evaluation prompt 綁定 rubric、backfill 既有 10 題、同步更新 import-blog-questions skill，且 API contract 與前端零變動。

**Architecture:** PostgreSQL 加兩欄（JSONB + TEXT[]）；evaluation prompt 模板把 core/bonus 要點 + 常見誤區 + 難度校準注入；既有 10 題透過本機 backfill script (Claude Haiku 萃取) 產生 `seed_questions.py.draft`，人工 review 後覆蓋原檔；EvaluationProvider 三家共用新簽章；前端與 SM-2 演算法不動。

**Tech Stack:** FastAPI / SQLAlchemy 2.0 / Alembic / Pydantic v2 / Anthropic SDK / PostgreSQL JSONB / Python 3.12

**Spec reference:** `docs/superpowers/specs/2026-06-03-question-rubric-structuring-design.md`

---

## 任務總覽

| # | Task | 涉及檔案 |
|---|------|---------|
| 1 | 加 `.gitignore` 項目（防止 .draft 誤 commit） | `.gitignore` |
| 2 | 加 Question model 欄位 + Alembic migration | `backend/app/models/question.py`、新 migration |
| 3 | 跑 migration 並驗證 schema | DB |
| 4 | 寫 backfill_question_rubric.py | `backend/scripts/backfill_question_rubric.py` |
| 5 | 跑 backfill → review .draft → 套用 | `backend/scripts/seed_questions.py` |
| 6 | 更新 seed upsert 句子（多兩欄） | `backend/scripts/seed_questions.py` |
| 7 | Re-seed DB 驗證資料進 DB | DB |
| 8 | 重寫 SYSTEM_PROMPT_TEMPLATE + `_build_prompt` (TDD) | `backend/app/services/evaluation.py`、`backend/tests/test_evaluation_prompt.py` |
| 9 | 更新三個 provider.evaluate() 簽章 | `backend/app/services/evaluation.py` |
| 10 | 更新 attempts.py `_run_evaluation` | `backend/app/routers/attempts.py` |
| 11 | 更新 import-blog-questions SKILL.md | `.claude/skills/import-blog-questions/SKILL.md` |
| 12 | 端對端驗證 (`make test` + 人工煙霧測試) | 整套 |

---

## Task 1: 加 `.gitignore` 項目

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 加 backfill draft 到 .gitignore**

開啟 `.gitignore`，在 `build/` 那行下方加入：

```
backend/scripts/*.draft
```

- [ ] **Step 2: 驗證**

Run: `git check-ignore backend/scripts/seed_questions.py.draft`
Expected: prints `backend/scripts/seed_questions.py.draft`（代表會被 ignore）

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore backfill draft files"
```

---

## Task 2: 加 Question model 欄位 + Alembic migration

**Files:**
- Modify: `backend/app/models/question.py`
- Create: `backend/alembic/versions/0002_add_key_points_and_common_mistakes_to_questions.py`

- [ ] **Step 1: 更新 Question model**

修改 `backend/app/models/question.py`：

```python
import uuid
from datetime import datetime

from sqlalchemy import ARRAY, DateTime, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notion_id: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(10), nullable=False)  # easy|medium|hard
    reference_answer: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    key_points: Mapped[list[dict]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list
    )
    common_mistakes: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]"), default=list
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sm2_state: Mapped["SM2State | None"] = relationship("SM2State", back_populates="question", uselist=False)
    attempts: Mapped[list["Attempt"]] = relationship("Attempt", back_populates="question")
```

- [ ] **Step 2: 建立 Alembic migration 檔案**

Create `backend/alembic/versions/0002_add_key_points_and_common_mistakes_to_questions.py`:

```python
"""add key_points and common_mistakes to questions

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-03 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column(
            "key_points",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "questions",
        sa.Column(
            "common_mistakes",
            postgresql.ARRAY(sa.Text),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )


def downgrade() -> None:
    op.drop_column("questions", "common_mistakes")
    op.drop_column("questions", "key_points")
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/question.py backend/alembic/versions/0002_add_key_points_and_common_mistakes_to_questions.py
git commit -m "feat(schema): add key_points and common_mistakes to questions"
```

---

## Task 3: 跑 migration 並驗證 schema

**Files:** 無檔案變更（runtime 驗證）

- [ ] **Step 1: 啟動 test stack**

Run: `make test-env-up`
Expected: containers up, backend 健康（`http://localhost:8001/health` 回 200）

- [ ] **Step 2: 跑 migration 升級**

Run:
```bash
docker-compose -f docker-compose.test.yml exec backend alembic upgrade head
```
Expected: 輸出 `INFO  [alembic.runtime.migration] Running upgrade 0001 -> 0002`，無錯誤

- [ ] **Step 3: 驗證 schema 含新欄位**

Run:
```bash
docker-compose -f docker-compose.test.yml exec postgres psql -U interview -d interview_practice_test -c "\d questions"
```
Expected: 輸出包含 `key_points | jsonb | not null | '[]'::jsonb` 與 `common_mistakes | text[] | not null | '{}'::text[]`

- [ ] **Step 4: 驗證既有 row 已灌空集合**

Run:
```bash
docker-compose -f docker-compose.test.yml exec postgres psql -U interview -d interview_practice_test -c "SELECT COUNT(*) FROM questions WHERE key_points IS NULL OR common_mistakes IS NULL;"
```
Expected: `0`

- [ ] **Step 5: 驗證 downgrade 可逆（rollback 測試）**

Run:
```bash
docker-compose -f docker-compose.test.yml exec backend alembic downgrade -1
docker-compose -f docker-compose.test.yml exec postgres psql -U interview -d interview_practice_test -c "\d questions"
```
Expected: 不再有 key_points / common_mistakes 欄位

接著還原：
```bash
docker-compose -f docker-compose.test.yml exec backend alembic upgrade head
```
Expected: 重新升到 head

---

## Task 4: 寫 backfill_question_rubric.py

**Files:**
- Create: `backend/scripts/backfill_question_rubric.py`

- [ ] **Step 1: 建立 script 檔**

Create `backend/scripts/backfill_question_rubric.py`:

```python
"""
Backfill key_points + common_mistakes for existing questions.

Reads QUESTIONS list from seed_questions.py, calls Claude Haiku for each
entry whose key_points is empty, and writes a complete new file
seed_questions.py.draft for human review via `git diff --no-index`.

Usage (run locally, not in container):
    ANTHROPIC_API_KEY=... python backend/scripts/backfill_question_rubric.py

Output:
    backend/scripts/seed_questions.py.draft

Idempotency:
    Questions whose key_points is already non-empty are kept as-is.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import anthropic  # noqa: E402

from scripts.seed_questions import QUESTIONS  # type: ignore  # noqa: E402

MODEL = "claude-haiku-4-5-20251001"

EXTRACT_TOOL = {
    "name": "submit_rubric",
    "description": "Submit structured evaluation rubric for an interview question.",
    "input_schema": {
        "type": "object",
        "properties": {
            "key_points": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "point": {"type": "string"},
                        "tier": {"type": "string", "enum": ["core", "bonus"]},
                    },
                    "required": ["point", "tier"],
                },
            },
            "common_mistakes": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["key_points", "common_mistakes"],
    },
}

EXTRACT_PROMPT = """你正在為一份面試題庫補上結構化評分要點。請從題目與參考答案中萃取：

題目：{text}
難度：{difficulty}
參考答案：
{reference_answer}

請輸出 JSON（必須使用繁體中文）：
- key_points: 4-12 項，每項 {{point: str, tier: "core" | "bonus"}}
  - core 4-8 個（缺一即明顯扣分的主幹概念）
  - bonus 2-4 個（深度、工程取捨、具體例子）
- common_mistakes: 2-5 項，描述「應試者會犯什麼錯」（非「該怎麼做」）

每項 1-2 句、具體、可作為打勾陳述。不要重複 reference_answer 整段。"""


async def extract_rubric(client: anthropic.AsyncAnthropic, question: dict) -> dict:
    message = await client.messages.create(
        model=MODEL,
        max_tokens=2048,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "submit_rubric"},
        messages=[
            {
                "role": "user",
                "content": EXTRACT_PROMPT.format(
                    text=question["text"],
                    difficulty=question["difficulty"],
                    reference_answer=question["reference_answer"],
                ),
            }
        ],
    )
    for block in message.content:
        if hasattr(block, "input"):
            return dict(block.input)
    raise RuntimeError("Claude returned no tool_use block")


def format_key_points(key_points: list[dict]) -> str:
    """Render key_points as a Python literal that matches seed_questions.py style."""
    lines = ["["]
    for kp in key_points:
        point = kp["point"].replace('"', '\\"')
        tier = kp["tier"]
        lines.append(f'            {{"point": "{point}", "tier": "{tier}"}},')
    lines.append("        ]")
    return "\n".join(lines)


def format_common_mistakes(mistakes: list[str]) -> str:
    lines = ["["]
    for m in mistakes:
        text = m.replace('"', '\\"')
        lines.append(f'            "{text}",')
    lines.append("        ]")
    return "\n".join(lines)


async def main() -> None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY 未設定", file=sys.stderr)
        sys.exit(1)

    client = anthropic.AsyncAnthropic(api_key=api_key)

    enriched: list[dict] = []
    for idx, q in enumerate(QUESTIONS, 1):
        title = q["text"][:60]
        if q.get("key_points"):
            print(f"[{idx}/{len(QUESTIONS)}] SKIP (已有 key_points): {title}")
            enriched.append(q)
            continue
        print(f"[{idx}/{len(QUESTIONS)}] 萃取中: {title}...")
        try:
            rubric = await extract_rubric(client, q)
        except Exception as exc:
            print(f"  WARN: 萃取失敗 ({exc})；保留空 rubric")
            rubric = {"key_points": [], "common_mistakes": []}
        enriched.append({**q, **rubric})
        print(f"  key_points: {len(rubric['key_points'])} 項；common_mistakes: {len(rubric['common_mistakes'])} 項")

    # 讀原檔，找到 QUESTIONS = [ ... ] 區塊，置換每筆 entry 內插入兩個新欄位。
    # 由於 entry 太複雜（含 triple-quoted strings），最安全的做法是輸出一份
    # JSON sidecar，由人工套用。但為符合「diff 友善」需求，我們直接重新
    # 渲染整份檔案結尾 QUESTIONS 區塊。
    source_path = Path(__file__).parent / "seed_questions.py"
    draft_path = Path(__file__).parent / "seed_questions.py.draft"

    src = source_path.read_text(encoding="utf-8")

    # 把 enriched rubric 寫到 sidecar JSON 給人工套用（保險）
    sidecar_path = Path(__file__).parent / "rubric_drafts.json"
    sidecar_path.write_text(
        json.dumps(
            [
                {
                    "notion_id": q["notion_id"],
                    "text_snippet": q["text"][:80],
                    "key_points": q.get("key_points", []),
                    "common_mistakes": q.get("common_mistakes", []),
                }
                for q in enriched
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # .draft：把每個 entry 在 "tags": [...] 之後插入 "key_points" + "common_mistakes"
    # 用 notion_id 精準定位每筆 entry。
    new_src = src
    for q in enriched:
        if not q.get("key_points"):
            continue
        kp_block = format_key_points(q["key_points"])
        cm_block = format_common_mistakes(q["common_mistakes"])
        marker = f'"notion_id": "{q["notion_id"]}",'
        idx = new_src.find(marker)
        if idx < 0:
            print(f"  WARN: 找不到 notion_id={q['notion_id']} 在原檔中，跳過")
            continue
        # 找到此 entry 的 "tags": [...] 行尾
        tags_idx = new_src.find('"tags":', idx)
        if tags_idx < 0:
            print(f"  WARN: 找不到 tags 欄位於 notion_id={q['notion_id']}")
            continue
        tags_end = new_src.find("],", tags_idx) + 2
        insertion = (
            f'\n        "key_points": {kp_block},'
            f'\n        "common_mistakes": {cm_block},'
        )
        # 避免重複插入：檢查後一段是否已有 key_points
        next_200 = new_src[tags_end : tags_end + 200]
        if '"key_points"' in next_200:
            continue
        new_src = new_src[:tags_end] + insertion + new_src[tags_end:]

    draft_path.write_text(new_src, encoding="utf-8")
    print(f"\nDone. 輸出：")
    print(f"  {draft_path}")
    print(f"  {sidecar_path}  (JSON sidecar，給人工套用備用)")
    print(f"\n下一步：")
    print(f"  git diff --no-index {source_path} {draft_path}")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: 驗證 script 至少可以 import**

Run: `cd backend && python -c "import ast; ast.parse(open('scripts/backfill_question_rubric.py').read())"`
Expected: 無錯誤（Python AST 解析成功）

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/backfill_question_rubric.py
git commit -m "feat(scripts): add backfill_question_rubric.py for LLM-assisted rubric extraction"
```

---

## Task 5: 跑 backfill → review .draft → 套用

**Files:**
- Modify: `backend/scripts/seed_questions.py`（10 題的 entries 各加兩個欄位）

**這是 human-in-the-loop 任務**，AI 執行時必須暫停讓使用者 review。

- [ ] **Step 1: 在本機跑 backfill script**

Run:
```bash
ANTHROPIC_API_KEY="$(grep ANTHROPIC_API_KEY .env | cut -d= -f2)" \
  python backend/scripts/backfill_question_rubric.py
```
Expected: 對 10 題每題輸出 `key_points: N 項；common_mistakes: M 項`，產生 `backend/scripts/seed_questions.py.draft` 與 `backend/scripts/rubric_drafts.json`

- [ ] **Step 2: Diff review**

Run:
```bash
git diff --no-index backend/scripts/seed_questions.py backend/scripts/seed_questions.py.draft | less
```

每題檢查：
- core 4-8 個、bonus 2-4 個、common_mistakes 2-5 個（數量在範圍內）
- key_points 是「可打勾的具體陳述」，不是整段抄
- core/bonus 分層合理（缺核心概念才會掉到 70-80）
- common_mistakes 描述「應試者會犯什麼錯」，不是「該怎麼做」

⚠️ **review 是品質決定點**：LLM 萃取首版未必精準，**必須手動編輯 `.draft` 修正**。

- [ ] **Step 3: 編輯 .draft 修正錯誤**

開啟 `backend/scripts/seed_questions.py.draft`，逐題修正 LLM 萃取錯誤。可參考 sidecar `rubric_drafts.json` 對照。

- [ ] **Step 4: 套用 .draft 取代原檔**

Run:
```bash
mv backend/scripts/seed_questions.py.draft backend/scripts/seed_questions.py
rm backend/scripts/rubric_drafts.json
```

- [ ] **Step 5: 跑語法驗證**

Run:
```bash
cd backend && python -c "from scripts.seed_questions import QUESTIONS; assert all(q['key_points'] and q['common_mistakes'] for q in QUESTIONS), '有題目 rubric 為空'; print(f'OK: {len(QUESTIONS)} 題 rubric 完整')"
```
Expected: `OK: 10 題 rubric 完整`

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/seed_questions.py
git commit -m "feat(seed): backfill key_points and common_mistakes for 10 existing questions"
```

---

## Task 6: 更新 seed upsert 句子（多兩欄）

**Files:**
- Modify: `backend/scripts/seed_questions.py`（upsert set_ 字典）

- [ ] **Step 1: 修改 on_conflict_do_update**

開啟 `backend/scripts/seed_questions.py`，找到 `seed()` async function 中的 upsert：

```python
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
            "key_points": q["key_points"],
            "common_mistakes": q["common_mistakes"],
        },
    )
)
```

（在 `tags` 後面加兩行）

- [ ] **Step 2: 語法驗證**

Run: `cd backend && python -c "import scripts.seed_questions"`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/seed_questions.py
git commit -m "feat(seed): include key_points and common_mistakes in upsert"
```

---

## Task 7: Re-seed DB 並驗證資料

**Files:** 無檔案變更（runtime 驗證）

- [ ] **Step 1: docker cp 新 seed 進 container**

Run:
```bash
docker cp backend/scripts/seed_questions.py technical-test-practice-backend-1:/app/scripts/seed_questions.py
```
Expected: 無錯誤

⚠️ 若你用的 container name 不同（例如 `interview-practice-backend-1`），改用實際名稱：`docker ps | grep backend`

- [ ] **Step 2: 跑 seed**

Run:
```bash
docker-compose exec backend python scripts/seed_questions.py
```
Expected: `Done: 10 questions upserted`

- [ ] **Step 3: 驗證 DB 中 10 題 rubric 都非空**

Run:
```bash
docker-compose exec postgres psql -U interview -d interview_practice -c \
  "SELECT text, jsonb_array_length(key_points) AS kp, array_length(common_mistakes, 1) AS cm FROM questions ORDER BY category;"
```
Expected: 每列 `kp >= 4`、`cm >= 2`

---

## Task 8: 重寫 SYSTEM_PROMPT_TEMPLATE 與 `_build_prompt` (TDD)

**Files:**
- Modify: `backend/app/services/evaluation.py`
- Modify: `backend/tests/test_evaluation_prompt.py`

- [ ] **Step 1: 寫新的失敗測試**

開啟 `backend/tests/test_evaluation_prompt.py`，在類別最後加入：

```python
    def test_prompt_includes_difficulty_and_rubric_blocks(self) -> None:
        prompt = self.provider._build_prompt(
            question="解釋時間複雜度。",
            reference_answer="Big O 描述執行時間隨 n 的成長。",
            transcript="時間複雜度可以用 Big O 表示。",
            difficulty="medium",
            key_points=[
                {"point": "Big O 描述執行時間隨 n 的成長", "tier": "core"},
                {"point": "用 hash table 把 O(n^2) 降為 O(n)", "tier": "bonus"},
            ],
            common_mistakes=["混淆時間複雜度與毫秒數"],
        )

        self.assertIn("難度：medium", prompt)
        self.assertIn("核心評分要點", prompt)
        self.assertIn("- Big O 描述執行時間隨 n 的成長", prompt)
        self.assertIn("加分要點", prompt)
        self.assertIn("- 用 hash table 把 O(n^2) 降為 O(n)", prompt)
        self.assertIn("常見誤區", prompt)
        self.assertIn("- 混淆時間複雜度與毫秒數", prompt)
        self.assertIn("難度校準", prompt)
        self.assertIn("easy：core 全到位即可給 85+", prompt)
        self.assertIn("medium：core 全到位 + 至少 1 個 bonus", prompt)
        self.assertIn("hard：core 全到位 + 多數 bonus", prompt)

    def test_prompt_falls_back_when_rubric_empty(self) -> None:
        prompt = self.provider._build_prompt(
            question="未補資料的題目。",
            reference_answer="reference",
            transcript="answer",
            difficulty="easy",
            key_points=[],
            common_mistakes=[],
        )
        self.assertIn("本題未提供核心要點", prompt)
        self.assertIn("本題未提供加分要點", prompt)
        self.assertIn("本題未提供常見誤區", prompt)
```

並更新既有的兩個測試（加 keyword args）：

```python
    def test_prompt_requires_evidence_aligned_feedback(self) -> None:
        prompt = self.provider._build_prompt(
            question="解釋時間複雜度與 Big O，並舉例說明常見複雜度。",
            reference_answer="需說明 Big O、O(1)、O(log n)、O(n)、O(n log n)、O(n^2)、O(2^n)、O(n!)。",
            transcript=(
                "時間複雜度描述演算法執行時間，可以用 Big O 表示。"
                "我會舉例 O(1)、二分搜尋 O(log n)、迴圈 O(n)、排序 O(n log n)、"
                "巢狀迴圈 O(n^2)、費氏數列 O(2^n)、排列組合 O(n!)。"
            ),
            difficulty="medium",
            key_points=[
                {"point": "Big O 描述執行時間趨勢", "tier": "core"},
            ],
            common_mistakes=[],
        )

        self.assertIn("已明確提及", prompt)
        self.assertIn("不得列入 missing_points", prompt)
        self.assertIn("不得泛稱缺少具體範例", prompt)

    def test_prompt_calibrates_complete_but_imprecise_answers_above_80(self) -> None:
        prompt = self.provider._build_prompt(
            question="解釋時間複雜度與 Big O。",
            reference_answer="完整回答需要定義、常見級別、例子與工程取捨。",
            transcript="回答涵蓋定義、Big O、常見級別與多個例子，但部分用語不精準。",
            difficulty="medium",
            key_points=[{"point": "定義", "tier": "core"}],
            common_mistakes=[],
        )

        self.assertIn("80-89", prompt)
        self.assertIn("涵蓋所有 core + 部分 bonus", prompt)
        self.assertNotIn("大多數回答應落在 65-80 分", prompt)
```

注意：舊測試斷言 `assertIn("80-88", prompt)` 與 `assertIn("主要概念完整、例子充足", prompt)` 不再成立（被新 prompt 的 `80-89` 與「涵蓋所有 core + 部分 bonus」取代）。也移除舊的 `逐項比對` 斷言（被新版的「逐項對照」取代）。

- [ ] **Step 2: 跑測試確認失敗**

Run:
```bash
cd backend && python -m pytest tests/test_evaluation_prompt.py -v
```
Expected: 全部失敗（因為簽章不對、template 還沒換）

- [ ] **Step 3: 更新 SYSTEM_PROMPT_TEMPLATE**

修改 `backend/app/services/evaluation.py` 頂部的 template 為：

```python
SYSTEM_PROMPT_TEMPLATE = """你是一位嚴格的資深後端工程師面試官，正在評估應試者的技術回答。請全程使用繁體中文。

題目：{question}
難度：{difficulty}

核心評分要點（缺一項即明顯扣分，core）：
{core_points_block}

加分要點（提到能往 85+ 推，bonus）：
{bonus_points_block}

常見誤區（應試者若落入應於 missing_points 指出，並作為扣分依據）：
{common_mistakes_block}

完整參考答案（產 ideal_answer 時參考，不要逐項對照評分）：
{reference_answer}

應試者回答：{transcript}

請嚴格評估並只回傳一個 JSON 物件，所有自然語言文字使用繁體中文。
JSON 必須包含：score / summary / missing_points / next_focus / ideal_answer / provider / model。

評估流程（在心中完成，不輸出）：
1. 逐項對照「核心評分要點」與「加分要點」，標記應試者是否提及（同義或合理等價表達視為提及）。
2. 已明確提及的內容不得列入 missing_points。
3. 檢查應試者是否落入「常見誤區」；若有，列入 missing_points 並具體指出誤區內容。
4. summary 必須同時反映「已答對的重點」與「真正需要補強的地方」，避免套版批評。
5. ideal_answer 提供一份比參考答案更適合學習的完整回答；不得聲稱應試者沒提到他其實已提到的內容。

評分校準（綁定 key_points 覆蓋率）：
- 90-100：涵蓋所有 core + 多數 bonus + 具體例子 / 工程取捨
- 80-89：涵蓋所有 core + 部分 bonus，或 core 全到位但深度略不足
- 70-79：缺 1 個 core，或所有 core 都提及但極度淺薄
- 60-69：缺 2+ 個 core，或落入 1 個以上常見誤區
- 60 以下：偏題 / 嚴重錯誤 / 多數 core 未提及

難度校準（覆蓋上面校準）：
- easy：core 全到位即可給 85+，不強求 bonus
- medium：core 全到位 + 至少 1 個 bonus 才給 85+
- hard：core 全到位 + 多數 bonus + 明確工程取捨 才給 85+

evidence-aligned 規則（保留）：
- 若應試者已提供兩個以上具體例子，不得泛稱缺少具體範例；只能指出哪些例子不夠精準。
- missing_points 每一點都要能從應試者回答中找到證據（未提及 / 錯誤 / 說明不足）。"""
```

- [ ] **Step 4: 更新 `_build_prompt` 簽章**

把 `EvaluationProvider._build_prompt` 改寫為：

```python
    def _build_prompt(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> str:
        core = [kp["point"] for kp in key_points if kp["tier"] == "core"]
        bonus = [kp["point"] for kp in key_points if kp["tier"] == "bonus"]

        def _bulleted(items: list[str], fallback: str) -> str:
            if not items:
                return f"- （{fallback}）"
            return "\n".join(f"- {item}" for item in items)

        return SYSTEM_PROMPT_TEMPLATE.format(
            question=question,
            difficulty=difficulty,
            core_points_block=_bulleted(core, "本題未提供核心要點"),
            bonus_points_block=_bulleted(bonus, "本題未提供加分要點"),
            common_mistakes_block=_bulleted(common_mistakes, "本題未提供常見誤區"),
            reference_answer=reference_answer,
            transcript=transcript,
        )
```

- [ ] **Step 5: 跑測試確認通過**

Run:
```bash
cd backend && python -m pytest tests/test_evaluation_prompt.py -v
```
Expected: 全部 5 個測試 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/evaluation.py backend/tests/test_evaluation_prompt.py
git commit -m "feat(evaluation): rewrite prompt template with key_points/common_mistakes/difficulty"
```

---

## Task 9: 更新三個 provider.evaluate() 簽章

**Files:**
- Modify: `backend/app/services/evaluation.py`

- [ ] **Step 1: 更新 abstract `evaluate` 簽章**

修改 `EvaluationProvider` abstract method：

```python
class EvaluationProvider(ABC):
    @abstractmethod
    async def evaluate(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> EvaluationResult:
        pass
```

- [ ] **Step 2: 更新 `OpenAIEvaluationProvider.evaluate`**

```python
class OpenAIEvaluationProvider(EvaluationProvider):
    MODEL = "gpt-4o-mini"

    async def evaluate(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("openai", self.MODEL, transcript)

        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        prompt = self._build_prompt(
            question,
            reference_answer,
            transcript,
            difficulty=difficulty,
            key_points=key_points,
            common_mistakes=common_mistakes,
        )
        response = await client.chat.completions.create(
            model=self.MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        result = self._parse_result(raw, "openai", self.MODEL)
        if not self._needs_traditional_chinese_localization(result):
            return result

        localized = await client.chat.completions.create(
            model=self.MODEL,
            messages=[{"role": "user", "content": self._build_localization_prompt(result)}],
            response_format={"type": "json_object"},
        )
        localized_raw = localized.choices[0].message.content or "{}"
        return self._parse_result(localized_raw, "openai", self.MODEL)
```

- [ ] **Step 3: 更新 `ClaudeEvaluationProvider.evaluate`**

```python
class ClaudeEvaluationProvider(EvaluationProvider):
    MODEL = "claude-haiku-4-5-20251001"

    _TOOL: dict = {
        # ... 不動 ...
    }

    async def evaluate(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("claude", self.MODEL, transcript)

        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        prompt = self._build_prompt(
            question,
            reference_answer,
            transcript,
            difficulty=difficulty,
            key_points=key_points,
            common_mistakes=common_mistakes,
        )
        message = await client.messages.create(
            model=self.MODEL,
            max_tokens=2048,
            tools=[self._TOOL],
            tool_choice={"type": "tool", "name": "submit_evaluation"},
            messages=[{"role": "user", "content": prompt}],
        )
        for block in message.content:
            if hasattr(block, "input"):
                data = dict(block.input)
                data["provider"] = "claude"
                data["model"] = self.MODEL
                data.setdefault("ideal_answer", "")
                data["score"] = max(0, min(100, int(data["score"])))
                return EvaluationResult(**data)
        raise ValueError("Claude returned no tool_use block")
```

- [ ] **Step 4: 更新 `GeminiEvaluationProvider.evaluate`**

```python
class GeminiEvaluationProvider(EvaluationProvider):
    MODEL = "gemini-2.5-flash"

    async def evaluate(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("gemini", self.MODEL, transcript)

        import asyncio

        import google.generativeai as genai

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel(
            self.MODEL,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json"
            ),
        )
        prompt = self._build_prompt(
            question,
            reference_answer,
            transcript,
            difficulty=difficulty,
            key_points=key_points,
            common_mistakes=common_mistakes,
        )
        response = await asyncio.to_thread(model.generate_content, prompt)
        raw = response.text if response.text else "{}"
        return self._parse_result(raw, "gemini", self.MODEL)
```

- [ ] **Step 5: 驗證 import 無錯**

Run: `cd backend && python -c "from app.services.evaluation import get_provider; get_provider('openai'); get_provider('claude'); get_provider('gemini'); print('OK')"`
Expected: `OK`

- [ ] **Step 6: 跑既有 prompt 測試確保仍綠**

Run: `cd backend && python -m pytest tests/test_evaluation_prompt.py -v`
Expected: 全部 PASS（簽章與測試對齊）

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/evaluation.py
git commit -m "feat(evaluation): update OpenAI/Claude/Gemini provider signatures for rubric"
```

---

## Task 10: 更新 attempts.py `_run_evaluation`

**Files:**
- Modify: `backend/app/routers/attempts.py`

- [ ] **Step 1: 修改 `_run_evaluation` 的 `provider.evaluate(...)` 呼叫**

開啟 `backend/app/routers/attempts.py`，找到 `try:` 區塊內的 `provider.evaluate(...)`，改成：

```python
        try:
            provider = get_provider(session.eval_provider)
            evaluation = await provider.evaluate(
                question=question.text,
                reference_answer=question.reference_answer,
                transcript=transcript,
                difficulty=question.difficulty,
                key_points=question.key_points,
                common_mistakes=question.common_mistakes,
            )

            attempt.status = "completed"
            attempt.score = evaluation.score
            attempt.evaluation = evaluation.model_dump()
            attempt.completed_at = datetime.now(timezone.utc)

            sm2_state = await get_or_create_sm2_state(db, question.id)
            update_sm2(sm2_state, evaluation.score)

            await db.commit()
        except Exception:
            attempt.status = "failed"
            await db.commit()
```

- [ ] **Step 2: 驗證 import 無錯**

Run: `cd backend && python -c "from app.routers.attempts import router; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/attempts.py
git commit -m "feat(attempts): pass difficulty/key_points/common_mistakes to evaluator"
```

---

## Task 11: 更新 import-blog-questions SKILL.md

**Files:**
- Modify: `.claude/skills/import-blog-questions/SKILL.md`

- [ ] **Step 1: 更新 Section 3 entry 樣板**

開啟 `.claude/skills/import-blog-questions/SKILL.md`，把 Section 3 「Add question entry to QUESTIONS list」的範例改為：

```python
{
    "id": uuid.uuid4(),
    "notion_id": "<unique-uuid>",          # generate a new UUID, never reuse
    "text": "...",                          # interview question in Traditional Chinese
    "category": "<category>",
    "difficulty": "<easy|medium|hard>",
    "tags": ["tag1", "tag2"],
    "key_points": [
        {"point": "...", "tier": "core"},
        {"point": "...", "tier": "core"},
        {"point": "...", "tier": "bonus"},
    ],
    "common_mistakes": [
        "...",
        "...",
    ],
    "reference_answer": """...""",
},
```

- [ ] **Step 2: 改寫 Section 4 為三段萃取**

把 Section 4 整段（從 `### 4. Write the reference answer` 到下一個 `### 5.`）替換為：

```markdown
### 4. 從文章萃取三組內容

#### 4a. key_points（核心評分要點）
從文章主要 H2/H3 段落、表格與決策準則中萃取，每項 1-2 句、可作為「評分能否打勾」的具體陳述。

- 標 `core`：缺一個就明顯扣分（題目的「主幹」概念）
- 標 `bonus`：提到能往 85+ 推（深度、工程取捨、具體例子）

數量參考：core 4-8 個、bonus 2-4 個。

#### 4b. common_mistakes（常見誤區）
從文章「注意事項 / 常見錯誤 / 反例」段落，或對照部落格上的反模式段落擷取。每項描述「應試者會犯什麼錯」而非「該怎麼做」。

數量參考：2-5 個。

#### 4c. reference_answer
仍寫成 150-300 字的 markdown，但角色改變：**不再是 LLM 評分的依據，而是產生 ideal_answer 的素材**。可比 key_points 更敘述化、有 code snippet。

注意：reference_answer 與 key_points 不要互相重複；reference 用「為什麼 / 怎麼用」敘事，key_points 用「該講什麼」清單。

Structure that works well for reference_answer:
```
## 核心觀念 / Core Pattern
Brief definition (1–3 sentences)

## Method / Strategy Table
| 方法 | 優點 | 缺點 | 適用場景 |

## Code Example (if central to the topic)
```code```

## 實務要點
2–4 bullet points
```
```

- [ ] **Step 3: 在「Common Mistakes」表新增三列**

把 SKILL.md 最後的 Common Mistakes 表加入：

```markdown
| 把 reference_answer 整段抄成 key_points | key_points 是清單條目，不是段落；每條獨立可被打勾 |
| 全部 key_points 都標 core | 沒有 bonus 會讓 90+ 分無法達成；要區分「主幹」與「深度加分」 |
| common_mistakes 寫成「應該怎麼做」 | 應描述「應試者會犯什麼錯」，例如「混淆 A 與 B」「以為 X 一定比 Y 快」 |
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/import-blog-questions/SKILL.md
git commit -m "docs(skill): align import-blog-questions with key_points/common_mistakes schema"
```

---

## Task 12: 端對端驗證

**Files:** 無檔案變更（runtime 驗證）

- [ ] **Step 1: 跑 backend 全部測試**

Run:
```bash
cd backend && python -m pytest -v
```
Expected: 全部 PASS

- [ ] **Step 2: 啟動 test stack**

Run: `make test-env-up`
Expected: backend 健康

- [ ] **Step 3: 跑完整 e2e**

Run: `make test`
Expected: API + UI e2e 全綠

- [ ] **Step 4: 人工煙霧測試 — 確認新 rubric 被用上**

Run:
```bash
TOKEN=$(grep INTERVIEW_TOKEN .env.test | cut -d= -f2)

# 抓一題的 id
QUESTION_ID=$(curl -sf -H "Authorization: Bearer $TOKEN" http://localhost:8001/questions | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['question_id'])")

# 開 session
SESSION_ID=$(curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:8001/sessions -d '{"mode":"single","eval_provider":"claude"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['session_id'])")

# 送一個故意不完整的 transcript
ATTEMPT_ID=$(curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:8001/attempts -d "{\"session_id\":\"$SESSION_ID\",\"question_id\":\"$QUESTION_ID\",\"transcript\":\"我大概知道但不確定怎麼解釋。\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['attempt_id'])")

sleep 5

curl -sf -H "Authorization: Bearer $TOKEN" http://localhost:8001/attempts/$ATTEMPT_ID/result | python3 -m json.tool
```

驗證：
- `status` == `"completed"`
- `score` 落在 50-70（不完整回答）
- `evaluation.missing_points` 引用該題的 key_points（不是泛泛的「請提供更多細節」）

- [ ] **Step 5: 收尾**

若上述全綠，本次 plan 完成；若有失敗，回到對應 Task 修正。

---

## Self-Review Checklist

執行前自我檢查（給 implementer 用）：

- [ ] Spec 第 1-7 節（schema / migration / seed / backfill / prompt / provider / skill）每一節都對應 Task 1-11 中至少一個任務？✅
- [ ] 沒有 TBD / TODO / "implement later" 字串
- [ ] `_build_prompt` 簽章在 Task 8 定義為 `(question, reference_answer, transcript, *, difficulty, key_points, common_mistakes)`，三個 provider (Task 9) 用相同簽章呼叫，attempts.py (Task 10) 也用相同 keyword args ✅
- [ ] `key_points` 結構 `[{"point": str, "tier": "core" | "bonus"}]` 在 model (Task 2)、backfill script (Task 4)、prompt 渲染 (Task 8)、SKILL.md 樣板 (Task 11) 全文一致 ✅
- [ ] `common_mistakes` 結構 `list[str]` 全文一致 ✅
- [ ] Migration revision `0002` 銜接 `0001` ✅
- [ ] 所有 commit message 都用 Conventional Commits 風格（feat / chore / docs）

---

## Out of Scope（提醒 implementer 不要做）

- 加 few-shot examples 到 prompt（A 順位，下次 change）
- 加 provider 一致性檢驗 / 失敗重試 / fallback（A 順位）
- 反饋品質微調（B 順位）
- `scoring_weights` / `expected_duration_sec` / `follow_up_questions`
- `category` / `tags` enum 化
- API contract / 前端任何變動
