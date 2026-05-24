# E2E Test Design — Interview Practice System

**Date:** 2026-05-24  
**Scope:** End-to-end tests covering frontend UI flows (Playwright) and backend API endpoints (pytest)

---

## 1. Overall Architecture

### Tools

| Layer | Tool | Language |
|---|---|---|
| Frontend UI | Playwright | TypeScript |
| Backend API | pytest + httpx | Python |

### Execution Model

- `docker-compose.test.yml` brings up postgres + backend + frontend with isolated test configuration
- pytest and Playwright run from the **host machine** against `localhost` ports
- This avoids the complexity of running browsers inside Docker containers

### Directory Structure

```
e2e/
  playwright/
    tests/
      home.spec.ts        # Home page UI flows
      interview.spec.ts   # Interview room UI flows
    playwright.config.ts
    package.json
  api/
    tests/
      conftest.py         # httpx client + auth token fixtures
      test_health.py
      test_sessions.py
      test_questions.py
      test_attempts.py
    pyproject.toml
docker-compose.test.yml
.env.test
Makefile
```

### Makefile Commands

```makefile
test-env-up:
    docker-compose -f docker-compose.test.yml up -d

test-env-down:
    docker-compose -f docker-compose.test.yml down -v

test-api:
    cd e2e/api && pytest

test-ui:
    cd e2e/playwright && npx playwright test

test:
    make test-env-up && make test-api && make test-ui && make test-env-down
```

---

## 2. Backend API Tests (pytest)

### Fixtures (`conftest.py`)

- `client` — httpx `AsyncClient` with `Authorization: Bearer test-token` header
- `anon_client` — httpx `AsyncClient` without token (for 401 tests)
- `session_id` — fixture that creates a session via `POST /sessions` and returns its UUID

### Test Cases

#### `test_health.py`

| Case | Expected |
|---|---|
| `GET /health` | 200 `{"status": "ok"}` |

#### `test_sessions.py`

| Case | Expected |
|---|---|
| `POST /sessions` with valid token | 201, body contains `session_id`, `mode`, `status` |
| `POST /sessions` with no token | 401 |
| `POST /sessions` with invalid token | 401 |
| `POST /sessions/{id}/complete` | 200, `status: "completed"` |
| `POST /sessions/{non-existent}/complete` | 404 |
| `GET /sessions/{id}/summary` | 200, contains `total_questions`, `average_score`, `attempts` |
| `GET /sessions/{non-existent}/summary` | 404 |

#### `test_questions.py`

| Case | Expected |
|---|---|
| `GET /questions/next` | 200, contains `question_id`, `question_text`, `category`, `difficulty`, `sm2` |
| `GET /questions/next?mode=single` | 200 |
| `GET /questions/next?category=...&difficulty=...` | 200 |

#### `test_attempts.py`

| Case | Expected |
|---|---|
| `POST /attempts` with valid session + question | 202, body contains `attempt_id`, `status: "pending_evaluation"` |
| `GET /attempts/{id}/result` (pending) | 200, `status` field present |
| `GET /attempts/{non-existent}/result` | 404 |

### Notes

- `POST /attempts` triggers background evaluation (calls AI provider). In the test environment, evaluation will fail due to placeholder API keys — but the attempt record is still created and the 202 response is returned. Tests only verify the 202 and the `attempt_id` field; they do not wait for evaluation to complete.
- `POST /realtime/client-secret` requires a live OpenAI connection and is **excluded** from testing.

---

## 3. Frontend UI Tests (Playwright)

### Mock Strategy

All backend calls are intercepted using `page.route('http://localhost:8001/**', ...)` to inject fake responses. This lets UI flows run fully without depending on real backend state.

WebSocket connections (for realtime voice) are not tested; `page.route('/realtime/*', ...)` returns a fake `client_secret` to prevent connection errors.

### `home.spec.ts`

| Case | Verification |
|---|---|
| Page load | 3 mode cards visible, page title correct |
| Mode selection | Click "模擬面試" → that card gets active border style |
| Provider selection | Click "Claude" → Claude button becomes active |
| Start session (success) | Mock `POST /sessions` → navigates to `/interview?session_id=...` |
| Start session (API failure) | Mock `POST /sessions` → 500 → alert appears |

### `interview.spec.ts`

| Case | Verification |
|---|---|
| Initial overlay | On page load → mic permission overlay is visible |
| Mic denied | Mock `getUserMedia` throws error → "麥克風存取被拒" overlay shown |
| Back button | After mic denied → click back → redirected to home |
| Tab switching | Click "評分結果" tab → tab content switches |
| End session | Mock `completeSession` → redirected to home |

---

## 4. Docker Compose Test Environment

### `docker-compose.test.yml`

- Uses separate ports to avoid conflicts with the dev environment:
  - postgres: `5433:5432`
  - backend: `8001:8000`
  - frontend: `3001:3000`
- Backend is configured with `INTERVIEW_TOKEN=test-token`
- Database name: `interview_practice_test`

### `.env.test`

```
OPENAI_API_KEY=test-placeholder
ANTHROPIC_API_KEY=test-placeholder
GOOGLE_API_KEY=test-placeholder
INTERVIEW_TOKEN=test-token
```

Playwright config points to `http://localhost:3001`.  
pytest fixtures point to `http://localhost:8001`.

---

## 5. Out of Scope

- Voice/WebSocket realtime flow (mocked at the network level, not functionally tested)
- AI evaluation result correctness (depends on external AI providers)
- `POST /realtime/client-secret` (requires live OpenAI connection)
- Performance and load testing
