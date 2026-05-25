## 1. Error Utilities

- [ ] 1.1 Create `frontend/lib/errors.ts` with `ApiError` class (status, code, message fields)
- [ ] 1.2 Add `parseConnectionError()` to `lib/errors.ts` covering 429 / 404 / 401+403 / 5xx / TypeError / unknown cases
- [ ] 1.3 Update `apiFetch` in `frontend/lib/api.ts` to import `ApiError` and throw it instead of generic `Error`
- [ ] 1.4 Verify TypeScript compiles with no errors (`npx tsc --noEmit`)

## 2. ErrorOverlay Component

- [ ] 2.1 Create `frontend/components/ErrorOverlay.tsx` with props: `title`, `message`, `isNetwork`, `onRetry`, `onGoHome`
- [ ] 2.2 Implement amber icon (`#F59E0B`) when `isNetwork === true`, red icon (`#F04444`) otherwise — matching Figma frames 1 & 2
- [ ] 2.3 Add status badge, divider, "返回首頁" secondary button, "重試" primary button
- [ ] 2.4 Verify component renders without TypeScript errors

## 3. Interview Page — Fatal Overlay + Toast

- [ ] 3.1 Import `ErrorOverlay` and `parseConnectionError` in `app/interview/page.tsx`
- [ ] 3.2 Add `fatalError` state and update `startSession` catch block to call `setFatalError` via `parseConnectionError`
- [ ] 3.3 Render `<ErrorOverlay>` conditionally; wire "重試" to dismiss overlay and re-call `startSession`, "返回首頁" to `router.push("/")`
- [ ] 3.4 Add `toastError` state with `severity: "warning" | "error"` field
- [ ] 3.5 Replace `onError: console.error` callback with `setToastError` call using `parseConnectionError`
- [ ] 3.6 Add `useEffect` to auto-dismiss toast after 8 000 ms
- [ ] 3.7 Render `Toast` element (`position: fixed; top: 24px; right: 24px`) with left colour bar, icon, title/message, × close button — matching Figma frame 3
- [ ] 3.8 Verify TypeScript compiles with no errors

## 4. Home Page — Inline Error Banner

- [ ] 4.1 Import `parseConnectionError` in `app/page.tsx`
- [ ] 4.2 Add `sessionError: string | null` state
- [ ] 4.3 Replace `alert()` in `handleStart` catch block with `setSessionError(message)` from `parseConnectionError`
- [ ] 4.4 Clear `sessionError` at the start of each `handleStart` call
- [ ] 4.5 Wrap controls row in a column flex container and render inline error banner below it when `sessionError` is set — matching Figma frame 4 (background `#F0444414`, border `1px solid #F0444440`, radius `10px`)
- [ ] 4.6 Verify TypeScript compiles and `npm run lint` passes

## 5. Verification

- [ ] 5.1 Start dev server (`npm run dev`) and confirm home page loads without errors
- [ ] 5.2 With backend stopped: click "開始面試" → verify inline error banner appears, no `alert()` dialog
- [ ] 5.3 Navigate to `/interview` page → grant mic → verify `ErrorOverlay` appears on connection failure with correct title/message and functional buttons
- [ ] 5.4 Confirm `npm run build` succeeds with no TypeScript or lint errors
