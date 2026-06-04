# Question-Specific STT Keywords Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static global English-term list in the realtime transcription prompt with per-question keywords extracted by an LLM, so STT correctly recognizes question-specific terms (e.g., `innerHTML` in XSS questions) without leaking unrelated terms.

**Architecture:** Add a `transcription_keywords text[]` column to `questions`. An LLM extraction service populates it from a question's `reference_answer` + `key_points` + `common_mistakes` at import time. Single mode injects per-question keywords into the OpenAI realtime session at `client-secret` creation (request body extended with `pinned_question_id`). Mock mode injects them dynamically: the `/questions/next` response carries the keywords, and the frontend `RealtimeClient` sends an OpenAI `session.update` event with a new transcription prompt as soon as a question is selected.

**Tech Stack:** Python 3.12+ / FastAPI / SQLAlchemy async / Alembic / `unittest.IsolatedAsyncioTestCase` / Next.js / TypeScript / OpenAI Python SDK / OpenAI Realtime API.

**Spec:** `docs/superpowers/specs/2026-06-04-question-specific-stt-keywords-design.md`

---

## File Structure

**Create:**
- `backend/alembic/versions/0004_add_transcription_keywords_to_questions.py` — DB migration
- `backend/app/services/transcription_keywords.py` — LLM extraction service
- `backend/tests/test_transcription_keywords.py` — service unit tests
- `backend/scripts/backfill_transcription_keywords.py` — one-shot backfill for existing questions
- `frontend/lib/transcriptionPrompt.ts` — shared base prompt constant
- `e2e/api/tests/test_realtime_keywords.py` — integration tests for `/realtime/client-secret` with `pinned_question_id` and `/questions/next` response shape

**Modify:**
- `backend/app/models/question.py` — add `transcription_keywords` column to model
- `backend/app/routers/realtime.py` — extract `_build_transcription_prompt`, accept `pinned_question_id`, remove static term list
- `backend/app/routers/questions.py` — return `transcription_keywords` from `/questions/next`
- `backend/app/services/sm2.py` — include `transcription_keywords` in `select_next_question` SQL
- `backend/tests/test_realtime.py` — fix stale assertions about the `transcription` dict
- `frontend/lib/api.ts` — extend `NextQuestion`, change `createClientSecret` signature
- `frontend/lib/realtimeClient.ts` — pass `pinnedQuestionId`, add `updateTranscriptionKeywords` method

---

## Task Order

```
1. DB schema (migration + model)
   └─> 2. LLM extraction service
            └─> 3. Refactor realtime prompt builder
                     └─> 4. Single mode: pinned_question_id wiring
   └─> 5. /questions/next returns transcription_keywords
                     └─> 6. Backfill script
                              └─> 7. Frontend: base prompt + types + API client
                                       └─> 8. Frontend: RealtimeClient wiring
                                                └─> 9. E2E integration tests
                                                         └─> 10. Manual verification
```

---

### Task 1: Add `transcription_keywords` column to `questions`

**Files:**
- Create: `backend/alembic/versions/0004_add_transcription_keywords_to_questions.py`
- Modify: `backend/app/models/question.py:1-35`

- [ ] **Step 1: Create the Alembic migration**

Write `backend/alembic/versions/0004_add_transcription_keywords_to_questions.py`:

```python
"""add transcription_keywords to questions

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column(
            "transcription_keywords",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )


def downgrade() -> None:
    op.drop_column("questions", "transcription_keywords")
```

- [ ] **Step 2: Add the column to the SQLAlchemy model**

In `backend/app/models/question.py`, after the existing `common_mistakes` field (around line 27), add:

```python
    transcription_keywords: Mapped[list[str]] = mapped_column(
        ARRAY(Text),
        nullable=False,
        server_default=sa_text("'{}'::text[]"),
        default=list,
    )
```

(`ARRAY`, `Text`, and `sa_text` are already imported at the top of the file.)

- [ ] **Step 3: Run the migration against the dev DB**

Run:
```bash
cd backend && DATABASE_URL=postgresql+asyncpg://interview:interview@localhost:5432/interview_practice alembic upgrade head
```
Expected: `INFO  [alembic.runtime.migration] Running upgrade 0003 -> 0004, add transcription_keywords to questions`

- [ ] **Step 4: Verify the column exists**

Run:
```bash
psql "host=localhost port=5432 dbname=interview_practice user=interview password=interview" -c "\d questions" | grep transcription_keywords
```
Expected: `transcription_keywords | text[] | not null | '{}'::text[]`

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/0004_add_transcription_keywords_to_questions.py backend/app/models/question.py
git commit -m "feat(questions): add transcription_keywords column for per-question STT prompt"
```

---

### Task 2: LLM extraction service

**Files:**
- Create: `backend/app/services/transcription_keywords.py`
- Create: `backend/tests/test_transcription_keywords.py`

- [ ] **Step 1: Write failing test — offline mode returns empty list**

Create `backend/tests/test_transcription_keywords.py`:

```python
import unittest
from unittest.mock import AsyncMock, MagicMock, patch


