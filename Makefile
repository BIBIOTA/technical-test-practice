.PHONY: test-env-up test-env-down test-api test-ui test

test-env-up:
	docker-compose -f docker-compose.test.yml up -d --build

test-env-down:
	docker-compose -f docker-compose.test.yml down -v

test-api:
	cd e2e/api && pip install -e . && pytest -v

test-ui:
	cd e2e/playwright && npm install && npx playwright install chromium && npx playwright test

test: test-env-up test-api test-ui
