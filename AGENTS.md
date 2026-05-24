# Repository Guidelines

## Project Structure

- `backend/`: FastAPI backend, SQLAlchemy models, Alembic migrations, routers, and services.
- `frontend/`: Next.js frontend app.
- `e2e/api/`: pytest-based API end-to-end tests.
- `e2e/playwright/`: Playwright UI end-to-end tests.
- `openspec/`: OpenSpec change artifacts and project workflow notes.
- `docker-compose.yml`: Local development services.
- `docker-compose.test.yml`: Test environment services.

## Development Commands

- Start test stack: `make test-env-up`
- Stop test stack and remove volumes: `make test-env-down`
- Run all e2e tests: `make test`
- Run API e2e tests only: `make test-api`
- Run UI e2e tests only: `make test-ui`
- Frontend dev server: `cd frontend && npm run dev`
- Frontend lint: `cd frontend && npm run lint`
- Frontend build: `cd frontend && npm run build`

## Backend Notes

- Python baseline is `>=3.12`.
- Backend package metadata lives in `backend/pyproject.toml`.
- Keep FastAPI route handlers in `backend/app/routers/`.
- Keep business logic in `backend/app/services/`.
- Keep SQLAlchemy models in `backend/app/models/`.
- Add database schema changes through Alembic migrations in `backend/alembic/versions/`.

## Frontend Notes

- Frontend uses Next.js, React, TypeScript, and Tailwind CSS.
- App routes live under `frontend/app/`.
- Prefer existing styling conventions in `frontend/app/globals.css` before adding new patterns.
- Validate UI changes with `npm run lint` and, when relevant, `npm run build`.

## Testing Guidelines

- Use the Makefile targets for end-to-end verification.
- `make test` starts the test environment, waits for backend health at `http://localhost:8001/health`, then runs API and UI tests.
- For narrower changes, run the smallest relevant test target first, then broaden if the change touches shared behavior.

## Configuration

- Do not commit real secrets from `.env`, `.env.test`, or local shell history.
- Use `.env.example` as the reference for documented environment variables.
- Keep test-only configuration isolated from local development configuration.

## Agent Workflow

- Read relevant files before changing behavior.
- Keep edits scoped to the requested change.
- Do not revert user changes or unrelated work in a dirty tree.
- Prefer `rg`/`rg --files` for searching.
- Use project Makefile and package scripts rather than ad hoc commands when available.