class ExtractTranscriptionKeywordsTest(unittest.IsolatedAsyncioTestCase):
    async def test_offline_mode_returns_empty_list(self):
        from app.services.transcription_keywords import extract_transcription_keywords
        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = True
            mock_settings.openai_api_key = "key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                result = await extract_transcription_keywords(
                    question_text="What is XSS?",
                    reference_answer="Use innerHTML carefully and apply CSP.",
                    key_points=[],
                    common_mistakes=[],
                )
                mock_cls.assert_not_called()
                self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test, confirm it fails**

Run:
```bash
cd backend && python -m unittest tests.test_transcription_keywords -v
```
Expected: `ModuleNotFoundError: No module named 'app.services.transcription_keywords'`

- [ ] **Step 3: Create the service with the minimal offline-mode short-circuit**

Create `backend/app/services/transcription_keywords.py`:

```python
import json
import logging
import re

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
你的任務是從一道後端工程師中文技術面試題目的參考答案中，
找出「應試者用繁體中文回答時，會混入的英文技術術語」，
專門用來提示語音辨識（STT）正確拼寫這些術語。

規則：
1. 只列出英文 token 是「容易被中文 STT 誤判或音譯」的術語
   - 例：innerHTML 容易被聽成 "inline HTML"
   - 例：dangerouslySetInnerHTML、DOMPurify、CSRF token
2. 不要列出已經是極常見、STT 不會錯的詞（HTTP、JSON、API 這類除非該題核心）
3. 不要列出中文詞、不要翻譯
4. 每個元素 1-3 個英文 token，使用原始拼字（保留大小寫、駝峰式）
5. 上限 15 個
6. 沒有合適術語時，回傳空 array

只回傳 JSON：{"keywords": [...]}。
"""

_RESPONSE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "transcription_keywords",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "keywords": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": ["keywords"],
        },
        "strict": True,
    },
}

_MAX_LEN = 40
_HAS_CJK = re.compile(r"[一-鿿]")


async def extract_transcription_keywords(
    *,
    question_text: str,
    reference_answer: str,
    key_points: list[dict],
    common_mistakes: list[str],
) -> list[str]:
    if settings.evaluation_offline_mode:
        return []

    user_content = _build_user_content(
        question_text=question_text,
        reference_answer=reference_answer,
        key_points=key_points,
        common_mistakes=common_mistakes,
    )
    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format=_RESPONSE_SCHEMA,
            temperature=0,
            max_tokens=512,
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
        keywords = data.get("keywords", [])
        if not isinstance(keywords, list):
            return []
        return _sanitize(keywords)
    except Exception as exc:
        logger.warning("extract_transcription_keywords failed: %s", exc)
        return []


def _build_user_content(
    *,
    question_text: str,
    reference_answer: str,
    key_points: list[dict],
    common_mistakes: list[str],
) -> str:
    kp_lines = [str(p.get("point", "")) for p in key_points if p.get("point")]
    cm_lines = list(common_mistakes)
    parts = [f"題目：{question_text}", "", f"參考答案：\n{reference_answer}"]
    if kp_lines:
        parts.append("")
        parts.append("關鍵點：")
        parts.extend(f"- {line}" for line in kp_lines)
    if cm_lines:
        parts.append("")
        parts.append("常見錯誤：")
        parts.extend(f"- {line}" for line in cm_lines)
    return "\n".join(parts)


def _sanitize(keywords: list) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in keywords:
        if not isinstance(raw, str):
            continue
        kw = raw.strip()
        if not kw or len(kw) > _MAX_LEN:
            continue
        if _HAS_CJK.search(kw):
            continue
        if kw in seen:
            continue
        seen.add(kw)
        result.append(kw)
    return result
```

- [ ] **Step 4: Run the test, confirm it passes**

Run:
```bash
cd backend && python -m unittest tests.test_transcription_keywords -v
```
Expected: `test_offline_mode_returns_empty_list ... ok`

- [ ] **Step 5: Add a test for the happy path**

Append to `backend/tests/test_transcription_keywords.py` inside the `ExtractTranscriptionKeywordsTest` class:

```python
    async def test_returns_sanitized_keywords_from_api(self):
        from app.services.transcription_keywords import extract_transcription_keywords
        mock_response = MagicMock()
        mock_response.choices[0].message.content = (
            '{"keywords": ["innerHTML", "DOMPurify", "Content Security Policy"]}'
        )
        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client
                result = await extract_transcription_keywords(
                    question_text="What is XSS?",
                    reference_answer="Use innerHTML carefully and apply CSP.",
                    key_points=[],
                    common_mistakes=[],
                )
                self.assertEqual(result, ["innerHTML", "DOMPurify", "Content Security Policy"])
```

