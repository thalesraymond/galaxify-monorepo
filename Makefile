SERVICES := user-service daily-service ship-service expedition-service
WORKERS := daily-cron
GOOSE := ./goose.sh

.PHONY: test coverage goose-up goose-down sqlc build vet fmt tidy help

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

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'