# Show User Voice Transcript After Submit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After clicking "送出答案", the user's spoken transcript appears in both the left panel "您的回答逐字稿" section and the right panel "評分結果" card.

**Architecture:** Fix a timing race in `realtimeClient.ts` — transcription events can arrive before `hasSubmittedAnswer` is true because semantic_vad commits the audio buffer before the user clicks submit. Flushing `completedUserTranscripts` immediately in `submitAnswer()` resolves this. Then add an `answerTranscript` prop to `EvalResultCard` and wire it from `interview/page.tsx` using the same `transcripts` state that already drives the left panel.

**Tech Stack:** TypeScript, React, Next.js, Playwright

---

## Files

| File | Change |
|------|--------|
| `e2e/playwright/tests/interview.spec.ts` | Fix existing assertion; add new test for transcript-after-submit |
| `frontend/lib/realtimeClient.ts` | Flush `completedUserTranscripts` to UI in `submitAnswer()` |
| `frontend/components/EvalResultCard.tsx` | Add optional `answerTranscript` prop; render new "您的回答" card |
| `frontend/app/interview/page.tsx` | Compute `answerTranscript` from `transcripts` state; pass to `EvalResultCard` |

---

## Task 1: Fix existing flawed test assertion + write failing tests

**Files:**
- Modify: `e2e/playwright/tests/interview.spec.ts`

The test `"realtime answer submission keeps Chinese transcript..."` has a stale DOM assertion (line 272) that expects the user transcript to be visible without a submit click — that path is guarded by `hasSubmittedAnswer` and will never surface the text. Remove it so the test can run cleanly. Then add a new test that covers the full real user flow: transcription event → submit click → eval completion → transcript visible in both panels.

- [ ] **Step 1: Remove stale DOM assertion from existing test**

In `e2e/playwright/tests/interview.spec.ts`, find the test `"realtime answer submission keeps Chinese transcript and shows feedback text"` and delete the last `expect` line inside it (the one that checks `page.getByText("我會先用資料庫索引縮小查詢範圍...")`). The test should end at:

```typescript
  await expect.poll(() => submittedBody?.transcript).toBe("我會先用資料庫索引縮小查詢範圍，並確認查詢計畫。");

  await emitRealtimeEvent(page, {
    type: "response.output_text.done",
    text: "這段回答有提到索引與查詢計畫，但可以補充取捨。",
  });

  await expect(page.getByText("這段回答有提到索引與查詢計畫，但可以補充取捨。").first()).toBeVisible();
});
```

- [ ] **Step 2: Add new failing test at the bottom of the file**

Append this test to `e2e/playwright/tests/interview.spec.ts`:

```typescript
test("user voice transcript appears in left panel and eval card after submit", async ({ page }) => {
  await grantMicrophone(page);
  await mockRealtimeStartup(page);

  // Mock: question fetch (needed to enable the submit button)
  await page.route("**/questions/next**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        question_id: "00000000-0000-0000-0000-000000000001",
        question_text: "如何優化慢查詢？",
        category: "資料庫",
        difficulty: "medium",
        tags: [],
        sm2: { ease_factor: null, interval_days: null, next_review_at: null, last_score: null },
      }),
    });
  });

  // Mock: attempt creation
  await page.route("**/attempts", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ attempt_id: "attempt-vis-test", status: "pending_evaluation" }),
    });
  });

  // Mock: poll result
  await page.route("**/attempts/attempt-vis-test/result", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ attempt_id: "attempt-vis-test", status: "completed", score: 70, evaluation: null }),
    });
  });

  // Mock: eval summary
  await page.route("**/attempts/attempt-vis-test/summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        score: 70,
        summary: "回答提及索引，可補充查詢計畫。",
        missing_points: [],
        next_focus: [],
        ideal_answer: "",
        provider: "test",
        model: "test-model",
      }),
    });
  });

  await page.goto(INTERVIEW_URL);
  await page.getByRole("button", { name: "開始面試" }).click();
  await page.waitForFunction(
    () => Boolean((window as unknown as { __rtDataChannel?: unknown }).__rtDataChannel)
  );

  // Emit get_next_question to set currentQuestion (enables submit button)
  await emitRealtimeEvent(page, {
    type: "response.function_call_arguments.done",
    call_id: "call-q",
    name: "get_next_question",
    arguments: JSON.stringify({ mode: "single" }),
  });

  // Wait for the question to render (submit button becomes enabled)
  await expect(page.getByRole("button", { name: "送出答案" })).not.toBeDisabled({ timeout: 3000 });

  // Simulate race condition: transcription completes BEFORE user clicks submit
  await emitRealtimeEvent(page, {
    type: "conversation.item.input_audio_transcription.completed",
    transcript: "我認為需要使用索引和快取策略。",
  });

  // User clicks submit — our fix flushes the accumulated transcript to the UI
  await page.getByRole("button", { name: "送出答案" }).click();

  // Complete the eval flow by emitting tool calls from the fake data channel
  await emitRealtimeEvent(page, {
    type: "response.function_call_arguments.done",
    call_id: "call-mark",
    name: "mark_answer_completed",
    arguments: JSON.stringify({
      session_id: "test-session-uuid",
      question_id: "00000000-0000-0000-0000-000000000001",
      transcript: "我認為需要使用索引和快取策略。",
    }),
  });
  await emitRealtimeEvent(page, {
    type: "response.function_call_arguments.done",
    call_id: "call-eval",
    name: "get_evaluation_summary",
    arguments: JSON.stringify({ attempt_id: "attempt-vis-test" }),
  });

  // Wait for eval card to appear (tab auto-switches to 評分結果)
  await expect(page.locator("text=AI 詳細反饋")).toBeVisible({ timeout: 5000 });

  // Assert: transcript visible in LEFT panel "您的回答逐字稿"
  await expect(page.locator("text=您的回答逐字稿")).toBeVisible();
  await expect(page.getByText("我認為需要使用索引和快取策略。").first()).toBeVisible();

  // Assert: right panel eval card shows "您的回答" section label (exact match avoids
  // matching "您的回答逐字稿" in the left panel as a substring)
  await expect(page.getByText("您的回答", { exact: true }).first()).toBeVisible();
  // The transcript text now appears in both panels — confirm the second occurrence
  await expect(page.getByText("我認為需要使用索引和快取策略。").nth(1)).toBeVisible();
});
```

- [ ] **Step 3: Run the new test to confirm it fails**

```bash
cd e2e/playwright && npx playwright test tests/interview.spec.ts --grep "transcript appears in left panel" --reporter=line
```

Expected: FAIL — the transcript does not yet appear because the flush and `EvalResultCard` prop haven't been added.

---

## Task 2: Fix `realtimeClient.ts` — flush transcripts on submit

**Files:**
- Modify: `frontend/lib/realtimeClient.ts:156-170`

- [ ] **Step 1: Add flush loop to `submitAnswer()`**

Replace the current `submitAnswer()` body in `frontend/lib/realtimeClient.ts`:

```typescript
submitAnswer(): void {
  this.hasSubmittedAnswer = true;
  // Flush transcripts that completed before the user clicked submit.
  // semantic_vad commits the audio buffer automatically, so the transcription
  // completed event can arrive while hasSubmittedAnswer is still false.
  for (const text of this.completedUserTranscripts) {
    this.callbacks.onTranscript({ role: "user", text });
  }
  // Do NOT clear completedUserTranscripts here — mark_answer_completed reads it.
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

- [ ] **Step 2: Run the new test again — left panel assertion should now pass**

```bash
cd e2e/playwright && npx playwright test tests/interview.spec.ts --grep "transcript appears in left panel" --reporter=line
```

Expected: Still FAIL, but now at the right panel eval card assertion (the transcript should appear in the left panel, but there's no "您的回答" section in `EvalResultCard` yet).

- [ ] **Step 3: Run the full interview spec to confirm no regressions**

```bash
cd e2e/playwright && npx playwright test tests/interview.spec.ts --reporter=line
```

Expected: All existing tests pass; new test fails at the eval card assertion.

---

## Task 3: Add `answerTranscript` prop and section to `EvalResultCard`

**Files:**
- Modify: `frontend/components/EvalResultCard.tsx`

- [ ] **Step 1: Update the Props interface**

In `EvalResultCard.tsx`, change the `Props` interface to:

```typescript
interface Props {
  evaluation: EvaluationResult;
  answerTranscript?: string;
  sm2?: {
    ease_factor: number | null;
    interval_days: number | null;
  };
}
```

- [ ] **Step 2: Destructure the new prop**

Change the function signature:

```typescript
export default function EvalResultCard({ evaluation, answerTranscript, sm2 }: Props) {
```

- [ ] **Step 3: Add the "您的回答" card before the score card**

Inside the component's return, add this block **before** the existing `{/* Score Card */}` div:

```typescript
{answerTranscript && (
  <div
    className="rounded-2xl p-5 flex flex-col gap-2"
    style={{ background: "var(--color-surface)" }}
  >
    <p className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
      您的回答
    </p>
    <div className="overflow-y-auto" style={{ maxHeight: 140 }}>
      <p
        className="text-sm leading-relaxed whitespace-pre-wrap"
        style={{ color: "#C5D0DE" }}
      >
        {answerTranscript}
      </p>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run lint to confirm no type errors**

```bash
cd frontend && npm run lint
```

Expected: No errors.

---

## Task 4: Compute `answerTranscript` in `interview/page.tsx` and pass to `EvalResultCard`

**Files:**
- Modify: `frontend/app/interview/page.tsx`

- [ ] **Step 1: Compute `answerTranscript` from `transcripts` state**

Inside `InterviewContent()`, add this derived value after the existing state declarations (around line 44, after the `isEvalTimedOut` state):

```typescript
const answerTranscript = transcripts
  .filter((m) => m.role === "user" && !m.isTyping && m.text.trim())
  .map((m) => m.text.trim())
  .join("\n\n");
```

- [ ] **Step 2: Pass `answerTranscript` to `EvalResultCard`**

Find the `EvalResultCard` usage in the JSX (inside the right panel tab content) and update it:

```typescript
{activeTab === "transcript" ? (
  <TranscriptPanel messages={transcripts} />
) : evalResult ? (
  <EvalResultCard
    evaluation={evalResult}
    answerTranscript={answerTranscript || undefined}
  />
) : (
```

- [ ] **Step 3: Run lint to confirm no type errors**

```bash
cd frontend && npm run lint
```

Expected: No errors.

---

## Task 5: Verify tests pass and commit

- [ ] **Step 1: Run the full interview Playwright spec**

```bash
cd e2e/playwright && npx playwright test tests/interview.spec.ts --reporter=line
```

Expected: All tests pass, including the new `"transcript appears in left panel and eval card after submit"` test.

- [ ] **Step 2: Run the full UI test suite**

```bash
cd /Users/bibiota/Documents/projects/technical-test-practice && make test-ui
```

Expected: All UI tests pass.

- [ ] **Step 3: Lint and build check**

```bash
cd frontend && npm run lint && npm run build
```

Expected: No errors or warnings.

- [ ] **Step 4: Commit**

```bash
git add \
  e2e/playwright/tests/interview.spec.ts \
  frontend/lib/realtimeClient.ts \
  frontend/components/EvalResultCard.tsx \
  frontend/app/interview/page.tsx
git commit -m "$(cat <<'EOF'
feat(interview): show user voice transcript after submit in both panels

Flush completedUserTranscripts immediately in submitAnswer() to fix a
timing race where semantic_vad commits the audio buffer before the user
clicks submit. Add answerTranscript prop to EvalResultCard so the spoken
content is visible in the 評分結果 tab without switching back to 對話紀錄.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