Run:
```bash
cd backend && python -m unittest tests.test_transcription_keywords -v
```
Expected: both tests pass.

- [ ] **Step 6: Add tests for filter rules**

Append to the same class:

```python
    async def test_filters_chinese_and_long_and_duplicate_keywords(self):
        from app.services.transcription_keywords import extract_transcription_keywords
        mock_response = MagicMock()
        mock_response.choices[0].message.content = (
            '{"keywords": ["innerHTML", "中文詞", "innerHTML", '
            '"' + ("x" * 41) + '", "  ", 42, "DOMPurify"]}'
        )
        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client
                result = await extract_transcription_keywords(
                    question_text="Q", reference_answer="A", key_points=[], common_mistakes=[],
                )
                self.assertEqual(result, ["innerHTML", "DOMPurify"])

    async def test_returns_empty_list_on_api_error(self):
        from app.services.transcription_keywords import extract_transcription_keywords
        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(side_effect=Exception("boom"))
                mock_cls.return_value = mock_client
                result = await extract_transcription_keywords(
                    question_text="Q", reference_answer="A", key_points=[], common_mistakes=[],
                )
                self.assertEqual(result, [])

    async def test_returns_empty_list_on_malformed_json(self):
        from app.services.transcription_keywords import extract_transcription_keywords
        mock_response = MagicMock()
        mock_response.choices[0].message.content = "not json at all"
        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client
                result = await extract_transcription_keywords(
                    question_text="Q", reference_answer="A", key_points=[], common_mistakes=[],
                )
                self.assertEqual(result, [])
```

Run:
```bash
cd backend && python -m unittest tests.test_transcription_keywords -v
```
Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/transcription_keywords.py backend/tests/test_transcription_keywords.py
git commit -m "feat(services): add LLM-based transcription_keywords extraction service"
```

---

### Task 3: Refactor realtime prompt builder

**Files:**
- Modify: `backend/app/routers/realtime.py:148-176`
- Modify: `backend/tests/test_realtime.py` (the stale assertions need updating)

- [ ] **Step 1: Write failing test for `_build_transcription_prompt`**

Replace the entire body of `backend/tests/test_realtime.py` with:

```python
import unittest

from app.routers.realtime import (
    _build_realtime_session_config,
    _build_system_prompt,
    _build_transcription_prompt,
    TRANSCRIPTION_BASE_PROMPT,
)


class BuildTranscriptionPromptTest(unittest.TestCase):
    def test_no_keywords_returns_base_prompt_only(self):
        result = _build_transcription_prompt([])
        self.assertEqual(result, TRANSCRIPTION_BASE_PROMPT)

    def test_with_keywords_appends_term_list(self):
        result = _build_transcription_prompt(["innerHTML", "DOMPurify"])
        self.assertTrue(result.startswith(TRANSCRIPTION_BASE_PROMPT))
        self.assertIn("innerHTML, DOMPurify", result)
        self.assertIn("本題可能會出現的英文術語", result)

    def test_base_prompt_does_not_include_static_term_list(self):
        # The legacy list of "connection pool, deadlock, Redis, Kafka..."
        # must be removed — all term hints are now per-question.
        self.assertNotIn("connection pool", TRANSCRIPTION_BASE_PROMPT)
        self.assertNotIn("Kafka", TRANSCRIPTION_BASE_PROMPT)
        self.assertNotIn("deadlock", TRANSCRIPTION_BASE_PROMPT)


class RealtimeSessionConfigTest(unittest.TestCase):
    def test_turn_detection_absent_from_client_secret_config(self):
        session = _build_realtime_session_config("single", [])
        self.assertNotIn("turn_detection", session)

    def test_transcription_uses_base_prompt_when_no_keywords(self):
        session = _build_realtime_session_config("single", [])
        transcription = session["audio"]["input"]["transcription"]
        self.assertEqual(transcription["model"], "gpt-4o-transcribe")
        self.assertEqual(transcription["language"], "zh")
        self.assertEqual(transcription["prompt"], TRANSCRIPTION_BASE_PROMPT)

    def test_transcription_appends_keywords_when_present(self):
        session = _build_realtime_session_config("single", ["innerHTML"])
        prompt = session["audio"]["input"]["transcription"]["prompt"]
        self.assertIn("innerHTML", prompt)

    def test_output_voice_uses_cedar(self):
        session = _build_realtime_session_config("single", [])
        self.assertEqual(session["audio"]["output"], {"voice": "cedar"})

    def test_system_prompt_does_not_request_male_presenting_voice(self):
        prompt = _build_system_prompt("single")
        self.assertNotIn("偏男性", prompt)
        self.assertNotIn("男性聲線", prompt)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run, confirm it fails**

Run:
```bash
cd backend && python -m unittest tests.test_realtime -v
```
Expected: `ImportError: cannot import name '_build_transcription_prompt' from 'app.routers.realtime'`

