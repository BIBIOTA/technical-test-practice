# Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw `alert()` and silent swallowing with a severity-tiered error system (ErrorOverlay / Toast / InlineError) matching Figma designs in file `TJMfUV9YBE3ungBwNhxE5j` page "Error Scenarios".

**Architecture:** A shared `ApiError` class carries `status` + `code` from every failed API response; `parseConnectionError()` maps those to user-facing Traditional Chinese strings. Fatal connection failures during interview show a full-screen `ErrorOverlay`; transient mid-interview failures show a `Toast` in the top-right; session-creation failures on the home page show an inline banner.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS (inline styles follow existing globals.css conventions)

**Design reference:** Figma page "Error Scenarios", frames 1–4. Match exact colors — `#F04444` (red), `#F59E0B` (amber), `#6C63FF` (primary), `#1A1D26` (surface-elevated), `#E2E8F0` (text-primary), `#94A3B8` (text-secondary).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/lib/errors.ts` | Create | `ApiError` class + `parseConnectionError()` |
| `frontend/lib/api.ts` | Modify (line 16–19) | Throw `ApiError` instead of generic `Error` |
| `frontend/components/ErrorOverlay.tsx` | Create | Full-screen fatal error overlay |
| `frontend/app/interview/page.tsx` | Modify | Add toast state, `ErrorOverlay` for fatal init errors, wire `onError` |
| `frontend/app/page.tsx` | Modify | Replace `alert()` with `InlineError` banner |

---

## Task 1: Create `lib/errors.ts`

**Files:**
- Create: `frontend/lib/errors.ts`

- [ ] **Step 1: Create the file**

```typescript
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function parseConnectionError(err: unknown): { title: string; message: string } {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return { title: "連線發生錯誤", message: "API 使用額度不足，請前往 OpenAI 平台充值後再試。" };
    }
    if (err.status === 404) {
      return { title: "連線發生錯誤", message: "指定的 AI 模型不存在，請聯絡管理員。" };
    }
    if (err.status === 401 || err.status === 403) {
      return { title: "連線發生錯誤", message: "認證失敗，請確認 API 金鑰設定正確。" };
    }
    if (err.status >= 500) {
      return { title: "連線發生錯誤", message: `伺服器發生錯誤（${err.status}），請稍後再試。` };
    }
    return { title: "連線發生錯誤", message: `發生錯誤（${err.status}），請稍後再試。` };
  }
  if (err instanceof TypeError) {
    return { title: "無法連線到伺服器", message: "無法連線到後端伺服器，請確認伺服器已啟動後重試。" };
  }
  return { title: "發生未知錯誤", message: "發生未預期的錯誤，請重新整理頁面。" };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors referencing `lib/errors.ts`

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/errors.ts
git commit -m "feat(errors): add ApiError class and parseConnectionError utility"
```

---

## Task 2: Update `lib/api.ts` to throw `ApiError`

**Files:**
- Modify: `frontend/lib/api.ts` lines 11–21

- [ ] **Step 1: Replace the `apiFetch` error throw**

Find this block (lines 11–21):
```typescript
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
```

Replace with:
```typescript
import { ApiError } from "./errors";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, `HTTP_${res.status}`, `API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
```

Note: The `import` goes at the top of the file (line 1), before the `const API_URL` line.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(errors): apiFetch throws ApiError with status code"
```

---

## Task 3: Create `components/ErrorOverlay.tsx`

**Files:**
- Create: `frontend/components/ErrorOverlay.tsx`

Matches Figma frames 1 & 2. Red icon for `err.status` errors, amber icon for `TypeError` (network). Backdrop `rgba(13,13,20,0.80)`. Card: `500×auto`, `border-radius: 20px`, background `#212533`, border `1px solid` at 30% opacity.

- [ ] **Step 1: Create the component**

```typescript
"use client";

interface ErrorOverlayProps {
  title: string;
  message: string;
  isNetwork?: boolean;
  onRetry: () => void;
  onGoHome: () => void;
}

export default function ErrorOverlay({
  title,
  message,
  isNetwork = false,
  onRetry,
  onGoHome,
}: ErrorOverlayProps) {
  const accentColor = isNetwork ? "#F59E0B" : "#F04444";
  const iconChar = isNetwork ? "⚠" : "✕";

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(13,13,20,0.80)" }}
    >
      <div
        style={{
          width: 500,
          background: "#212533",
          border: `1px solid ${accentColor}4D`,
          borderRadius: 20,
          overflow: "hidden",
        }}
      >
        {/* Icon + title */}
        <div className="flex flex-col items-center gap-4 pt-9 pb-6 px-10">
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: `${accentColor}26`,
              border: `1.5px solid ${accentColor}99`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              color: accentColor,
              fontWeight: 700,
            }}
          >
            {iconChar}
          </div>

          <h2
            className="font-bold text-xl text-center"
            style={{ color: "#E2E8F0" }}
          >
            {title}
          </h2>

          {/* Status badge */}
          <div
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              background: `${accentColor}1F`,
              border: `1px solid ${accentColor}4D`,
              fontSize: 11,
              fontWeight: 600,
              color: accentColor,
            }}
          >
            {isNetwork ? "TypeError · Failed to Fetch" : "連線錯誤"}
          </div>

          <p
            className="text-sm text-center leading-relaxed"
            style={{ color: "#94A3B8" }}
          >
            {message}
          </p>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "#2A2F3B" }} />

        {/* Buttons */}
        <div className="flex gap-4 p-6">
          <button
            onClick={onGoHome}
            className="flex-1 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{
              background: "#212533",
              border: "1px solid #2A2F3B",
              color: "#94A3B8",
            }}
          >
            返回首頁
          </button>
          <button
            onClick={onRetry}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: "#6C63FF" }}
          >
            重試
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ErrorOverlay.tsx
git commit -m "feat(errors): add ErrorOverlay component for fatal connection errors"
```

