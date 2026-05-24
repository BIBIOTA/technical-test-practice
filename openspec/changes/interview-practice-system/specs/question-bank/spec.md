## ADDED Requirements

### Requirement: Question storage
The system SHALL store interview questions in PostgreSQL with fields: id (UUID), notion_id (TEXT UNIQUE NULLABLE), text (TEXT), category (TEXT), difficulty (easy|medium|hard), reference_answer (TEXT), tags (TEXT[]), created_at, updated_at.

#### Scenario: Import question from Notion
- **WHEN** Claude Code inserts a question with a notion_id
- **THEN** the question is persisted and retrievable by id and notion_id

#### Scenario: Prevent duplicate Notion import
- **WHEN** Claude Code attempts to insert a question with an already-existing notion_id
- **THEN** the system SHALL reject the insert with a unique constraint violation

#### Scenario: Import question without Notion ID
- **WHEN** a question is inserted without a notion_id
- **THEN** the question is persisted with notion_id = NULL

### Requirement: Question categorization
The system SHALL support filtering questions by category (free-text) and difficulty (easy|medium|hard) and tags (TEXT array).

#### Scenario: Filter by category
- **WHEN** a query specifies category = "system-design"
- **THEN** only questions with that category are returned

#### Scenario: Filter by difficulty
- **WHEN** a query specifies difficulty = "hard"
- **THEN** only hard questions are returned

#### Scenario: Filter by multiple criteria
- **WHEN** a query specifies both category and difficulty
- **THEN** only questions matching both criteria are returned

### Requirement: Question retrieval for selection
The system SHALL expose GET /questions/next that returns the next question selected by the SM-2 algorithm, accepting optional category, difficulty, mode, and session_id parameters.

#### Scenario: Next question returned
- **WHEN** GET /questions/next is called with a valid session_id
- **THEN** a question object is returned with question_id, question_text, category, difficulty

#### Scenario: No available question
- **WHEN** no questions match the filter criteria
- **THEN** the system SHALL return HTTP 404