- [ ] **Step 3: Refactor `realtime.py` — extract base prompt + builder, change `_build_realtime_session_config` signature**

In `backend/app/routers/realtime.py`, replace `_build_realtime_session_config` (lines 148-176) and add new helpers above it:

```python
TRANSCRIPTION_BASE_PROMPT = (
    "這是一場後端工程師中文技術面試，應試者使用台灣繁體中文回答。"
    "請完整保留英文術語的原文拼寫，不要翻譯成中文、不要替換成其他相近詞、"
    "不要轉成拼音或假名。聽不清楚時保留原狀，不要猜測。"
)


def _build_transcription_prompt(keywords: list[str]) -> str:
    if not keywords:
        return TRANSCRIPTION_BASE_PROMPT
    terms = ", ".join(keywords)
    return f"{TRANSCRIPTION_BASE_PROMPT} 本題可能會出現的英文術語：{terms}。"


def _build_realtime_session_config(mode: str, keywords: list[str]) -> dict:
    return {
        "type": "realtime",
        "model": "gpt-realtime-2025-08-28",
        "instructions": _build_system_prompt(mode),
        "tools": _get_tools(),
        "tool_choice": "auto",
        "audio": {
            "input": {
                "transcription": {
                    "model": "gpt-4o-transcribe",
                    "language": "zh",
                    "prompt": _build_transcription_prompt(keywords),
                },
            },
            "output": {"voice": "cedar"},
        },
    }
```

The five-line static term list (`connection pool, ..., O(log n)`) is fully removed — it lived only inside the previous `prompt` string literal.

- [ ] **Step 4: Update the only existing caller (route handler)**

In `backend/app/routers/realtime.py`, find the call to `_build_realtime_session_config` inside `create_client_secret` (around line 40):

```python
        response = await client.realtime.client_secrets.create(
            session=_build_realtime_session_config(session.mode)
        )
```

Change it to pass an empty keywords list for now (Task 4 wires the real value):

```python
        response = await client.realtime.client_secrets.create(
            session=_build_realtime_session_config(session.mode, [])
        )
```

- [ ] **Step 5: Run tests, confirm all pass**

Run:
```bash
cd backend && python -m unittest tests.test_realtime -v
```
Expected: 7 tests pass (3 BuildTranscriptionPrompt + 4 RealtimeSessionConfig... wait, count again — `BuildTranscriptionPromptTest` has 3, `RealtimeSessionConfigTest` has 5 = 8 total).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/realtime.py backend/tests/test_realtime.py
git commit -m "refactor(realtime): extract transcription prompt builder, drop static term list"
```

---

### Task 4: Single mode — load question keywords on `client-secret`

**Files:**
- Modify: `backend/app/routers/realtime.py:17-59` (`ClientSecretRequest` + `create_client_secret`)
- Modify: `backend/tests/test_realtime.py` (add route-level test)

- [ ] **Step 1: Write failing test — pinned_question_id loads keywords**

Append a new test class to `backend/tests/test_realtime.py`:

```python
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


class CreateClientSecretWithPinnedQuestionTest(unittest.IsolatedAsyncioTestCase):
    async def test_uses_question_keywords_when_pinned_question_id_provided(self):
        from app.routers.realtime import create_client_secret, ClientSecretRequest
        from app.models.interview_session import InterviewSession
        from app.models.question import Question

        session_uuid = uuid.uuid4()
        question_uuid = uuid.uuid4()
        fake_session = InterviewSession(id=session_uuid, mode="single")
        fake_question = Question(
            id=question_uuid,
            text="What is XSS?",
            category="security",
            difficulty="medium",
            reference_answer="Use innerHTML carefully.",
            tags=[],
            transcription_keywords=["innerHTML", "DOMPurify"],
        )

        session_scalar = MagicMock()
        session_scalar.scalar_one_or_none.return_value = fake_session
        question_scalar = MagicMock()
        question_scalar.scalar_one_or_none.return_value = fake_question

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[session_scalar, question_scalar])
        db.add = MagicMock()
        db.commit = AsyncMock()

        fake_openai_response = MagicMock()
        fake_openai_response.expires_at = 1900000000
        fake_openai_response.session.id = "rt_session_abc"
        fake_openai_response.value = "secret_xyz"

        captured: dict = {}

        async def fake_create(*, session):
            captured["session"] = session
            return fake_openai_response

        with patch("app.routers.realtime.AsyncOpenAI") as mock_cls:
            mock_client = MagicMock()
            mock_client.realtime.client_secrets.create = fake_create
            mock_cls.return_value = mock_client

            body = ClientSecretRequest(
                session_id=session_uuid,
                pinned_question_id=question_uuid,
            )
            result = await create_client_secret(body=body, db=db, _=None)

        prompt = captured["session"]["audio"]["input"]["transcription"]["prompt"]
        self.assertIn("innerHTML", prompt)
        self.assertIn("DOMPurify", prompt)
        self.assertEqual(result["client_secret"], "secret_xyz")
