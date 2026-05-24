## ADDED Requirements

### Requirement: Session lifecycle management
The system SHALL manage interview sessions with statuses: active, completed, aborted. Sessions are created via POST /sessions and closed via POST /sessions/{id}/complete.

#### Scenario: Session created
- **WHEN** POST /sessions is called with mode and eval_provider
- **THEN** a session is created with status = active and started_at = NOW()

#### Scenario: Session completed
- **WHEN** POST /sessions/{id}/complete is called
- **THEN** session status = completed and completed_at = NOW()

#### Scenario: Duplicate complete ignored
- **WHEN** POST /sessions/{id}/complete is called on an already-completed session
- **THEN** system SHALL return HTTP 200 with the existing session state (idempotent)

### Requirement: Single question mode
In single mode the system SHALL ask one question, evaluate it, deliver voice feedback, and then end the session.

#### Scenario: Single mode flow
- **WHEN** session mode = single and the question is answered
- **THEN** evaluation runs, AI delivers voice summary, session ends

### Requirement: Mock interview mode
In mock mode the system SHALL ask multiple questions ordered by SM-2 priority, allow one follow-up per question, and produce a session summary report after all questions are answered or the user ends the session.

#### Scenario: Multi-question flow
- **WHEN** session mode = mock
- **THEN** AI asks successive questions via get_next_question tool calls until user ends session

#### Scenario: Session summary generated
- **WHEN** GET /sessions/{id}/summary is called after session is completed
- **THEN** response includes total_questions, average_score, and per-attempt breakdown

### Requirement: Weak review mode
In weak_review mode the system SHALL only select questions where next_review_at ≤ NOW() AND last_score < 60, prioritizing lowest scores first.

#### Scenario: Only weak questions selected
- **WHEN** session mode = weak_review
- **THEN** GET /questions/next only returns questions that are due and have last_score < 60

#### Scenario: No weak questions available
- **WHEN** all questions have last_score ≥ 60 or none are due
- **THEN** GET /questions/next returns HTTP 404 and AI informs user there are no weak questions today

### Requirement: Bearer token authentication
All API endpoints SHALL require Authorization: Bearer <INTERVIEW_TOKEN> header. The token is a static secret set in the server environment variable INTERVIEW_TOKEN.

#### Scenario: Valid token accepted
- **WHEN** request includes correct Bearer token
- **THEN** request proceeds normally

#### Scenario: Missing or invalid token rejected
- **WHEN** request is missing Authorization header or token is wrong
- **THEN** system SHALL return HTTP 401