---

## Task 4: Add Toast system to `app/interview/page.tsx`

**Files:**
- Modify: `frontend/app/interview/page.tsx`

Matches Figma frame 3. Toast appears `position: fixed`, `top: 24px`, `right: 24px`, width `440px`. Left color bar (4px). Auto-dismiss after 8 seconds. Manual × close button.

The `onError` callback (currently `console.error`) should show a toast. The `client.connect()` catch block should show `ErrorOverlay` for fatal init failures.

- [ ] **Step 1: Add imports at the top of `interview/page.tsx`**

Add to the existing import block:
```typescript
import ErrorOverlay from "../../components/ErrorOverlay";
import { parseConnectionError } from "../../lib/errors";
```

- [ ] **Step 2: Add toast and fatal-error state inside `InterviewContent`**

Add these two state declarations after the existing `useState` declarations (around line 31):
```typescript
const [toastError, setToastError] = useState<{
  title: string;
  message: string;
  severity: "warning" | "error";
} | null>(null);
const [fatalError, setFatalError] = useState<{
  title: string;
  message: string;
  isNetwork: boolean;
} | null>(null);
```

- [ ] **Step 3: Add toast auto-dismiss effect**

Add after the timer `useEffect` (after line 37):
```typescript
useEffect(() => {
  if (!toastError) return;
  const timer = setTimeout(() => setToastError(null), 8000);
  return () => clearTimeout(timer);
}, [toastError]);
```

- [ ] **Step 4: Update `startSession` to show `ErrorOverlay` on fatal connect failure**

Replace the `catch` block inside `startSession` (lines 74–79):
```typescript
// Before:
    try {
      await client.connect();
    } catch (err) {
      console.error("Failed to connect:", err);
      setConnectionStatus("error");
    }

// After:
    try {
      await client.connect();
    } catch (err) {
      const { title, message } = parseConnectionError(err);
      const isNetwork = err instanceof TypeError;
      setFatalError({ title, message, isNetwork });
      setConnectionStatus("error");
    }
```

- [ ] **Step 5: Update `onError` callback to show toast**

Replace the `onError` line (line 71) in the `RealtimeClient` constructor options:
```typescript
// Before:
      onError: (msg) => console.error("Realtime error:", msg),

// After:
      onError: (msg) => {
        const err = new Error(msg);
        const { title, message } = parseConnectionError(err);
        setToastError({ title, message, severity: "error" });
      },
```

- [ ] **Step 6: Add `ErrorOverlay` render — insert before the mic permission overlay**

Insert right after the opening `<div className="flex flex-col h-screen"...>` (before the `{micStatus === "idle" && ...}` block, around line 97):
```tsx
      {fatalError && (
        <ErrorOverlay
          title={fatalError.title}
          message={fatalError.message}
          isNetwork={fatalError.isNetwork}
          onRetry={() => {
            setFatalError(null);
            setConnectionStatus("disconnected");
            startSession();
          }}
          onGoHome={() => router.push("/")}
        />
      )}
```

- [ ] **Step 7: Add Toast render — insert before the closing `</div>` of the root element**

Insert just before the final `</div>` (line 212):
```tsx
      {toastError && (
        <div
          style={{
            position: "fixed",
            top: 24,
            right: 24,
            width: 440,
            zIndex: 50,
            borderRadius: 12,
            background: "#212533",
            border: `1px solid ${toastError.severity === "error" ? "#F0444466" : "#F59E0B66"}`,
            overflow: "hidden",
            display: "flex",
          }}
        >
          {/* Left color bar */}
          <div
            style={{
              width: 4,
              flexShrink: 0,
              background: toastError.severity === "error" ? "#F04444" : "#F59E0B",
            }}
          />
          {/* Icon */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: toastError.severity === "error" ? "#F0444426" : "#F59E0B26",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              margin: "20px 12px 20px 16px",
              fontSize: 14,
              fontWeight: 700,
              color: toastError.severity === "error" ? "#F04444" : "#F59E0B",
            }}
          >
            {toastError.severity === "error" ? "✕" : "⚠"}
          </div>
          {/* Text */}
          <div className="flex flex-col justify-center py-4 flex-1 gap-1">
            <p className="text-sm font-semibold" style={{ color: "#E2E8F0" }}>
              {toastError.title}
            </p>
            <p className="text-xs" style={{ color: "#94A3B8" }}>
              {toastError.message}
            </p>
          </div>
          {/* Close button */}
          <button
            onClick={() => setToastError(null)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "#2A2F3B",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              margin: "22px 16px 22px 0",
              cursor: "pointer",
              fontSize: 16,
              color: "#94A3B8",
            }}
          >
            ×
          </button>
        </div>
      )}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add frontend/app/interview/page.tsx
git commit -m "feat(errors): add ErrorOverlay for fatal connect failures and Toast for mid-interview errors"
```

