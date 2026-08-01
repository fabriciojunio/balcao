# Makefile - atalhos para as tarefas comuns do projeto.
# Uso: `make <alvo>`. Rode `make help` para a lista.

.DEFAULT_GOAL := help
.PHONY: help install typecheck lint test test-cov test-int config expurgar db-up db-down db-push \
        db-studio audit verify clean

help: ## Lista os alvos disponiveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Instala dependencias (npm ci)
	npm ci

typecheck: ## Verifica os tipos TypeScript
	npm run typecheck

lint: ## Roda o ESLint
	npm run lint

test: ## Testes unitarios e bateria de regressao
	npm test

test-cov: ## Testes com gate de cobertura
	npm run test:coverage

test-int: ## Testes de integracao (precisa de DATABASE_URL)
	npm run test:integration

expurgar: ## Expurgo de retencao LGPD (use ARGS=--simular para so contar)
	npm run expurgar -- $(ARGS)

config: ## Valida os arquivos de configuracao das lojas
	npm run config:validar

db-up: ## Sobe Postgres local em container
	docker compose up -d postgres

db-down: ## Derruba os containers
	docker compose down

db-push: ## Aplica o schema no banco
	npm run db:push

db-studio: ## Abre o Prisma Studio
	npm run db:studio

audit: ## Auditoria de dependencias de producao
	npm run audit:prod

verify: typecheck lint test-cov config ## Verificacao completa local
	@echo "Verificacao local concluida"

clean: ## Remove artefatos de build e cobertura
	rm -rf coverage dist tsconfig.tsbuildinfo
