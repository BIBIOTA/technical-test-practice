## ADDED Requirements

### Requirement: Structured API error type
The frontend SHALL use a typed `ApiError` class (carrying HTTP `status`, `code`, and `message`) rather than a generic `Error` when any API call fails with a non-2xx response.

#### Scenario: API returns non-2xx status
- **WHEN** `apiFetch` receives a response where `res.ok === false`
- **THEN** it SHALL throw `ApiError` with `status` set to the HTTP status code and `code` set to `HTTP_<status>`

#### Scenario: Network connectivity failure
- **WHEN** `fetch` itself throws a `TypeError` (e.g., backend unreachable)
- **THEN** the `TypeError` SHALL propagate unchanged so callers can distinguish network failures from HTTP errors

---

### Requirement: HTTP-status-specific error messages
The system SHALL surface actionable Traditional Chinese error messages mapped to specific HTTP status codes.

#### Scenario: 429 quota exceeded
- **WHEN** `parseConnectionError` receives an `ApiError` with `status === 429`
- **THEN** it SHALL return `{ title: "連線發生錯誤", message: "API 使用額度不足，請前往 OpenAI 平台充值後再試。" }`

#### Scenario: 404 model not found
- **WHEN** `parseConnectionError` receives an `ApiError` with `status === 404`
- **THEN** it SHALL return `{ title: "連線發生錯誤", message: "指定的 AI 模型不存在，請聯絡管理員。" }`

#### Scenario: 401 or 403 auth failure
- **WHEN** `parseConnectionError` receives an `ApiError` with `status === 401` or `status === 403`
- **THEN** it SHALL return `{ title: "連線發生錯誤", message: "認證失敗，請確認 API 金鑰設定正確。" }`

#### Scenario: 5xx server error
- **WHEN** `parseConnectionError` receives an `ApiError` with `status >= 500`
- **THEN** it SHALL return `{ title: "連線發生錯誤", message: "伺服器發生錯誤（<status>），請稍後再試。" }` with the actual status interpolated

#### Scenario: Network error (TypeError)
- **WHEN** `parseConnectionError` receives a `TypeError`
- **THEN** it SHALL return `{ title: "無法連線到伺服器", message: "無法連線到後端伺服器，請確認伺服器已啟動後重試。" }`

#### Scenario: Unknown error
- **WHEN** `parseConnectionError` receives any other error type
- **THEN** it SHALL return `{ title: "發生未知錯誤", message: "發生未預期的錯誤，請重新整理頁面。" }`

---

### Requirement: Fatal error overlay on interview page
The interview page SHALL display a full-screen `ErrorOverlay` when the initial WebRTC connection attempt fails, blocking further interaction until the user retries or navigates away.

#### Scenario: Connection failure shown as overlay
- **WHEN** `RealtimeClient.connect()` throws during interview initialisation
- **THEN** the interview page SHALL render `ErrorOverlay` over all content with the title/message from `parseConnectionError` and two action buttons: "返回首頁" and "重試"

#### Scenario: Retry clears overlay and reconnects
- **WHEN** user clicks "重試" on the `ErrorOverlay`
- **THEN** the overlay SHALL be dismissed and `startSession()` SHALL be called again

#### Scenario: Go home navigates away
- **WHEN** user clicks "返回首頁" on the `ErrorOverlay`
- **THEN** the app SHALL navigate to `/`

#### Scenario: Icon colour reflects error type
- **WHEN** the error originates from a `TypeError` (network failure)
- **THEN** the overlay icon SHALL be amber (`#F59E0B`)
- **WHEN** the error originates from an `ApiError`
- **THEN** the overlay icon SHALL be red (`#F04444`)

---

### Requirement: Toast notification for non-fatal interview errors
The interview page SHALL display a top-right Toast notification for transient API errors that occur mid-interview (e.g., failed tool calls), without interrupting the interview flow.

#### Scenario: Toast appears on mid-interview error
- **WHEN** `RealtimeClient.onError` fires during an active interview session
- **THEN** a Toast SHALL appear at `position: fixed; top: 24px; right: 24px` showing the parsed title and message

#### Scenario: Toast auto-dismisses after 8 seconds
- **WHEN** a Toast is shown
- **THEN** it SHALL automatically disappear after 8 000 ms if not manually closed

#### Scenario: Toast can be manually closed
- **WHEN** user clicks the × button on the Toast
- **THEN** the Toast SHALL be immediately dismissed

#### Scenario: Toast severity colour
- **WHEN** the error is classified as `"error"` severity
- **THEN** the Toast left bar and icon SHALL be red (`#F04444`)
- **WHEN** the error is classified as `"warning"` severity
- **THEN** the Toast left bar and icon SHALL be amber (`#F59E0B`)

---

### Requirement: Inline error banner on home page
The home page SHALL display an inline error banner below the controls row when session creation fails, replacing the native `alert()` dialog.

#### Scenario: Inline banner shown on session creation failure
- **WHEN** `createSession` throws after the user clicks "開始面試"
- **THEN** an inline banner SHALL appear directly below the controls row displaying the message from `parseConnectionError`

#### Scenario: Banner cleared on next attempt
- **WHEN** user clicks "開始面試" again after a previous error
- **THEN** the inline banner SHALL be cleared before the new attempt begins

#### Scenario: No alert() dialog
- **WHEN** any session creation error occurs
- **THEN** the native `alert()` dialog SHALL NOT be used
