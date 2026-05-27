# Design: Disable VAD — Manual Submit Triggers AI Evaluation

**Date:** 2026-05-27  
**Status:** Approved

## Problem

OpenAI Realtime API uses server-side VAD (Voice Activity Detection) by default. When the user pauses mid-answer (e.g., to think), VAD detects silence, auto-commits the audio buffer, and triggers an AI response — even though the user hasn't finished their answer. This interrupts the user's train of thought.

## Goal

The AI must not intervene in the user's conversation before the user explicitly submits their complete answer via the "送出答案" button.

## Architecture Overview

| Before | After |
|---|---|
| User speaks → pauses → VAD auto-commits → AI responds | User speaks → audio accumulates in buffer → AI stays silent |
| Evaluation triggered by voice command "回答完畢" | Evaluation triggered by "送出答案" button only |
| Submit button → REST API (no audio commit) | Submit button → `input_audio_buffer.commit` + `response.create` → AI function call evaluation |

### Data Flow (After)

```
Microphone → WebRTC → server audio buffer (idle, no auto-commit)
                                    ↓ (user clicks "送出答案")
                      input_audio_buffer.commit
                                    ↓
                          response.create
                                    ↓
              AI calls mark_answer_completed(transcript)
                                    ↓
              AI calls get_evaluation_summary(attempt_id)
                                    ↓
                      onEvalResult callback → UI shows result
```

## Files Changed

### 1. `backend/app/routers/realtime.py`

**Session config** — add `turn_detection: None` to disable server-side VAD:

```python
def _build_realtime_session_config(mode: str) -> dict:
    return {
        "type": "realtime",
        "model": "gpt-realtime-2025-08-28",
        "instructions": _build_system_prompt(mode),
        "tools": _get_tools(),
        "tool_choice": "auto",
        "turn_detection": None,   # disable server VAD
        "audio": {
            "input": {
                "transcription": {"model": "gpt-4o-transcribe", "language": "zh-TW"},
            },
            "output": {"voice": "coral"},
        },
    }
```

**System prompt** — replace voice-command trigger with button-submit trigger:

- Remove: "應試者說「回答完畢」或類似語句後，呼叫 mark_answer_completed"
- Replace with: "應試者透過介面「送出答案」按鈕提交後，系統自動送出音訊，收到後立即呼叫 mark_answer_completed，transcript 填入音訊內容的繁體中文，不可翻譯成英文"
- Update workflow step 3: "等待應試者透過介面按鈕送出回答（非語音觸發）"

### 2. `frontend/lib/realtimeClient.ts`

**Add `submitAnswer()` method** — commits buffered audio and triggers AI evaluation:

```typescript
submitAnswer(): void {
  this.sendEvent({ type: "input_audio_buffer.commit" });
  this.sendEvent({ type: "response.create" });
}
```

**Remove `notifyManualEvalComplete()`** — this method was the bridge for the old REST API submit path; no longer needed.

### 3. `frontend/app/interview/page.tsx`

**Replace `handleSubmitAnswer`** — remove REST API evaluation path, delegate to voice AI:

```typescript
function handleSubmitAnswer() {
  if (!currentQuestion || isSubmitting) return;
  setIsSubmitting(true);
  clientRef.current?.submitAnswer();
  // isSubmitting cleared by onEvalResult callback when AI evaluation completes
}
```

**Update `onEvalResult` callback** — add `setIsSubmitting(false)`:

```typescript
onEvalResult: (result) => {
  setIsSubmitting(false);
  setEvalResult(result as EvaluationResult);
  setAnswerSummary(result.summary);
  setIsCompleted(true);
  setActiveTab("eval");
},
```

**Add submit timeout** — prevent `isSubmitting` from being stuck if AI fails. Use a `useRef` to hold the timer so it can be cancelled:

```typescript
const submitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

function handleSubmitAnswer() {
  if (!currentQuestion || isSubmitting) return;
  setIsSubmitting(true);
  submitTimeoutRef.current = setTimeout(() => {
    setIsSubmitting(false);
    setToastError({ title: "評分逾時", message: "請重試", severity: "error" });
  }, 30000);
  clientRef.current?.submitAnswer();
}

// In onEvalResult and onError callbacks:
if (submitTimeoutRef.current) {
  clearTimeout(submitTimeoutRef.current);
  submitTimeoutRef.current = null;
}
```

**Remove from `interview/page.tsx` imports only** (these functions remain in `realtimeClient.ts` for AI function call handlers):
- `createAttempt`, `getAttemptSummary`, `pollAttemptResult`

## Edge Cases

| Scenario | Behavior |
|---|---|
| User clicks submit with no audio (mic muted or never spoke) | Buffer is empty → commit creates empty audio item → AI receives no content → calls `mark_answer_completed` with empty transcript → backend returns score 0 (existing behavior) |
| AI evaluation times out or throws | `onError` callback fires toast; 30-second timeout in `handleSubmitAnswer` clears `isSubmitting` |
| User mutes mic mid-answer | `track.enabled = false` stops audio reaching WebRTC; prior audio already in buffer is preserved and committed on submit |
| User clicks submit twice | `isSubmitting` guard prevents double-commit |

## What Does NOT Change

- Sound wave visualization (uses local `AudioContext`, not server VAD events)
- `input_audio_buffer.speech_started` event handling — with VAD disabled this event no longer fires, but it was only used for a typing indicator (empty-text transcript), which is acceptable to lose
- `requestNextQuestion()` — unaffected; still sends conversation item + `response.create`
- All other RealtimeClient callbacks and tool handlers
- Backend REST API for attempts and evaluation (still used by AI function calls internally)