---

## Task 5: Replace `alert()` with inline error banner in `app/page.tsx`

**Files:**
- Modify: `frontend/app/page.tsx`

Matches Figma frame 4. Red banner below the controls row (provider buttons + start button). Background `#F0444414`, border `1px solid #F0444440`, `border-radius: 10px`. Text `rgb(255,153,153)`.

- [ ] **Step 1: Add imports**

Add to the existing import block at the top of `app/page.tsx`:
```typescript
import { parseConnectionError } from "../lib/errors";
```

- [ ] **Step 2: Add `sessionError` state**

Add after the `loading` state (after line 41):
```typescript
const [sessionError, setSessionError] = useState<string | null>(null);
```

- [ ] **Step 3: Replace `handleStart`**

Replace the entire `handleStart` function (lines 43–55):
```typescript
  async function handleStart() {
    setLoading(true);
    setSessionError(null);
    try {
      const session = await createSession(selectedMode, evalProvider);
      router.push(
        `/interview?session_id=${session.session_id}&mode=${selectedMode}&provider=${evalProvider}`
      );
    } catch (err) {
      const { message } = parseConnectionError(err);
      setSessionError(message);
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 4: Add inline error banner below the controls row**

The controls row is the `<div className="flex items-center justify-between w-full max-w-4xl">` block (around line 146). Wrap both the controls row and the new error banner in a single column container. Replace:

```tsx
        {/* Controls Row */}
        <div className="flex items-center justify-between w-full max-w-4xl">
```

With:
```tsx
        {/* Controls Row + inline error */}
        <div className="flex flex-col w-full max-w-4xl gap-3">
        <div className="flex items-center justify-between">
```

Then close the inner div before the outer div closes (add `</div>` before the existing closing `</div>` of the controls row). Then append the error banner right after:

```tsx
          {sessionError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 16px",
                borderRadius: 10,
                background: "#F0444414",
                border: "1px solid #F0444440",
              }}
            >
              <span style={{ color: "#F04444", fontWeight: 700, fontSize: 13 }}>✕</span>
              <span style={{ color: "rgb(255,153,153)", fontSize: 13 }}>
                {sessionError}
              </span>
            </div>
          )}
        </div>
```

The full controls section after edits should look like:

```tsx
        {/* Controls Row + inline error */}
        <div className="flex flex-col w-full max-w-4xl gap-3">
          <div className="flex items-center justify-between">
            {/* Eval Provider */}
            <div>
              {/* ... provider buttons unchanged ... */}
            </div>

            {/* Start Button */}
            <button
              onClick={handleStart}
              disabled={loading}
              className="px-10 py-4 rounded-xl font-semibold text-base text-white transition-opacity disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--color-primary)", borderRadius: 12 }}
            >
              {loading ? "建立中..." : "開始面試"}
            </button>
          </div>

          {sessionError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 16px",
                borderRadius: 10,
                background: "#F0444414",
                border: "1px solid #F0444440",
              }}
            >
              <span style={{ color: "#F04444", fontWeight: 700, fontSize: 13 }}>✕</span>
              <span style={{ color: "rgb(255,153,153)", fontSize: 13 }}>
                {sessionError}
              </span>
            </div>
          )}
        </div>
```

- [ ] **Step 5: Verify TypeScript compiles and lint passes**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20 && npm run lint 2>&1 | tail -10
```

Expected: no errors, lint clean

- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(errors): replace alert() with inline error banner on home page"
```

---

## Task 6: Smoke test

- [ ] **Step 1: Start dev server**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: Test inline error (home page)**

Open `http://localhost:3000`. Stop the backend if running (`docker compose stop backend`). Click "開始面試". Verify: red inline banner appears below the start button with "無法連線到後端伺服器" message. No `alert()` dialog. Start button becomes clickable again after error.

- [ ] **Step 3: Test ErrorOverlay (interview page)**

Navigate to `/interview?session_id=00000000-0000-0000-0000-000000000000&mode=single&provider=openai`. Grant mic permission. Verify: after connection attempt fails, `ErrorOverlay` appears with correct title/message, "重試" and "返回首頁" buttons functional.

- [ ] **Step 4: Verify lint and build**

```bash
cd frontend && npm run lint && npm run build 2>&1 | tail -20
```

Expected: lint clean, build succeeds with no TypeScript errors.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix(errors): smoke test corrections"
```
