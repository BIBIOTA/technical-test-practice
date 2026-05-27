# Transcript Normalization Design

**Date:** 2026-05-27  
**Status:** Approved

## Problem

The realtime interview app uses OpenAI's `gpt-4o-transcribe` model with VAD-based segmentation. Each silence-bounded speech segment is transcribed independently, causing technical CS terms spoken in Chinese to be misrecognized:

- `偶襪` → should be `O(1)`
- `安德二世房` → should be `O(n²)`
- `接乘` / `接產` → should be `階乘`（factorial）

These errors affect both the transcript displayed in the UI and the transcript submitted for scoring.

## Goal

Clean the transcript **before** it is stored in the database so that:
1. The UI shows the corrected transcript after submission
2. The evaluation model scores based on accurate technical vocabulary

## Solution: Submit-time LLM Normalization (Approach B)

After the user clicks Submit and the frontend joins all VAD segments into one string, the backend runs a `gpt-4o-mini` normalization pass before saving the `Attempt` record.

## Data Flow

```
[User clicks Submit]
        ↓
realtimeClient: completedUserTranscripts.join(" ")
        ↓ raw transcript
POST /attempts  { session_id, question_id, transcript }
        ↓
[backend: normalize_transcript(raw)]  ← NEW
        ↓ cleaned transcript
Attempt saved to DB (transcript = cleaned)
        ↓
API response includes { attempt_id, transcript: cleaned }
        ↓
realtimeClient: onTranscript({ role: "user", text: cleaned })  ← NEW
        ↓
UI replaces raw transcript with cleaned version
        ↓
Background evaluation runs against cleaned transcript
```

## Components

### 1. `backend/app/services/transcript.py` (new file)

```python
async def normalize_transcript(raw: str) -> str
```

- Calls `gpt-4o-mini` via `AsyncOpenAI`
- On failure: logs the error and returns `raw` unchanged (no exceptions propagate)
- Empty or whitespace-only input is returned as-is without making an API call

**Normalization prompt (system):**
```
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

直接輸出修正後的文字，不加任何說明。
```

### 2. `backend/app/routers/attempts.py` — `create_attempt` endpoint

Insert normalization call on the **request path** (synchronous, before `Attempt` creation):

```python
from app.services.transcript import normalize_transcript

cleaned = await normalize_transcript(body.transcript or "")
attempt = Attempt(
    session_id=body.session_id,
    question_id=body.question_id,
    transcript=cleaned,
    status="pending_evaluation",
)
```

Add `transcript` to the API response:

```python
return {
    "attempt_id": str(attempt.id),
    "status": attempt.status,
    "transcript": attempt.transcript,
}
```

### 3. `frontend/lib/api.ts` — `createAttempt` return type

Update the return type to include `transcript: string`.

### 4. `frontend/lib/realtimeClient.ts` — transcript display timing

**Remove** the raw transcript flush from `submitAnswer()` (currently lines 162–164):

```ts
// REMOVE this block from submitAnswer():
for (const text of this.completedUserTranscripts) {
  this.callbacks.onTranscript({ role: "user", text });
}
```

**Add** a single `onTranscript` call in the `mark_answer_completed` handler after `createAttempt` resolves, using the cleaned transcript returned from the API:

```ts
const attempt = await createAttempt(...)
if (attempt.transcript) {
  this.callbacks.onTranscript({ role: "user", text: attempt.transcript })
}
```

This ensures the user sees exactly one version of their transcript — the normalized one — with a ~2-second delay after submitting. The raw fragments are never displayed.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `normalize_transcript` API call fails | Returns raw transcript; attempt creation continues normally |
| `normalize_transcript` returns empty string | Returns raw transcript |
| `body.transcript` is null or empty | Normalization skipped; existing empty-transcript path unchanged |

## Latency Impact

The normalization call adds ~1–2 seconds to the `POST /attempts` response time. This latency occurs while the user is waiting for evaluation results (which run asynchronously), so it is not user-perceptible in practice.

## Out of Scope

- Storing the raw transcript alongside the cleaned version (can be added later if debugging is needed)
- Dynamic per-question vocabulary prompts
- Real-time transcript correction during speech (before Submit)
