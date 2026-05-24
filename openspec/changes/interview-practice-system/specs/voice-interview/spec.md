## ADDED Requirements

### Requirement: Ephemeral token generation
The system SHALL generate an OpenAI Realtime ephemeral client secret via POST /realtime/client-secret, using the server-side OpenAI API key, so the frontend never holds a standard API key.

#### Scenario: Token issued successfully
- **WHEN** frontend calls POST /realtime/client-secret with a valid session_id and Bearer token
- **THEN** the system returns a client_secret and expires_at timestamp

#### Scenario: Reject unauthenticated request
- **WHEN** the request is missing or has an invalid Bearer token
- **THEN** the system SHALL return HTTP 401

### Requirement: WebRTC voice session
The system SHALL support browser-based WebRTC connection to OpenAI Realtime API using the ephemeral token, enabling bidirectional audio between user and AI interviewer.

#### Scenario: WebRTC connection established
- **WHEN** frontend uses the ephemeral token to connect via WebRTC
- **THEN** the connection to OpenAI Realtime API is established and audio flows bidirectionally

#### Scenario: AI speaks the question
- **WHEN** the Realtime session starts and get_next_question tool call completes
- **THEN** the AI interviewer reads the question aloud in Traditional Chinese

#### Scenario: User can barge in
- **WHEN** user speaks while AI is talking
- **THEN** AI stops and listens to the user

### Requirement: Realtime transcript sync
The system SHALL receive transcript events from the frontend and persist turn-level transcripts to the database.

#### Scenario: Transcript saved
- **WHEN** frontend sends the final_transcript via POST /attempts
- **THEN** the transcript is stored in the attempts table

### Requirement: AI tool calling
The Realtime agent SHALL use tool calls to interact with the backend: get_next_question, mark_answer_completed, get_evaluation_summary.

#### Scenario: get_next_question tool call
- **WHEN** AI calls get_next_question with session_id and mode
- **THEN** backend returns next question selected by SM-2

#### Scenario: mark_answer_completed tool call
- **WHEN** user says "回答完畢" or equivalent and AI calls mark_answer_completed
- **THEN** backend creates an attempt record and triggers async evaluation

#### Scenario: get_evaluation_summary tool call
- **WHEN** AI calls get_evaluation_summary with attempt_id after polling completes
- **THEN** backend returns score, summary, missing_points, next_focus

### Requirement: AI interviewer persona
The Realtime agent SHALL behave as a Senior Backend Engineer interviewer using Traditional Chinese, asking one question at a time, not revealing reference answers, and providing only directional hints when requested.

#### Scenario: One question at a time
- **WHEN** a session starts or a new question is selected
- **THEN** AI asks exactly one question and waits for the user to answer

#### Scenario: Hint on request only
- **WHEN** user explicitly asks for a hint
- **THEN** AI provides a directional hint without revealing the full answer

#### Scenario: Follow-up question
- **WHEN** user's answer is too brief
- **THEN** AI may ask at most one follow-up question
