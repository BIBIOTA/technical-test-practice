# Transcript Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a `gpt-4o-mini` normalization pass on the user's speech-to-text transcript before saving it to the database, so both the UI display and evaluation model receive corrected technical vocabulary.

**Architecture:** A new `normalize_transcript()` async service function is called synchronously on the `POST /attempts` request path. The cleaned transcript is stored in the DB and returned in the API response. The frontend removes the raw-transcript flush from `submitAnswer()` and instead displays the single cleaned version returned by the API after `createAttempt` resolves.

**Tech Stack:** Python 3.12, FastAPI, `openai` Python SDK (`AsyncOpenAI`), TypeScript, Next.js

---

### Task 1: `normalize_transcript` service (TDD)

**Files:**
- Create: `backend/app/services/transcript.py`
- Create: `backend/tests/test_transcript.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_transcript.py`:

```python
import unittest
from unittest.mock import AsyncMock, MagicMock, patch


class NormalizeTranscriptTest(unittest.IsolatedAsyncioTestCase):
    async def test_returns_empty_string_unchanged(self):
        from app.services.transcript import normalize_transcript
        self.assertEqual(await normalize_transcript(""), "")

    async def test_returns_whitespace_only_unchanged(self):
        from app.services.transcript import normalize_transcript
        self.assertEqual(await normalize_transcript("   "), "   ")

    async def test_skips_api_call_in_offline_mode(self):
        from app.services.transcript import normalize_transcript
        with patch("app.services.transcript.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = True
            mock_settings.openai_api_key = "key"
            with patch("app.services.transcript.AsyncOpenAI") as mock_cls:
                result = await normalize_transcript("偶一 常數時間")
                mock_cls.assert_not_called()
                self.assertEqual(result, "偶一 常數時間")

    async def test_returns_cleaned_text_from_api(self):
        from app.services.transcript import normalize_transcript
        mock_response = MagicMock()
        mock_response.choices[0].message.content = "O(1) 常數時間"
        with patch("app.services.transcript.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcript.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client
                result = await normalize_transcript("偶一 常數時間")
                self.assertEqual(result, "O(1) 常數時間")

    async def test_falls_back_to_raw_on_api_error(self):
        from app.services.transcript import normalize_transcript
        with patch("app.services.transcript.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcript.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(side_effect=Exception("network error"))
                mock_cls.return_value = mock_client
                result = await normalize_transcript("偶一 常數時間")
                self.assertEqual(result, "偶一 常數時間")

    async def test_falls_back_to_raw_when_api_returns_empty(self):
        from app.services.transcript import normalize_transcript
        mock_response = MagicMock()
        mock_response.choices[0].message.content = ""
        with patch("app.services.transcript.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcript.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client
                result = await normalize_transcript("偶一 常數時間")
                self.assertEqual(result, "偶一 常數時間")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /path/to/project/backend && python -m unittest tests.test_transcript -v
```

Expected: `ModuleNotFoundError: No module named 'app.services.transcript'`

- [ ] **Step 3: Implement `normalize_transcript`**

Create `backend/app/services/transcript.py`:

```python
import logging

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
你是語音辨識後處理工具，專門修正軟體工程技術面試的逐字稿。

常見錯誤類型：
- Big O 符號：「偶一」「偶n」「偶log」→「O(1)」「O(n)」「O(log n)」
- 數學術語：「接乘」「接產」→「階乘」
- 其他技術術語的同音字或近音字誤辨

修正規則：
1. 只修正明顯的語音辨識錯誤（同音字、近音字）
2. 保留填充詞（那、就是、嗯）和口語句構
3. 不改變說話者的語意和表達方式
4. 不增加或刪除實質內容

直接輸出修正後的文字，不加任何說明。\
"""


async def normalize_transcript(raw: str) -> str:
    if not raw.strip():
        return raw
    if settings.evaluation_offline_mode:
        return raw
    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": raw},
            ],
            max_tokens=2048,
            temperature=0,
        )
        cleaned = response.choices[0].message.content or ""
        return cleaned.strip() or raw
    except Exception as exc:
        logger.warning("normalize_transcript failed: %s", exc)
        return raw
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /path/to/project/backend && python -m unittest tests.test_transcript -v
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/transcript.py backend/tests/test_transcript.py
git commit -m "feat: add normalize_transcript service with gpt-4o-mini"
```

---

### Task 2: Wire normalization into `create_attempt` endpoint

**Files:**
- Modify: `backend/app/routers/attempts.py:1-44`
- Modify: `e2e/api/tests/test_attempts.py`

- [ ] **Step 1: Update the e2e test to expect `transcript` in the response**

In `e2e/api/tests/test_attempts.py`, update `test_create_attempt`:

```python
def test_create_attempt(client, session_id, question_id):
    response = client.post(
        "/attempts",
        json={
            "session_id": session_id,
            "question_id": question_id,
            "transcript": "A REST API uses HTTP methods to interact with resources.",
        },
    )

    assert response.status_code == 202
    body = response.json()
    assert "attempt_id" in body
    assert body["status"] == "pending_evaluation"
    assert body["transcript"] == "A REST API uses HTTP methods to interact with resources."
```

- [ ] **Step 2: Run the e2e test to confirm it fails** (requires test stack running)

```bash
make test-env-up && make wait-for-backend
cd e2e/api && .venv/bin/pytest tests/test_attempts.py::test_create_attempt -v
```

