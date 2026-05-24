## ADDED Requirements

### Requirement: SM-2 state per question
The system SHALL maintain one sm2_states record per question with fields: ease_factor (FLOAT, default 2.5), interval_days (INT, default 1), repetitions (INT, default 0), next_review_at (TIMESTAMPTZ, default NOW()), last_score (INT).

#### Scenario: New question gets initial SM-2 state
- **WHEN** a question is selected for the first time and has no sm2_states record
- **THEN** an sm2_states record is auto-created with default values and next_review_at = NOW()

### Requirement: SM-2 update after evaluation
The system SHALL update sm2_states after each completed evaluation using the SuperMemo-2 algorithm.

Score-to-grade mapping: 90-100→5, 75-89→4, 60-74→3, 40-59→2, 20-39→1, 0-19→0.

Update rules:
- grade ≥ 3 (correct): interval = 1 (rep=0), 6 (rep=1), round(interval × ease_factor) (rep>1); repetitions += 1
- grade < 3 (incorrect): interval = 1, repetitions = 0
- ease_factor = max(1.3, ease_factor + 0.1 − (5−grade) × (0.08 + (5−grade) × 0.02))

#### Scenario: Correct answer updates interval
- **WHEN** score = 80 (grade 4) and repetitions = 1
- **THEN** interval_days = 6, repetitions = 2, ease_factor increases slightly

#### Scenario: Incorrect answer resets interval
- **WHEN** score = 30 (grade 1)
- **THEN** interval_days = 1, repetitions = 0

#### Scenario: ease_factor floor enforced
- **WHEN** repeated low scores drive ease_factor below 1.3
- **THEN** ease_factor is clamped to 1.3

### Requirement: SM-2 driven question selection
The system SHALL select the next question using a LEFT JOIN on sm2_states ordered by: (1) questions with no sm2_state (new questions) first, (2) questions where next_review_at ≤ NOW(), (3) next_review_at ASC, (4) last_score ASC NULLS FIRST.

#### Scenario: New question prioritized
- **WHEN** there are questions with no sm2_states record
- **THEN** one of those questions is returned first

#### Scenario: Due question prioritized over non-due
- **WHEN** some questions have next_review_at ≤ NOW() and others do not
- **THEN** a due question is returned

#### Scenario: Lowest score among due questions selected
- **WHEN** multiple questions are due
- **THEN** the question with the lowest last_score is returned first

### Requirement: Session deduplication
The system SHALL not repeat the same question within a single interview session.

#### Scenario: Already-asked question excluded
- **WHEN** question X has already been asked in the current session
- **THEN** GET /questions/next SHALL NOT return question X again in the same session
