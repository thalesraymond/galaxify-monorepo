SERVICES := user-service daily-service ship-service expedition-service
WORKERS := daily-cron expedition-worker
GOOSE := ./goose.sh
OPENAPI_GENERATOR := npx --yes -p typescript@5.6.3 -p @hey-api/openapi-ts@0.99.0 openapi-ts
OPENAPI_GENERATED_DIR := $(CURDIR)/.openapi-generated

.PHONY: test coverage goose-up goose-down sqlc build vet fmt tidy openapi-validate openapi-check openapi-generate dev dev-infra dev-down dev-reset frontend-install frontend-verify help

test: ## Run go test for every service, worker, and pkg
	@for s in $(SERVICES); do \
		echo "==> go test ./... ($$s)"; \
		cd apps/$$s && go test ./...  || exit 1; \
		cd ../..; \
	done
	@for w in $(WORKERS); do \
		echo "==> go test ./... ($$w)"; \
		cd workers/$$w && go test ./... || exit 1; \
		cd ../..; \
	done
	@echo "==> go test ./... (pkg)"
	@cd pkg && go test ./... || exit 1

coverage: ## Run go test -cover for every service and worker
	@for s in $(SERVICES); do \
		echo "==> go test -cover ./... ($$s)"; \
		cd apps/$$s && go test -cover ./... || exit 1; \
		cd ../..; \
	done
	@for w in $(WORKERS); do \
		echo "==> go test -cover ./... ($$w)"; \
		cd workers/$$w && go test -cover ./... || exit 1; \
		cd ../..; \
	done

goose-up: ## Apply database migrations (goose up) for every service
	@for s in $(SERVICES); do \
		echo "==> goose up ($$s)"; \
		cd apps/$$s && ./$(GOOSE) up || exit 1; \
		cd ../..; \
	done

goose-down: ## Roll back one migration (goose down) for every service
	@for s in $(SERVICES); do \
		echo "==> goose down ($$s)"; \
		cd apps/$$s && ./$(GOOSE) down || exit 1; \
		cd ../..; \
	done

sqlc: ## Run sqlc generate for every service
	@for s in $(SERVICES); do \
		echo "==> sqlc generate ($$s)"; \
		cd apps/$$s && sqlc generate || exit 1; \
		cd ../..; \
	done

build: ## Build every service and worker binary into ./bin
	@for s in $(SERVICES); do \
		echo "==> go build ($$s)"; \
		cd apps/$$s && mkdir -p bin && go build -o bin/ . || exit 1; \
		cd ../..; \
	done
	@for w in $(WORKERS); do \
		echo "==> go build ($$w)"; \
		cd workers/$$w && mkdir -p bin && go build -o bin/ . || exit 1; \
		cd ../..; \
	done

vet: ## Run go vet for every service, worker, and pkg
	@for s in $(SERVICES); do \
		echo "==> go vet ./... ($$s)"; \
		cd apps/$$s && go vet ./... || exit 1; \
		cd ../..; \
	done
	@for w in $(WORKERS); do \
		echo "==> go vet ./... ($$w)"; \
		cd workers/$$w && go vet ./... || exit 1; \
		cd ../..; \
	done
	@echo "==> go vet ./... (pkg)"
	@cd pkg && go vet ./... || exit 1

fmt: ## Run gofmt -w on all Go files
	@echo "==> gofmt -w"
	@find . -name '*.go' -not -path './bin/*' -exec gofmt -w {} +

tidy: ## Run go mod tidy for every Go module
	@for s in $(SERVICES); do \
		echo "==> go mod tidy ($$s)"; \
		cd apps/$$s && go mod tidy || exit 1; \
		cd ../..; \
	done
	@for w in $(WORKERS); do \
		echo "==> go mod tidy ($$w)"; \
		cd workers/$$w && go mod tidy || exit 1; \
		cd ../..; \
	done
	@echo "==> go mod tidy (pkg)"
	@cd pkg && go mod tidy || exit 1

openapi-validate: ## Load and validate every OpenAPI 3.1 contract under docs/openapi
	@echo "==> openapi-validate (pkg/httpcontract)"
	@cd pkg && go test ./httpcontract/ -run 'TestOpenAPISpecsValidate|TestOpenAPIPlannedOperationsAreExplicit' -count=1 || exit 1

openapi-check: ## Run OpenAPI conformance/drift tests for pkg and every service
	@echo "==> openapi conformance (pkg)"
	@cd pkg && go test ./httpcontract/ -run TestOpenAPI -count=1 || exit 1
	@for s in $(SERVICES); do \
		echo "==> openapi conformance ($$s)"; \
		cd apps/$$s && go test ./internal/handler/ -run TestOpenAPIConformance -count=1 || exit 1; \
		cd ../..; \
	done

openapi-generate: ## Generate frontend wire types + zod schemas from docs/openapi
	@rm -rf $(OPENAPI_GENERATED_DIR)
	@mkdir -p $(OPENAPI_GENERATED_DIR)
	@for spec in docs/openapi/*-service.yaml; do \
		name=$$(basename $$spec -service.yaml); \
		echo "==> openapi-ts ($$name)"; \
		$(OPENAPI_GENERATOR) -i $$spec -o $(OPENAPI_GENERATED_DIR)/$$name -p @hey-api/typescript zod --no-log-file || exit 1; \
	done

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

dev: ## Start the Vite dev server against real local services
	npm --prefix apps/web-frontend run dev

dev-infra: ## Start local infrastructure (docker compose up -d)
	docker compose up -d

dev-down: ## Stop local infrastructure, preserving data (docker compose down)
	docker compose down

dev-reset: ## Destroy local infrastructure volumes and data (requires confirmation)
	@printf 'This permanently deletes all local infrastructure volumes and data. Continue? [y/N] '; \
	read -r answer; \
	case "$$answer" in \
		[yY]|[yY][eE][sS]) docker compose down -v ;; \
		*) echo 'Aborted.'; exit 1 ;; \
	esac

frontend-install: ## Install web-frontend dependencies from the committed lockfile
	npm --prefix apps/web-frontend ci

frontend-verify: ## Run the complete web-frontend verification gate
	npm --prefix apps/web-frontend run verify
