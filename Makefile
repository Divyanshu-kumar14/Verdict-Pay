SHELL := /bin/bash
.DEFAULT_GOAL := help
PY := uv run --directory backend
API_PORT ?= 8000
WEB_PORT ?= 3000

.PHONY: help install env api web serve seed stack reset-db test test-backend test-frontend test-sdk test-e2e lint format typecheck check verify verify-live demo e2e docker-build docker-up docker-down clean
E2E_PORT ?= 8199

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install backend + frontend + SDK dependencies
	uv sync --directory backend
	pnpm -C frontend install
	pnpm -C packages/verdictpay-sdk install

api: ## Run FastAPI on :$(API_PORT)
	$(PY) uvicorn app.main:app --host 0.0.0.0 --port $(API_PORT) --reload

web: ## Run Next.js dev server on :$(WEB_PORT) (hot reload)
	pnpm -C frontend dev

# Never run "pnpm build" while "pnpm start" is serving the same .next directory:
# a rebuild swaps the hashed CSS/JS assets and the live server keeps serving HTML
# that points at files which no longer exist, so the page renders unstyled.
# This target builds and starts in one step instead.
serve: ## Build then serve the production UI atomically on :$(WEB_PORT)
	pnpm -C frontend build
	pnpm -C frontend start --port $(WEB_PORT)

env: ## Create .env from the template if it does not exist
	test -f .env || cp .env.example .env
	@echo ".env ready (gitignored)"

seed: ## Seed the demo merchant, history and sample disputes
	$(PY) python scripts/seed_demo.py

reset-db: ## Delete the local SQLite database
	rm -f backend/verdictpay.db backend/verdictpay.db-wal backend/verdictpay.db-shm

test: test-backend test-frontend test-sdk ## Run every offline suite (no server needed)

test-backend: ## Backend unit + integration suite
	$(PY) pytest -q

test-frontend: ## Frontend unit + component suite (vitest, jsdom)
	pnpm -C frontend test --run

test-sdk: ## TypeScript SDK suite (vitest)
	pnpm -C packages/verdictpay-sdk test

test-e2e: ## Frontend HTTP contract + judge-flow suite (needs a running API)
	pnpm -C frontend test:e2e

lint: ## Ruff lint backend, eslint frontend
	$(PY) ruff check app tests scripts
	pnpm -C frontend lint

format: ## Format backend code
	$(PY) ruff format app tests scripts
	$(PY) ruff check --fix app tests scripts

typecheck: ## Typecheck frontend + SDK
	pnpm -C frontend typecheck
	pnpm -C packages/verdictpay-sdk typecheck

check: lint ## Lint + import smoke
	$(PY) python -c "from app.main import create_app; create_app(); print('app import ok')"

verify: ## Full quality gate (run before every demo)
	$(PY) ruff check app tests scripts
	$(PY) pytest -q
	pnpm -C frontend lint
	pnpm -C frontend typecheck
	pnpm -C frontend test --run
	pnpm -C frontend build
	pnpm -C packages/verdictpay-sdk test
	pnpm -C packages/verdictpay-sdk build
	$(PY) python scripts/run_demo.py --port $(E2E_PORT)

verify-live: ## Prove real PayPal sandbox credentials work (forces live mode)
	PAYPAL_MODE=live $(PY) python scripts/verify_paypal_live.py

e2e: ## Run the three-button judge flow against an API you already started
	$(PY) python scripts/e2e_demo.py

demo: ## Verify the full judge flow: seed, boot, assert 26 checks, shut down
	@echo "==> verifying the VerdictPay judge flow on :$(API_PORT) (simulator mode)"
	@$(PY) python scripts/run_demo.py --port $(API_PORT)

stack: ## Seed + boot the API and KEEP it running (then run: make web)
	@echo "==> starting the VerdictPay demo stack on :$(API_PORT)"
	@$(PY) python scripts/run_demo.py --port $(API_PORT) --keep

docker-build: ## Build api + web images
	docker compose build

docker-up: ## Start the full stack
	docker compose up --build

docker-down: ## Stop the stack
	docker compose down -v

clean: ## Remove build artifacts
	rm -rf backend/.venv backend/.pytest_cache backend/.ruff_cache frontend/.next frontend/node_modules packages/verdictpay-sdk/dist