Expected: `KeyError: 'transcript'` or assertion failure.

- [ ] **Step 3: Update `create_attempt` in `attempts.py`**

Replace the import block and `create_attempt` function. The full updated top of the file (lines 1–44):

```python
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, verify_token
from app.models.attempt import Attempt
from app.models.interview_session import InterviewSession
from app.models.question import Question
from app.services.evaluation import get_provider
from app.services.sm2 import get_or_create_sm2_state, update_sm2
from app.services.transcript import normalize_transcript

router = APIRouter(prefix="/attempts", tags=["attempts"])


class CreateAttemptRequest(BaseModel):
    session_id: uuid.UUID
    question_id: uuid.UUID
    transcript: str | None = None


@router.post("", status_code=202)
async def create_attempt(
    body: CreateAttemptRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    cleaned = await normalize_transcript(body.transcript or "")
    attempt = Attempt(
        session_id=body.session_id,
        question_id=body.question_id,
        transcript=cleaned,
        status="pending_evaluation",
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)

    background_tasks.add_task(_run_evaluation, attempt.id)

    return {
        "attempt_id": str(attempt.id),
        "status": attempt.status,
        "transcript": attempt.transcript,
    }
```

- [ ] **Step 4: Run the e2e test again**

```bash
cd e2e/api && .venv/bin/pytest tests/test_attempts.py -v
```

Expected: All attempt tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/attempts.py e2e/api/tests/test_attempts.py
git commit -m "feat: normalize transcript in create_attempt before saving to DB"
```

---

### Task 3: Update frontend API type

**Files:**
- Modify: `frontend/lib/api.ts:108-122`

- [ ] **Step 1: Update `AttemptCreated` interface**

In `frontend/lib/api.ts`, replace the `AttemptCreated` interface (lines 108–111):

```ts
export interface AttemptCreated {
  attempt_id: string;
  status: string;
  transcript: string;
}
```

- [ ] **Step 2: Run frontend lint to confirm no type errors**

```bash
cd frontend && npm run lint
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add transcript field to AttemptCreated API type"
```

---

### Task 4: Update `realtimeClient.ts` transcript display

**Files:**
- Modify: `frontend/lib/realtimeClient.ts:156-176` (submitAnswer)
- Modify: `frontend/lib/realtimeClient.ts:279-290` (mark_answer_completed handler)

- [ ] **Step 1: Remove all raw transcript pushes to the UI**

There are two places in `frontend/lib/realtimeClient.ts` that push raw user transcripts to the UI. Both must be removed.

**1a. Remove the flush loop from `submitAnswer()` (lines 156–176):**

```ts
submitAnswer(): void {
  if (this.hasSubmittedAnswer) return;
  this.hasSubmittedAnswer = true;
  // Do NOT flush raw transcripts here — the cleaned transcript is surfaced
  // to the UI after createAttempt resolves in mark_answer_completed.
  this.sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "（送出答案）" }],
    },
  });
  this.sendEvent({ type: "input_audio_buffer.commit" });
  this.sendResponseCreate();
}
```

**1b. Remove the `hasSubmittedAnswer` UI push from the `conversation.item.input_audio_transcription.completed` handler (lines 225–236):**

Keep the `completedUserTranscripts.push()` call (needed for scoring) but remove the `onTranscript` call inside the `if (this.hasSubmittedAnswer)` block. Replace the whole block with:

```ts
if (type === "conversation.item.input_audio_transcription.completed") {
  const transcript = event.transcript as string;
  if (transcript.trim()) {
    this.completedUserTranscripts.push(transcript.trim());
  }
}
```

- [ ] **Step 2: Add cleaned transcript display in `mark_answer_completed`**

In `frontend/lib/realtimeClient.ts`, replace the `mark_answer_completed` handler block (lines 279–289):

```ts
} else if (name === "mark_answer_completed") {
  const capturedTranscript = this.completedUserTranscripts.join(" ").trim();
  const transcript = capturedTranscript || String(args.transcript ?? "").trim();
  const attempt = await createAttempt(
    this.sessionId,
    args.question_id ?? this.currentQuestionId ?? "",
    transcript
  );
  this.currentAttemptId = attempt.attempt_id;
  this.completedUserTranscripts = [];
  if (attempt.transcript) {
    this.callbacks.onTranscript({ role: "user", text: attempt.transcript });
  }
  output = attempt;
```

- [ ] **Step 3: Run frontend lint and build**

```bash
cd frontend && npm run lint && npm run build
```

Expected: No errors or warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/realtimeClient.ts
git commit -m "feat: display normalized transcript from API instead of raw VAD fragments"
```

---

### Task 5: Full integration verification

- [ ] **Step 1: Run all backend unit tests**

```bash
cd backend && python -m unittest discover -s tests -v
```

Expected: All tests pass (including the 6 new `NormalizeTranscriptTest` tests and existing `RealtimeSessionConfigTest` tests).

- [ ] **Step 2: Run the full e2e test suite**

```bash
make test
```

Expected: All API and UI tests pass.

- [ ] **Step 3: Manual smoke test**

Start the dev stack and open the interview app. Answer a question with deliberate pauses. After clicking Submit:
- The transcript panel should show **no user text** immediately after submit.
- After ~2 seconds (normalization round-trip), the user transcript should appear — clean, with correct technical terms.
- The evaluation result should also reflect the corrected vocabulary.
