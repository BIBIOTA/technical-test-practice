# Error Handling Design

**Date:** 2026-05-25
**Figma:** `TJMfUV9YBE3ungBwNhxE5j` — page "Error Scenarios"

## Overview

The frontend currently has no structured error handling. API failures surface as raw `alert()` or are silently swallowed. This spec defines a severity-tiered error system that maps HTTP status codes to actionable, user-facing messages in Traditional Chinese.

---

## 1. Error Severity Tiers

| Tier | Trigger | UI Component | Dismissible |
|------|---------|-------------|-------------|
| **Fatal** | Unrecoverable connection failure during interview | `ErrorOverlay` — full-screen modal | "重試" or "返回首頁" button |
| **Non-fatal** | Transient API error mid-interview | `Toast` — top-right notification | × button (manual close) |
| **Inline** | Session creation failure on home page | `InlineError` — banner below "開始面試" | Clears on next submit attempt |

---

## 2. Error Messages by HTTP Status

All messages are in Traditional Chinese. Each error type maps to a specific message:

| Condition | Title | Message |
|-----------|-------|---------|
| `429` quota exceeded | 連線發生錯誤 | API 使用額度不足，請前往 OpenAI 平台充值後再試。 |
| `404` model not found | 連線發生錯誤 | 指定的 AI 模型不存在，請聯絡管理員。 |
| `401` / `403` auth | 連線發生錯誤 | 認證失敗，請確認 API 金鑰設定正確。 |
| `5xx` server error | 連線發生錯誤 | 伺服器發生錯誤（`{status}`），請稍後再試。 |
| `TypeError` (network) | 無法連線到伺服器 | 無法連線到後端伺服器，請確認伺服器已啟動後重試。 |
| Unknown | 發生未知錯誤 | 發生未預期的錯誤，請重新整理頁面。 |

---

## 3. Components

### 3.1 `lib/errors.ts`

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) { super(message); }
}
```

`apiFetch` in `lib/api.ts` throws `ApiError` when `res.ok === false`, populating `status` from the HTTP response.

```ts
export function parseConnectionError(err: unknown): { title: string; message: string } {
  if (err instanceof ApiError) {
    if (err.status === 429) return { title: "連線發生錯誤", message: "API 使用額度不足，請前往 OpenAI 平台充值後再試。" };
    if (err.status === 404) return { title: "連線發生錯誤", message: "指定的 AI 模型不存在，請聯絡管理員。" };
    if (err.status === 401 || err.status === 403) return { title: "連線發生錯誤", message: "認證失敗，請確認 API 金鑰設定正確。" };
    if (err.status >= 500) return { title: "連線發生錯誤", message: `伺服器發生錯誤（${err.status}），請稍後再試。` };
  }
  if (err instanceof TypeError) return { title: "無法連線到伺服器", message: "無法連線到後端伺服器，請確認伺服器已啟動後重試。" };
  return { title: "發生未知錯誤", message: "發生未預期的錯誤，請重新整理頁面。" };
}
```

### 3.2 `components/ErrorOverlay.tsx`

Full-screen fatal error overlay. Matches Figma frames 1 & 2:
- Dark backdrop (`rgba(13,13,20,0.80)`)
- Centered card (`500×380px`, `border-radius: 20px`, surface-elevated background)
- Icon circle: red (`#F04444`) for quota/auth/server errors, amber (`#F59E0B`) for network errors
- HTTP status badge (red or amber background at 12% opacity)
- Title + message text
- Divider line
- Two buttons: "返回首頁" (secondary) + "重試" (primary purple)

Props:
```ts
interface ErrorOverlayProps {
  title: string;
  message: string;
  onRetry: () => void;
  onGoHome: () => void;
}
```

### 3.3 Toast System in `interview/page.tsx`

Top-right positioned toast for non-fatal errors. Matches Figma frame 3:
- `position: fixed`, `top: 24px`, `right: 24px`, `z-index: 50`
- Card width `440px`, `border-radius: 12px`
- Left color bar (4px wide): amber for warnings, red for errors
- Icon circle + severity icon
- Title (Semi Bold 13px) + message (Regular 12px)
- × close button (top-right corner of toast)
- Auto-dismiss after 8 seconds, or manual × close

State: `toastError: { title: string; message: string; severity: "warning" | "error" } | null`

Shown for: `get_next_question` failures, `mark_answer_completed` failures, `get_evaluation_summary` failures.

### 3.4 Inline Error in `app/page.tsx`

Replaces the `alert()` call. Matches Figma frame 4:
- Banner below the controls row (provider buttons + start button)
- `border-radius: 10px`, red at 8% opacity, 1px red border at 25% opacity
- ✕ icon + error message on single line
- Text: light red (`rgb(255,153,153)`)
- Cleared when user clicks "開始面試" again
- "開始面試" button shows `opacity: 0.5` while `loading === true`

State: `sessionError: string | null`

---

## 4. Data Flow

```
User action
  └─► apiFetch() throws ApiError (status, code, message)
        └─► parseConnectionError(err)
              └─► { title, message }
                    ├─► Fatal (interview page init) → ErrorOverlay
                    ├─► Non-fatal (mid-interview tool call) → Toast
                    └─► Session creation (home page) → InlineError banner
```

---

## 5. Affected Files

| File | Change |
|------|--------|
| `frontend/lib/errors.ts` | New file: `ApiError` class + `parseConnectionError()` |
| `frontend/lib/api.ts` | `apiFetch` throws `ApiError` instead of generic `Error` |
| `frontend/components/ErrorOverlay.tsx` | New component |
| `frontend/app/interview/page.tsx` | Add toast state + `ErrorOverlay` for fatal init errors |
| `frontend/app/page.tsx` | Replace `alert()` with `InlineError` banner |

---

## 6. Out of Scope

- Retry logic / exponential back-off (future)
- Error logging / Sentry integration (future)
- Microphone permission error (already handled as a dedicated UI state)
