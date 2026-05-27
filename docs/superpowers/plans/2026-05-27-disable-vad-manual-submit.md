# Disable VAD — Manual Submit Triggers AI Evaluation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable OpenAI Realtime server-side VAD so the AI never auto-responds during answering; the "送出答案" button commits the audio buffer and triggers AI evaluation.

**Architecture:** Set `turn_detection: None` in the backend session config so the Realtime API never auto-commits the audio buffer. On the frontend, replace the REST-API submit path with `submitAnswer()` on `RealtimeClient`, which sends `input_audio_buffer.commit` + `response.create` to hand control to the AI's existing evaluation function-call workflow.

**Tech Stack:** Python/FastAPI (backend session config), TypeScript/React/Next.js (frontend)

**Spec:** `docs/superpowers/specs/2026-05-27-disable-vad-manual-submit-design.md`

---

## File Map

| File | Change |
|---|---|
| `backend/app/routers/realtime.py` | Add `turn_detection: None`; update system prompt step 3–4 |
| `backend/tests/test_realtime.py` | Update stale assertions; add assertion for `turn_detection` |
| `frontend/lib/realtimeClient.ts` | Add `submitAnswer()`; remove `notifyManualEvalComplete()` |
| `frontend/app/interview/page.tsx` | Replace `handleSubmitAnswer`; update `onEvalResult`; add timeout ref; clean imports |

---

## Task 1: Backend — disable VAD in session config

**Files:**
- Modify: `backend/app/routers/realtime.py`
- Modify: `backend/tests/test_realtime.py`

- [ ] **Step 1: Update the existing test to reflect correct values and add turn_detection assertion**

Open `backend/tests/test_realtime.py` and replace its content entirely:

