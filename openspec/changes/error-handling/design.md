## Context

The frontend calls the backend via `apiFetch` (in `lib/api.ts`) which currently throws a generic `Error("API <status>: <body>")` on failure. The interview page's `onError` callback does `console.error`. The home page uses `alert()`. Users have no structured, actionable feedback when OpenAI quota is exhausted, the backend is unreachable, or a mid-interview API call fails.

The Figma designs (file `TJMfUV9YBE3ungBwNhxE5j`, page "Error Scenarios") specify exact visual treatment for each tier:
- **Fatal** → `ErrorOverlay` (frames 1 & 2)
- **Non-fatal** → `Toast` (frame 3)
- **Home inline** → banner below controls row (frame 4)

## Goals / Non-Goals

**Goals:**
- Typed `ApiError` carrying HTTP status so callers can branch on it
- Single `parseConnectionError()` mapping errors → `{ title, message }` in Traditional Chinese
- `ErrorOverlay` component for fatal failures, matching Figma frames 1–2
- `Toast` for transient mid-interview failures, matching Figma frame 3
- Inline error banner on home page replacing `alert()`, matching Figma frame 4

**Non-Goals:**
- Retry logic / exponential back-off
- Error logging to external services (Sentry, etc.)
- Backend error code standardisation
- Handling errors outside the interview and home-page flows

## Decisions

### D1: `ApiError` subclasses `Error`, not a plain object

Throwing a class instance means `instanceof` checks work cleanly in `parseConnectionError`, and the native `Error` stack trace is preserved. A plain object would require type guards (`'status' in err`) everywhere.

*Alternative considered:* Discriminated union (`type ErrorResult = { ok: false; status: number; ... }`). Rejected — it doesn't propagate through `throw/catch` naturally and would require returning instead of throwing from `apiFetch`, a larger refactor.

### D2: `parseConnectionError` as a standalone utility, not a hook

The mapping logic is pure and has no React dependencies. A plain function is easier to test and can be used from both React components and non-component code (e.g., `realtimeClient.ts`).

*Alternative considered:* A `useError` hook that also manages state. Rejected — mixing state management with message-mapping couples unrelated concerns.

### D3: Severity tier determined at the call site, not inside `parseConnectionError`

`parseConnectionError` only maps error → strings. The calling component decides whether to show `ErrorOverlay` (fatal) or `Toast` (non-fatal) based on *where* in the flow the error occurred, not on the error type alone. This keeps the utility simple.

### D4: Toast rendered inline in `interview/page.tsx`, not a global provider

A single interview page hosts all toast state. A global provider (`ToastContext`) is not needed for this scope. The `position: fixed` placement means the toast visually behaves as global even when rendered inside the page component.

## Risks / Trade-offs

- **`TypeError` check is fragile**: `parseConnectionError` uses `instanceof TypeError` to detect network errors, but TypeScript compilation to different targets can affect this. Mitigation: the catch-all fallback handles any unrecognised error safely.
- **Toast state doesn't queue multiple toasts**: If two errors fire in quick succession only the last one shows (state overwrite). Acceptable for this scope — simultaneous errors are rare mid-interview. A queue can be added later if needed.
- **`alert()` removal is a breaking UX change**: Users accustomed to the modal behaviour will now see an inline banner. Risk is low since `alert()` is universally considered poor UX.

## Migration Plan

1. Merge changes — no feature flags needed, all changes are isolated to the frontend
2. Existing `catch` blocks that currently check `err.message.includes("API 429")` are replaced by `err instanceof ApiError && err.status === 429`; no such checks exist in the current codebase so no migration is needed
3. No backend changes, no deployment coordination required