```

- [ ] **Step 2: Run, confirm it fails**

Run:
```bash
cd backend && python -m unittest tests.test_realtime.CreateClientSecretWithPinnedQuestionTest -v
```
Expected fail: `pinned_question_id` not accepted by `ClientSecretRequest`.

- [ ] **Step 3: Extend `ClientSecretRequest` + load question**

In `backend/app/routers/realtime.py`, replace the `ClientSecretRequest` model (around line 17-18) and rewrite `create_client_secret`:

```python
from app.models.question import Question  # add to imports near top with other model imports


class ClientSecretRequest(BaseModel):
    session_id: uuid.UUID
    pinned_question_id: uuid.UUID | None = None


@router.post("/client-secret")
async def create_client_secret(
    body: ClientSecretRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    result = await db.execute(
        select(InterviewSession).where(InterviewSession.id == body.session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    keywords: list[str] = []
    if body.pinned_question_id is not None:
        q_result = await db.execute(
            select(Question).where(Question.id == body.pinned_question_id)
        )
        question = q_result.scalar_one_or_none()
        if question is None:
            raise HTTPException(status_code=404, detail="Question not found")
        keywords = list(question.transcription_keywords or [])

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)

    try:
        response = await client.realtime.client_secrets.create(
            session=_build_realtime_session_config(session.mode, keywords)
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI API error: {str(e)}")

    expires_at = datetime.fromtimestamp(response.expires_at, tz=timezone.utc)

    rt_session = RealtimeSession(
        session_id=body.session_id,
        openai_session_id=response.session.id,
        expires_at=expires_at,
    )
    db.add(rt_session)
    await db.commit()

    return {
        "client_secret": response.value,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "openai_session_id": response.session.id,
    }
```

- [ ] **Step 4: Run, confirm test passes**

Run:
```bash
cd backend && python -m unittest tests.test_realtime -v
```
Expected: all tests pass.

- [ ] **Step 5: Add the 404-on-missing-question test**

Append to `CreateClientSecretWithPinnedQuestionTest`:

```python
    async def test_returns_404_when_pinned_question_id_not_found(self):
        from app.routers.realtime import create_client_secret, ClientSecretRequest
        from app.models.interview_session import InterviewSession
        from fastapi import HTTPException

        session_uuid = uuid.uuid4()
        fake_session = InterviewSession(id=session_uuid, mode="single")
        session_scalar = MagicMock()
        session_scalar.scalar_one_or_none.return_value = fake_session
        question_scalar = MagicMock()
        question_scalar.scalar_one_or_none.return_value = None

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[session_scalar, question_scalar])

        body = ClientSecretRequest(
            session_id=session_uuid,
            pinned_question_id=uuid.uuid4(),
        )
        with self.assertRaises(HTTPException) as ctx:
            await create_client_secret(body=body, db=db, _=None)
        self.assertEqual(ctx.exception.status_code, 404)
```

Run:
```bash
cd backend && python -m unittest tests.test_realtime -v
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/realtime.py backend/tests/test_realtime.py
git commit -m "feat(realtime): inject per-question STT keywords via pinned_question_id"
```

---

### Task 5: `/questions/next` returns `transcription_keywords`

**Files:**
- Modify: `backend/app/services/sm2.py:94-122` (SELECT in `select_next_question`)
- Modify: `backend/app/routers/questions.py:24-57` (response shape)

- [ ] **Step 1: Update `select_next_question` SQL to include the column**

In `backend/app/services/sm2.py`, modify the `query = text(...)` block inside `select_next_question` (line 94-116). Add `q.transcription_keywords` to the SELECT list:

```python
    query = text(f"""
        SELECT
            q.id,
            q.text,
            q.category,
            q.difficulty,
            q.reference_answer,
            q.tags,
            q.transcription_keywords,
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
```

- [ ] **Step 2: Update the router response to include the field**

In `backend/app/routers/questions.py`, modify the dict returned by `get_next_question` (line 45-57):

```python
    return {
        "question_id": str(question["id"]),
        "question_text": question["text"],
        "category": question["category"],
        "difficulty": question["difficulty"],
        "tags": question["tags"] or [],
        "transcription_keywords": list(question.get("transcription_keywords") or []),
        "sm2": {
            "ease_factor": question["ease_factor"],
            "interval_days": question["interval_days"],
            "next_review_at": str(question["next_review_at"]) if question["next_review_at"] else None,
            "last_score": question["last_score"],
        },
    }
```

- [ ] **Step 3: Add an e2e test for the response shape**

Append to `e2e/api/tests/test_questions.py`:

```python
def test_get_next_question_returns_transcription_keywords(client, question_id, session_id):
    response = client.get(f"/questions/next?session_id={session_id}&mode=single")
    assert response.status_code == 200
    body = response.json()
    assert "transcription_keywords" in body
    assert isinstance(body["transcription_keywords"], list)
```

- [ ] **Step 4: Run the e2e test**

Make sure the test stack is up:
```bash
make test-env-up
```

Then run just the new test:
```bash
make test-api PYTEST_ARGS="tests/test_questions.py::test_get_next_question_returns_transcription_keywords -v"
```

If the Makefile doesn't accept `PYTEST_ARGS`, run `make test-api` and look for the new test name in the output.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sm2.py backend/app/routers/questions.py e2e/api/tests/test_questions.py
git commit -m "feat(questions): include transcription_keywords in /questions/next response"
```

---

### Task 6: Backfill script for existing questions

**Files:**
- Create: `backend/scripts/backfill_transcription_keywords.py`

- [ ] **Step 1: Write the backfill script**

Create `backend/scripts/backfill_transcription_keywords.py`:

```python
"""
Backfill transcription_keywords for existing questions.

Idempotent: only processes questions whose `transcription_keywords` is empty.
Failures are logged but do not abort the run.

Usage:
  cd backend && DATABASE_URL=postgresql+asyncpg://interview:interview@localhost:5432/interview_practice \
    python -m scripts.backfill_transcription_keywords
"""

import asyncio
import logging
import os
import sys

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.models.question import Question  # noqa: E402
from app.services.transcription_keywords import extract_transcription_keywords  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill_transcription_keywords")


async def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL not set")

    engine = create_async_engine(db_url, echo=False)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as session:
        result = await session.execute(
            select(Question).where(Question.transcription_keywords == [])
        )
        questions = list(result.scalars().all())
        logger.info("found %d questions with empty transcription_keywords", len(questions))

        success = 0
        failure = 0
        for q in questions:
            try:
                keywords = await extract_transcription_keywords(
                    question_text=q.text,
                    reference_answer=q.reference_answer,
                    key_points=list(q.key_points or []),
                    common_mistakes=list(q.common_mistakes or []),
                )
                await session.execute(
                    update(Question)
                    .where(Question.id == q.id)
                    .values(transcription_keywords=keywords)
                )
                await session.commit()
                logger.info("  %s -> %d keywords: %s", q.id, len(keywords), keywords)
                success += 1
            except Exception as exc:
                logger.warning("  %s FAILED: %s", q.id, exc)
                await session.rollback()
                failure += 1

        logger.info("done: %d succeeded, %d failed", success, failure)

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Run the backfill against the dev DB**

Run:
```bash
cd backend && DATABASE_URL=postgresql+asyncpg://interview:interview@localhost:5432/interview_practice \
  python -m scripts.backfill_transcription_keywords
```
Expected log: `found N questions ...` followed by per-question `-> N keywords: [...]`, then `done: M succeeded, 0 failed`.

- [ ] **Step 3: Spot-check the XSS question**

Run:
```bash
psql "host=localhost port=5432 dbname=interview_practice user=interview password=interview" \
  -c "SELECT id, text, transcription_keywords FROM questions WHERE text LIKE '%XSS%';"
```
Expected: the row's `transcription_keywords` includes `innerHTML` (and likely `CSP`, `DOMPurify`, or similar).

If `innerHTML` is missing, manually inspect the prompt and the question's `reference_answer` — the extraction prompt may need a small tweak. Investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/backfill_transcription_keywords.py
git commit -m "feat(scripts): backfill transcription_keywords for existing questions"
```

---

### Task 7: Frontend — base prompt module, `NextQuestion` type, `createClientSecret` signature

**Files:**
- Create: `frontend/lib/transcriptionPrompt.ts`
- Modify: `frontend/lib/api.ts:61-73` (`NextQuestion`)
- Modify: `frontend/lib/api.ts:187-192` (`createClientSecret`)

- [ ] **Step 1: Create the shared base prompt constant**

Create `frontend/lib/transcriptionPrompt.ts`:

```typescript
// KEEP IN SYNC WITH backend/app/routers/realtime.py :: TRANSCRIPTION_BASE_PROMPT
export const TRANSCRIPTION_BASE_PROMPT =
  "這是一場後端工程師中文技術面試，應試者使用台灣繁體中文回答。" +
  "請完整保留英文術語的原文拼寫，不要翻譯成中文、不要替換成其他相近詞、" +
  "不要轉成拼音或假名。聽不清楚時保留原狀，不要猜測。";

export function buildTranscriptionPrompt(keywords: string[]): string {
  if (keywords.length === 0) return TRANSCRIPTION_BASE_PROMPT;
  return `${TRANSCRIPTION_BASE_PROMPT} 本題可能會出現的英文術語：${keywords.join(", ")}。`;
}
```

- [ ] **Step 2: Add `transcription_keywords` to the `NextQuestion` type**

In `frontend/lib/api.ts`, modify the `NextQuestion` interface (line 61-73):

```typescript
export interface NextQuestion {
  question_id: string;
  question_text: string;
  category: string;
  difficulty: string;
  tags: string[];
  transcription_keywords: string[];
  sm2: {
    ease_factor: number | null;
    interval_days: number | null;
    next_review_at: string | null;
    last_score: number | null;
  };
}
```

- [ ] **Step 3: Change `createClientSecret` to accept `pinnedQuestionId`**

In `frontend/lib/api.ts`, replace `createClientSecret` (line 187-192):

```typescript
export function createClientSecret(
  sessionId: string,
  pinnedQuestionId?: string,
): Promise<ClientSecret> {
  const body: Record<string, string> = { session_id: sessionId };
  if (pinnedQuestionId) {
    body.pinned_question_id = pinnedQuestionId;
  }
  return apiFetch("/realtime/client-secret", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 4: Build to verify TypeScript compiles**

Run:
```bash
cd frontend && npm run build
```
Expected: build succeeds (no `transcription_keywords` missing-property errors elsewhere — since `NextQuestion` is consumed by `realtimeClient.ts` we'll touch that next).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/transcriptionPrompt.ts frontend/lib/api.ts
git commit -m "feat(api): add transcription_keywords + pinnedQuestionId to API client"
```

---

### Task 8: Frontend — `RealtimeClient` wiring

**Files:**
- Modify: `frontend/lib/realtimeClient.ts:75-145` (`connect`)
- Modify: `frontend/lib/realtimeClient.ts:299-399` (`handleToolCall::get_next_question`)
- Modify: `frontend/lib/realtimeClient.ts:1-18` (imports)

- [ ] **Step 1: Add the import for the prompt helper**

In `frontend/lib/realtimeClient.ts`, add to the top imports (next to the existing `./api` import):

```typescript
import { buildTranscriptionPrompt } from "./transcriptionPrompt";
```

- [ ] **Step 2: Pass `pinnedQuestionId` into `createClientSecret`**

In `connect()` (around line 84), replace:

```typescript
    const { client_secret } = await createClientSecret(this.sessionId);
```

with:

```typescript
    const { client_secret } = await createClientSecret(
      this.sessionId,
      this.pinnedQuestionId ?? undefined,
    );
```

- [ ] **Step 3: Add the `updateTranscriptionKeywords` method**

Add this method to the `RealtimeClient` class (after `sendResponseCreate`, before `handleServerEvent`):

```typescript
  private updateTranscriptionKeywords(keywords: string[]): void {
    const prompt = buildTranscriptionPrompt(keywords);
    this.sendEvent({
      type: "session.update",
      session: {
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-transcribe",
              language: "zh",
              prompt,
            },
          },
        },
      },
    });
  }
```

- [ ] **Step 4: Call `updateTranscriptionKeywords` after each `get_next_question`**

In `handleToolCall`, find the `if (name === "get_next_question") { ... }` block (around line 307). Inside the block, after `this.completedUserTranscripts = []; this.hasSubmittedAnswer = false; this.submitCommitAt = null;` and before the `if (!this.initialQuestion) { this.callbacks.onQuestion(...) }`, add:

```typescript
        this.updateTranscriptionKeywords(q.transcription_keywords ?? []);
```

Resulting block:

```typescript
      if (name === "get_next_question") {
        const q = this.initialQuestion ?? (await getNextQuestion(
            this.sessionId,
            args.mode ?? this.mode,
            args.category,
            args.difficulty,
            this.pinnedQuestionId ?? undefined
          ));
        this.pinnedQuestionId = null;
        this.currentQuestionId = q.question_id;
        this.completedUserTranscripts = [];
        this.hasSubmittedAnswer = false;
        this.submitCommitAt = null;
        this.updateTranscriptionKeywords(q.transcription_keywords ?? []);
        if (!this.initialQuestion) {
          this.callbacks.onQuestion({
            question_id: q.question_id,
            question_text: q.question_text,
            category: q.category,
            difficulty: q.difficulty,
          });
        }
        output = q;
      }
```

- [ ] **Step 5: Build + lint**

Run:
```bash
cd frontend && npm run lint && npm run build
```
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/realtimeClient.ts
git commit -m "feat(realtime): wire pinnedQuestionId + dynamic session.update for STT keywords"
```

---

### Task 9: E2E integration tests for the full path

**Files:**
- Create: `e2e/api/tests/test_realtime_keywords.py`
- Modify: `e2e/api/tests/conftest.py` (add helper for inserting question with keywords)

- [ ] **Step 1: Extend `conftest.py` with a keyword-aware insert helper**

In `e2e/api/tests/conftest.py`, modify `insert_question` to accept `transcription_keywords` (around line 26-47):

```python
def insert_question(
    *,
    text: str | None = None,
    category: str = "backend",
    difficulty: str = "easy",
    reference_answer: str = "A strong answer covers the main concepts clearly.",
    tags: list[str] | None = None,
    transcription_keywords: list[str] | None = None,
) -> str:
    q_id = str(uuid.uuid4())
    db_execute(
        "INSERT INTO questions (id, text, category, difficulty, reference_answer, tags, transcription_keywords)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            q_id,
            text or f"Test question {q_id}",
            category,
            difficulty,
            reference_answer,
            tags or ["test"],
            transcription_keywords or [],
        ),
    )
    return q_id
```

- [ ] **Step 2: Write the e2e test**

Create `e2e/api/tests/test_realtime_keywords.py`:

```python
import uuid

from .conftest import insert_question


def test_client_secret_accepts_pinned_question_id(client, session_id):
    q_id = insert_question(
        text="Keyword test question",
        transcription_keywords=["innerHTML", "DOMPurify"],
    )

    response = client.post(
        "/realtime/client-secret",
        json={"session_id": session_id, "pinned_question_id": q_id},
    )
    # Either the OpenAI call succeeds (200 with a client_secret) or it fails
    # at the upstream API (502). What MUST NOT happen is a 422 (schema reject)
    # or 404 (question lookup fail).
    assert response.status_code in (200, 502), response.text


def test_client_secret_returns_404_for_unknown_pinned_question_id(client, session_id):
    fake_id = str(uuid.uuid4())
    response = client.post(
        "/realtime/client-secret",
        json={"session_id": session_id, "pinned_question_id": fake_id},
    )
    assert response.status_code == 404


def test_client_secret_still_works_without_pinned_question_id(client, session_id):
    response = client.post(
        "/realtime/client-secret",
        json={"session_id": session_id},
    )
    assert response.status_code in (200, 502), response.text


def test_next_question_response_includes_transcription_keywords(client, session_id):
    q_id = insert_question(
        text="Another keyword test",
        transcription_keywords=["dangerouslySetInnerHTML"],
    )
    response = client.get(f"/questions/next?question_id={q_id}&mode=single")
    assert response.status_code == 200
    body = response.json()
    assert body["transcription_keywords"] == ["dangerouslySetInnerHTML"]
```

- [ ] **Step 3: Run the e2e suite**

Make sure the test stack is up:
```bash
make test-env-up
```

Run:
```bash
make test-api
```
Expected: all tests pass, including the four new ones in `test_realtime_keywords.py`.

If `test_client_secret_accepts_pinned_question_id` returns 502 because the test environment has no real OpenAI API key, that's acceptable — the assertion allows 502. The point is to verify the request schema is accepted and the question lookup succeeds.

- [ ] **Step 4: Commit**

```bash
git add e2e/api/tests/test_realtime_keywords.py e2e/api/tests/conftest.py
git commit -m "test(realtime): e2e coverage for pinned_question_id and keywords response"
```

---

### Task 10: Manual verification

**Goal:** Confirm the original bug (`innerHTML` → `inline HTML`) no longer occurs end-to-end.

- [ ] **Step 1: Ensure backfill ran successfully**

Run:
```bash
psql "host=localhost port=5432 dbname=interview_practice user=interview password=interview" \
  -c "SELECT text, transcription_keywords FROM questions WHERE text LIKE '%XSS%';"
```
Expected: each XSS row has `innerHTML` (or equivalent) in its `transcription_keywords`.

- [ ] **Step 2: Start frontend + backend**

```bash
cd backend && uvicorn app.main:app --reload --port 8000 &
cd frontend && npm run dev
```

Open `http://localhost:3000` in a browser.

- [ ] **Step 3: Run a single-mode XSS question**

- Pick the XSS question in the UI (single mode).
- Read the reference-answer text aloud, including the phrase "避免使用 innerHTML 注入未經信任的內容".
- Submit the answer.

- [ ] **Step 4: Check the resulting transcript**

After submission, look at the attempt detail (or query the DB):

```bash
psql "host=localhost port=5432 dbname=interview_practice user=interview password=interview" \
  -c "SELECT raw_transcript, transcript FROM attempts ORDER BY created_at DESC LIMIT 1;"
```

Expected: `transcript` contains `innerHTML` (not `inline HTML`). The AI feedback should no longer say "未提及 innerHTML".

- [ ] **Step 5: Repeat in mock mode**

Start a mock session, let the AI ask the XSS question, answer with the same phrasing, and confirm the transcript again contains `innerHTML`. This verifies the `session.update` path works.

- [ ] **Step 6: Done — no commit, this is a verification step**

If steps 4 and 5 both pass, the change is functionally complete. If either fails, the bug is in either the backfill output (Task 6) or the `session.update` event timing (Task 8) — debug there.

---

## Out of Scope

- UI to display `raw_transcript` alongside `transcript` for users to inspect STT drift themselves — separate change.
- Auto-rerun extraction when a question's `reference_answer` is edited — MVP post-deploy.
- Lint / automated check that the front-end and back-end base prompts stay in sync — relying on inline `KEEP IN SYNC` comments per spec.
