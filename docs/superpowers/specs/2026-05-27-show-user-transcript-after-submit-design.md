# Design: Show User Voice Transcript After Submit

**Date:** 2026-05-27  
**Status:** Approved

## Problem

After the user submits their answer, their spoken content does not appear in either:
1. The left panel's "您的回答逐字稿" section
2. The right panel's "評分結果" tab

This makes it impossible to review what was said when looking back at the session.

## Root Cause

In `frontend/lib/realtimeClient.ts`, the `conversation.item.input_audio_transcription.completed` event fires when semantic_vad detects end-of-speech and commits the audio buffer — which can happen **before** the user clicks "送出答案". At that point `hasSubmittedAnswer` is still `false`, so the transcript is stored in `completedUserTranscripts` but never passed to the UI via `onTranscript`. After the user clicks submit, that event does not re-fire, so the transcript is permanently lost from the UI.

## Requirements

- After submitting, the user's voice transcript must appear in both:
  - Left panel: "您的回答逐字稿" section (already rendered, but shows "尚未收到語音逐字稿" due to missing data)
  - Right panel: "評分結果" tab (currently shows no user speech at all)
- The tab auto-switch to "評分結果" after submit is preserved (no UX change to that flow)
- No duplicate messages in the transcript

## Design

### 1. Fix timing race in `realtimeClient.ts`

**File:** `frontend/lib/realtimeClient.ts`

In `submitAnswer()`, immediately flush any already-accumulated transcripts before they are lost:

```typescript
submitAnswer(): void {
  this.hasSubmittedAnswer = true;
  // Flush transcripts that completed before the user clicked submit
  for (const text of this.completedUserTranscripts) {
    this.callbacks.onTranscript({ role: "user", text });
  }
  // Do NOT clear completedUserTranscripts here — mark_answer_completed tool call needs it.
  // The array is cleared by mark_answer_completed after it reads the value.
  // ... rest unchanged
}
```

After this change, the `transcripts` React state in `interview/page.tsx` will contain user messages, which makes the left panel's existing `answerTranscript` computation work correctly.

**No dedup needed**: a given audio buffer can only be committed once. The transcription completed event fires exactly once per committed segment — if VAD committed before submit, the event fired already (stored in `completedUserTranscripts`); if the user's manual commit in `submitAnswer()` triggers transcription, that event will fire after submit when `hasSubmittedAnswer` is already `true` and the event handler will surface it directly. The same transcript cannot surface twice.

### 2. Add "您的回答" section to `EvalResultCard`

**File:** `frontend/components/EvalResultCard.tsx`

Add an optional `answerTranscript?: string` prop. When present, render a card above the score card:

- Label: "您的回答"
- Body: `whitespace-pre-wrap` text in `#C5D0DE` (matches left panel style)
- Card style: same `var(--color-surface)` rounded card as existing sections
- Scrollable if content is long (`max-h` + `overflow-y-auto`)

The section is omitted entirely when `answerTranscript` is undefined or empty.

### 3. Compute and pass `answerTranscript` in `interview/page.tsx`

**File:** `frontend/app/interview/page.tsx`

Compute `answerTranscript` directly from the `transcripts` state (same logic already used locally in `InterviewRoom.tsx`) and pass it to `EvalResultCard`:

```typescript
const answerTranscript = transcripts
  .filter((m) => m.role === "user" && !m.isTyping && m.text.trim())
  .map((m) => m.text.trim())
  .join("\n\n");

// In JSX:
<EvalResultCard
  evaluation={evalResult}
  answerTranscript={answerTranscript || undefined}
/>
```

## Change Summary

| File | Change | Lines |
|------|--------|-------|
| `frontend/lib/realtimeClient.ts` | Flush + clear `completedUserTranscripts` in `submitAnswer()` | ~5 |
| `frontend/components/EvalResultCard.tsx` | Add `answerTranscript` prop + new card section | ~20 |
| `frontend/app/interview/page.tsx` | Compute `answerTranscript` + pass to `EvalResultCard` | ~5 |

## Out of Scope

- Real-time display of user speech while they are speaking (live typing indicator) — this is a separate feature
- Tab behavior change (auto-switch to eval is preserved)
- Persisting transcripts across page reloads
