.DEFAULT_GOAL := help
SHELL := /bin/bash

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n",$$1,$$2}'

install: ## Install backend deps (npm ci)
	cd backend && npm ci

build: ## Compile the backend (nest build -> dist/)
	cd backend && npm run build

up: ## Start db + migrate + api locally (Docker)
	docker compose up --build

down: ## Stop the stack
	docker compose down

reset: ## Stop the stack and wipe the database volume
	docker compose down -v

test: ## Run integration tests (needs TEST_DATABASE_URL, or use `make up` first)
	cd backend && TEST_DATABASE_URL=$${TEST_DATABASE_URL:-postgres://kwa_app:kwa_app@localhost:5432/kwa_test} npm test

token: ## Mint a dev JWT (EE Menon); override sub: make token SUB=<uuid>
	@node backend/scripts/make-token.js $(SUB)

seed: ## Seed SOR + routes from a manifest: make seed MANIFEST=path DATABASE_URL=...
	node backend/scripts/seed/seed.js $${MANIFEST:-backend/scripts/seed/samples/manifest.json}

image: ## Build the API image: make image TAG=<registry>/kwa-backend:<tag>
	docker build -t $${TAG:-kwa-backend:latest} backend

migrate: ## Apply migrations to $$DATABASE_URL (skips the demo seed)
	@for f in migrations/001_schema.sql migrations/002_rls.sql migrations/004_chainage.sql migrations/005_auth_dpr_gps.sql; do \
	  echo "applying $$f"; psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$$f"; \
	done

.PHONY: help install build up down reset test token seed image migrate
