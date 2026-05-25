## Why

The frontend currently has no structured error handling — API failures surface as raw `alert()` dialogs or are silently swallowed with `console.error`. When OpenAI quota is exhausted or the backend is unreachable, users see browser-native popups or no feedback at all, which is jarring and provides no actionable guidance.

## What Changes

- Add `ApiError` class that carries HTTP `status` and `code` from every failed API response
- Update `apiFetch` to throw `ApiError` instead of generic `Error`
- Add `parseConnectionError()` utility that maps HTTP status codes to user-facing Traditional Chinese messages (429 quota, 404 model not found, 401/403 auth, 5xx server, TypeError network)
- Add `ErrorOverlay` component for fatal connection failures during interview (full-screen modal with retry/go-home actions)
- Add `Toast` notification system for transient mid-interview API errors (top-right, manual close, 8s auto-dismiss)
- Replace `alert()` on the home page with an inline error banner below the "開始面試" button

## Capabilities

### New Capabilities

- `error-handling`: Severity-tiered frontend error system with HTTP-status-specific Traditional Chinese messages, `ErrorOverlay` for fatal errors, `Toast` for non-fatal errors, and inline banners for form-level errors

### Modified Capabilities

<!-- No existing spec-level requirements are changing — this is purely additive UI/error handling -->

## Impact

- `frontend/lib/errors.ts` — new file
- `frontend/lib/api.ts` — `apiFetch` throw type changes from `Error` to `ApiError`
- `frontend/components/ErrorOverlay.tsx` — new component
- `frontend/app/interview/page.tsx` — adds fatal overlay and toast state
- `frontend/app/page.tsx` — replaces `alert()` with inline banner
- No backend changes, no API contract changes, no breaking changes
