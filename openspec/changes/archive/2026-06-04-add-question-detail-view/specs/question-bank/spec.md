## ADDED Requirements

### Requirement: Question detail retrieval API
The system SHALL expose `GET /questions/{question_id}` returning the full stored question payload, including `question_id`, `question_text`, `category`, `difficulty`, `tags`, `reference_answer`, `key_points`, and `common_mistakes`. The endpoint SHALL require a valid auth token (Bearer) via the existing `verify_token` dependency and SHALL NOT modify any database state.

#### Scenario: Existing question returned
- **WHEN** `GET /questions/{id}` is called with a valid auth token and an existing question UUID
- **THEN** the system returns HTTP 200 with a JSON payload containing `question_id`, `question_text`, `category`, `difficulty`, `tags`, `reference_answer`, `key_points`, `common_mistakes`
- **AND** no rows in `attempts`, `sm2_states`, or `interview_sessions` are modified

> See: ../../design.md
> See: ../../tasks.md

#### Scenario: Nonexistent question
- **WHEN** `GET /questions/{id}` is called with a syntactically valid UUID that does not exist in the database
- **THEN** the system returns HTTP 404 with body `{"detail": "Question not found"}`

#### Scenario: Malformed question id
- **WHEN** `GET /questions/{id}` is called with a path parameter that is not a valid UUID
- **THEN** the system returns HTTP 422 (FastAPI path validation)

#### Scenario: Unauthorized request
- **WHEN** `GET /questions/{id}` is called without an auth token or with an invalid token
- **THEN** the system returns HTTP 401 and does NOT execute the database query

### Requirement: Question detail page entry point
The system SHALL provide a "查看內容" entry point on each question card in the selection list (`/questions/select`) that navigates the user to the question detail page, preserving the active evaluation provider via query string.

#### Scenario: Entry from selection list preserves provider
- **WHEN** the user clicks "查看內容" on a question card in `/questions/select?provider=${provider}`
- **THEN** the browser navigates to `/questions/${question_id}?provider=${provider}`
- **AND** the existing "選擇練習" CTA on the same card remains the primary visual action (the "查看內容" button uses a secondary/outline style)

### Requirement: Question detail page presentation
The system SHALL render a question detail page at `/questions/[id]` that displays the question content fetched from the detail API in four content regions: (a) question text together with category/difficulty/tags chips, (b) reference answer, (c) key_points, (d) common_mistakes. Empty `key_points` or `common_mistakes` arrays SHALL render an explicit empty-state message instead of being hidden, so the page layout remains stable.

#### Scenario: All four regions render
- **WHEN** the detail page mounts with a valid question id and the API returns a populated payload
- **THEN** the page renders the question text with category/difficulty/tags chips (reusing the color logic from `/questions/select`), the reference answer as readable text, the `key_points` list, and the `common_mistakes` list

#### Scenario: Empty key_points renders fallback
- **WHEN** the detail API returns `key_points: []`
- **THEN** the key_points section displays "（尚無評分要點）" in a muted gray style

#### Scenario: Empty common_mistakes renders fallback
- **WHEN** the detail API returns `common_mistakes: []`
- **THEN** the common_mistakes section displays "（尚無常見錯誤紀錄）" in a muted gray style

#### Scenario: Network failure shows retry
- **WHEN** the detail page fetch fails with a network error (`TypeError`)
- **THEN** the page shows an error card with the message "無法連線到後端伺服器，請確認伺服器已啟動後重試。" and a "重試" button that re-issues the fetch

#### Scenario: Question not found shows empty state
- **WHEN** the detail page fetch receives HTTP 404
- **THEN** the page shows an empty-state card with the message "找不到這題，可能已被移除。" and a "返回選題" button that navigates to `/questions/select?provider=${provider}`

#### Scenario: Other fetch errors show generic retry
- **WHEN** the detail page fetch receives a non-404 4xx or 5xx response
- **THEN** the page shows an error card with the message "無法載入題目內容，請稍後再試。" and a "重試" button

### Requirement: Start practice from detail page
The detail page SHALL provide a "開始練習這題" action that creates a single-mode session and navigates the user to the existing interview page with the same parameters used by the selection list, so that SM-2 scheduling and attempt scoring behavior remain identical regardless of entry point.

#### Scenario: Start practice creates session and navigates
- **WHEN** the user clicks "開始練習這題" on `/questions/{id}?provider=${provider}`
- **THEN** the system calls `createSession('single', provider)` and, upon success, navigates to `/interview?session_id=${sid}&mode=single&provider=${provider}&question_id=${id}`

#### Scenario: createSession failure shows inline error
- **WHEN** `createSession` fails (network error or non-2xx response)
- **THEN** the page shows the inline error message "建立練習失敗，請稍後再試。" and the "開始練習這題" button becomes clickable again

### Requirement: Return to selection from detail page
The detail page SHALL provide a "返回選題" action that navigates the user back to the selection list, preserving the active provider via query string so the list page reopens in the same state.

#### Scenario: Return preserves provider
- **WHEN** the user clicks "返回選題" on `/questions/{id}?provider=${provider}`
- **THEN** the browser navigates to `/questions/select?provider=${provider}`
