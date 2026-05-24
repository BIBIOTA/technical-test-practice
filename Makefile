.PHONY: test-env-up test-env-down test-api test-ui test wait-for-backend

test-env-up:
	docker-compose -f docker-compose.test.yml up -d --build

test-env-down:
	docker-compose -f docker-compose.test.yml down -v

wait-for-backend:
	@echo "Waiting for backend to be healthy..."
	@until curl -sf http://localhost:8001/health > /dev/null 2>&1; do sleep 2; done
	@echo "Backend is ready."

test-api:
	cd e2e/api && pip install -e . && pytest -v

test-ui:
	cd e2e/playwright && npm install && npx playwright install chromium && npx playwright test

test: test-env-up wait-for-backend test-api test-ui
