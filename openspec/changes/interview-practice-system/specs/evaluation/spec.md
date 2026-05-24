## ADDED Requirements

### Requirement: Multi-provider evaluation abstraction
The system SHALL implement an EvaluationProvider abstract base class with concrete implementations for OpenAI, Claude, and Gemini. The active provider is determined by the eval_provider field on the interview_session.

#### Scenario: Claude provider selected
- **WHEN** interview_session.eval_provider = "claude"
- **THEN** evaluation is performed using the Anthropic SDK

#### Scenario: OpenAI provider selected
- **WHEN** interview_session.eval_provider = "openai"
- **THEN** evaluation is performed using the OpenAI SDK

#### Scenario: Gemini provider selected
- **WHEN** interview_session.eval_provider = "gemini"
- **THEN** evaluation is performed using the Google AI SDK

### Requirement: Async evaluation execution
The system SHALL trigger evaluation as a FastAPI BackgroundTask when POST /attempts is called, so the HTTP response returns immediately with status pending_evaluation.

#### Scenario: Evaluation triggered asynchronously
- **WHEN** POST /attempts is called with a valid transcript
- **THEN** the system returns HTTP 202 with attempt_id and status = pending_evaluation, and begins evaluation in the background

#### Scenario: Evaluation completes
- **WHEN** the background evaluation task finishes
- **THEN** the attempt record is updated with status = completed, score, and evaluation JSONB

#### Scenario: Evaluation fails
- **WHEN** the LLM provider returns an error
- **THEN** the attempt record is updated with status = failed

### Requirement: Fixed evaluation output schema
The evaluation result SHALL conform to a fixed JSON schema: score (0-100 INT), summary (STRING), missing_points (STRING[]), next_focus (STRING[]), provider (STRING), model (STRING).

#### Scenario: Schema validated on write
- **WHEN** evaluation result is written to the attempts.evaluation JSONB column
- **THEN** all required fields are present and score is between 0 and 100

### Requirement: Evaluation polling endpoint
The system SHALL expose GET /attempts/{attempt_id}/result that returns the current attempt status and evaluation result if completed.

#### Scenario: Pending state returned
- **WHEN** evaluation is still running and client polls GET /attempts/{id}/result
- **THEN** response contains status = pending_evaluation

#### Scenario: Completed state returned
- **WHEN** evaluation has finished and client polls
- **THEN** response contains status = completed with full evaluation object

### Requirement: Evaluation summary endpoint
The system SHALL expose GET /attempts/{attempt_id}/summary returning score, summary, missing_points, next_focus for use by the AI tool call get_evaluation_summary.

#### Scenario: Summary available
- **WHEN** attempt status = completed and GET /attempts/{id}/summary is called
- **THEN** summary fields are returned without provider/model metadata

#### Scenario: Summary not yet available
- **WHEN** attempt status = pending_evaluation
- **THEN** system SHALL return HTTP 404