```python
import unittest

from app.routers.realtime import _build_realtime_session_config


class RealtimeSessionConfigTest(unittest.TestCase):
    def test_turn_detection_is_disabled(self) -> None:
        session = _build_realtime_session_config("single")
        self.assertIsNone(session.get("turn_detection"))

    def test_input_audio_transcription_uses_current_realtime_schema(self) -> None:
        session = _build_realtime_session_config("single")
        self.assertNotIn("input_audio_transcription", session)
        self.assertEqual(
            session["audio"]["input"]["transcription"],
            {"model": "gpt-4o-transcribe", "language": "zh-TW"},
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to confirm they fail before the fix**

```bash
cd backend && python -m pytest tests/test_realtime.py -v
```

Expected: both tests FAIL (`turn_detection` key absent / transcription model mismatch).

> Note: if you get `ModuleNotFoundError: No module named 'sqlalchemy'`, run inside the project's virtual environment (`source .venv/bin/activate` or equivalent).

- [ ] **Step 3: Add `turn_detection: None` to `_build_realtime_session_config`**

In `backend/app/routers/realtime.py`, update `_build_realtime_session_config` to:

```python
def _build_realtime_session_config(mode: str) -> dict:
    return {
        "type": "realtime",
        "model": "gpt-realtime-2025-08-28",
        "instructions": _build_system_prompt(mode),
        "tools": _get_tools(),
        "tool_choice": "auto",
        "turn_detection": None,
        "audio": {
            "input": {
                "transcription": {"model": "gpt-4o-transcribe", "language": "zh-TW"},
            },
            "output": {"voice": "coral"},
        },
    }
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd backend && python -m pytest tests/test_realtime.py -v
```

Expected: both tests PASS.

- [ ] **Step 5: Update the system prompt to remove voice-command trigger**

In `backend/app/routers/realtime.py`, update `_build_system_prompt`. Replace these two lines in the rules section:

```python
# OLD (in rules list, item 5):
5. 應試者表示回答完畢後，呼叫 mark_answer_completed tool 記錄答案，transcript 必須保留應試者原本的繁體中文，不可翻譯成英文
```

with:

```python
# NEW:
5. 應試者透過介面「送出答案」按鈕提交後，系統會自動提交音訊，請收到後立即呼叫 mark_answer_completed，transcript 填入音訊內容的繁體中文，不可翻譯成英文
```

And replace the workflow step 3–4:

```python
# OLD (in workflow list):
3. 等待應試者回答
4. 應試者說「回答完畢」或類似語句後，呼叫 mark_answer_completed，並以原文中文填入 transcript
```

with:

```python
# NEW:
3. 等待應試者透過介面「送出答案」按鈕送出回答（非語音觸發）
4. 收到系統送出的音訊後，立即呼叫 mark_answer_completed，transcript 填入音訊的繁體中文內容，不可翻譯成英文
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/realtime.py backend/tests/test_realtime.py
git commit -m "feat(realtime): disable server VAD and update submit instructions in system prompt"
```

---

## Task 2: Frontend — add `submitAnswer()`, remove `notifyManualEvalComplete()`

**Files:**
- Modify: `frontend/lib/realtimeClient.ts`

- [ ] **Step 1: Add `submitAnswer()` method**

In `frontend/lib/realtimeClient.ts`, add this method after `requestNextQuestion()` (around line 152):

```typescript
submitAnswer(): void {
  this.sendEvent({ type: "input_audio_buffer.commit" });
  this.sendEvent({ type: "response.create" });
}
```

- [ ] **Step 2: Remove `notifyManualEvalComplete()`**

Delete the entire `notifyManualEvalComplete` method (lines 124–140 in the current file):

```typescript
// DELETE this entire method:
notifyManualEvalComplete(attemptId: string): void {
  this.currentAttemptId = attemptId;
  this.sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: `[系統通知] 應試者已透過介面按鈕送出答案，後端已完成 mark_answer_completed 與評分（attempt_id: ${attemptId}）。工作流程中第4～8步均已完成。請直接跳至第9步：詢問是否繼續下一題。`,
      }],
    },
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors related to `realtimeClient.ts`. (Build may fail later due to `page.tsx` still referencing `notifyManualEvalComplete` — that is expected at this stage; fix it in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/realtimeClient.ts
git commit -m "feat(realtimeClient): add submitAnswer(); remove notifyManualEvalComplete()"
```

---

## Task 3: Frontend — update interview page submit flow

**Files:**
- Modify: `frontend/app/interview/page.tsx`

- [ ] **Step 1: Add `submitTimeoutRef` and update imports**

At the top of `InterviewContent` function body (after the existing `useRef` and `useState` declarations), add:

```typescript
const submitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Remove `createAttempt`, `getAttemptSummary`, and `pollAttemptResult` from the import on line 9. The import should become:

```typescript
import { completeSession, type EvaluationResult, type NextQuestion } from "../../lib/api";
```

(`EvaluationResult` and `NextQuestion` are still needed for type annotations.)

- [ ] **Step 2: Replace `handleSubmitAnswer`**

Delete the existing `handleSubmitAnswer` function (around lines 149–175) and replace with:

```typescript
function handleSubmitAnswer() {
  if (!currentQuestion || isSubmitting) return;
  setIsSubmitting(true);
  submitTimeoutRef.current = setTimeout(() => {
    setIsSubmitting(false);
    submitTimeoutRef.current = null;
    setToastError({
      title: "評分逾時",
      message: "AI 未能及時完成評分，請重試",
      severity: "error",
    });
  }, 30000);
  clientRef.current?.submitAnswer();
}
```

- [ ] **Step 3: Update `onEvalResult` callback to clear `isSubmitting` and the timeout**

In the `startSession` function, find the `onEvalResult` callback (around line 102) and update it:

```typescript
onEvalResult: (result) => {
  if (submitTimeoutRef.current) {
    clearTimeout(submitTimeoutRef.current);
    submitTimeoutRef.current = null;
  }
  setIsSubmitting(false);
  setEvalResult(result as EvaluationResult);
  setAnswerSummary(result.summary);
  setIsCompleted(true);
  setActiveTab("eval");
},
```

- [ ] **Step 4: Update `onError` callback to clear `isSubmitting` and the timeout**

Find the `onError` callback (around line 109) and update it:

```typescript
onError: (msg) => {
  if (submitTimeoutRef.current) {
    clearTimeout(submitTimeoutRef.current);
    submitTimeoutRef.current = null;
  }
  setIsSubmitting(false);
  const parsed = parseConnectionError(new Error(msg));
  setToastError({ ...parsed, severity: "warning" });
},
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
cd frontend && npm run build 2>&1 | tail -30
```

Expected: build succeeds with no errors. If there are unused-import warnings for `createAttempt` etc., make sure Step 1 removed them.

- [ ] **Step 6: Run lint**

```bash
cd frontend && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/interview/page.tsx
git commit -m "feat(interview): submit answer via audio commit; remove REST API eval path"
```

---

## Task 4: Manual smoke test

> There are no automated tests for the WebRTC voice flow. This task walks through the key scenarios by hand.

- [ ] **Step 1: Start the dev environment**

```bash
cd frontend && npm run dev
```

Open the app in your browser at `http://localhost:3000`.

- [ ] **Step 2: Test — AI does not interrupt mid-answer**

1. Start an interview session (any mode).
2. Wait for AI to ask the first question.
3. Open the microphone (click "開啟麥克風").
4. Speak 2–3 sentences, pausing for 2–3 seconds between sentences.
5. **Expected:** AI stays completely silent during your pauses. No AI voice or transcript appears.

- [ ] **Step 3: Test — Submit button triggers evaluation**

1. After speaking your answer, click "送出答案".
2. **Expected:** Button shows "評分中..." and is disabled.
3. AI processes the audio and calls its evaluation tools (you can observe in the browser's DevTools → Network or Console `[RT]` logs).
4. After 5–15 seconds, evaluation result appears in the right panel and "isCompleted" state activates showing the next-question button.

- [ ] **Step 4: Test — Empty submit (mic muted)**

1. Start a session, keep mic muted (or don't open it).
2. Click "送出答案".
3. **Expected:** `isSubmitting` activates. AI receives an empty audio item, calls `mark_answer_completed` with empty transcript, evaluation completes with score 0. The result panel shows (with 0 score and empty summary).

- [ ] **Step 5: Test — Timeout path (optional, destructive)**

In `interview/page.tsx`, temporarily change the timeout from `30000` to `5000`. Submit an answer and disconnect your network immediately after clicking. Confirm the toast "評分逾時" appears after 5 seconds and `isSubmitting` clears. Revert the timeout change.

- [ ] **Step 6: Commit smoke-test confirmation**

No code changes needed if tests pass. If any bug was found and fixed, commit the fix:

```bash
git add <changed files>
git commit -m "fix: <describe what was wrong>"
```
