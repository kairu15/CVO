# =============================================================================
# CVO — developer shortcuts
#
#   make up        start the dev stack (db + API + frontend)
#   make help      list every target
#
# Assumes a .env exists in the repo root: `cp .env.example .env`.
# =============================================================================

COMPOSE       := docker compose
PROD_COMPOSE  := docker compose --env-file .env.production -f docker-compose.prod.yml
BACKEND       := $(COMPOSE) exec backend
DB            := $(COMPOSE) exec db

.DEFAULT_GOAL := help
.PHONY: help up down build rebuild restart logs logs-backend logs-frontend ps \
        migrate seed fresh test test-frontend lint key vendor config \
        shell-backend shell-frontend shell-db \
        prod-up prod-down prod-build prod-logs prod-ps

# -----------------------------------------------------------------------------
# Help
# -----------------------------------------------------------------------------
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# -----------------------------------------------------------------------------
# Development lifecycle
# -----------------------------------------------------------------------------
up: ## Build and start the dev stack in the background
	$(COMPOSE) up --build -d

down: ## Stop the dev stack (keeps volumes/data)
	$(COMPOSE) down

build: ## Build the dev images
	$(COMPOSE) build

rebuild: ## Rebuild the dev images without cache and restart
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d

restart: ## Restart the dev stack
	$(COMPOSE) restart

ps: ## Show dev container status + health
	$(COMPOSE) ps

logs: ## Tail logs from every dev service
	$(COMPOSE) logs -f --tail=100

logs-backend: ## Tail the API logs
	$(COMPOSE) logs -f --tail=100 backend

logs-frontend: ## Tail the frontend logs
	$(COMPOSE) logs -f --tail=100 frontend

# -----------------------------------------------------------------------------
# Database / Laravel
# -----------------------------------------------------------------------------
migrate: ## Run migrations inside the API container
	$(BACKEND) php artisan migrate --force

seed: ## Seed the demo data (idempotent)
	$(BACKEND) php artisan db:seed --force

fresh: ## Drop every table, re-migrate and re-seed
	$(BACKEND) php artisan migrate:fresh --seed --force

key: ## Generate an APP_KEY and print it (paste into .env / .env.production)
	$(BACKEND) php artisan key:generate --show

# -----------------------------------------------------------------------------
# Quality
# -----------------------------------------------------------------------------
test: ## Run the backend test suite (sqlite in-memory, does not touch MySQL)
	$(BACKEND) php artisan test

test-frontend: ## Run the frontend unit tests
	$(COMPOSE) exec frontend npm test

lint: ## Run the backend formatter check (Pint)
	$(BACKEND) vendor/bin/pint --test

# -----------------------------------------------------------------------------
# Maintenance
# -----------------------------------------------------------------------------
vendor: ## Re-install composer dependencies inside the container (after composer.json changes)
	$(BACKEND) composer install

config: ## Validate and print the resolved dev compose config
	$(COMPOSE) config

shell-backend: ## Open a shell in the API container
	$(BACKEND) sh

shell-frontend: ## Open a shell in the frontend container
	$(COMPOSE) exec frontend sh

shell-db: ## Open a mysql shell in the database container
	$(DB) sh -lc 'mysql -u"$$MYSQL_USER" -p"$$MYSQL_PASSWORD" "$$MYSQL_DATABASE"'

# -----------------------------------------------------------------------------
# Production
# -----------------------------------------------------------------------------
prod-up: ## Build and start the production stack
	$(PROD_COMPOSE) up -d --build

prod-down: ## Stop the production stack
	$(PROD_COMPOSE) down

prod-build: ## Build the production images
	$(PROD_COMPOSE) build

prod-logs: ## Tail production logs
	$(PROD_COMPOSE) logs -f --tail=100

prod-ps: ## Show production container status + health
	$(PROD_COMPOSE) ps
