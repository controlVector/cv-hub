# Changelog

All notable changes to CV-Hub will be documented in this file.

## [1.0.0] - 2026-03-23

### Added

#### Context Manifold Integration (Sprint 5)
- **Bandit feedback hook** — Task outcomes train the contextual scorer via LinUCB updates
- **Transition learning** — Event sequences from completed tasks train the Markov model
- **Deploy outcome service** — Deploy events create Decision nodes in context version graphs
- **Enrichment scoring** — Task dispatch ranks context nodes by bandit average reward

#### MCP Gateway
- **Remote MCP server** — Expose CV-Hub tools to cloud Claude.ai via MCP protocol

#### API & Infrastructure
- **Git hosting** — Full git HTTP backend with push/pull support
- **Repository management** — Create, browse, diff, and search repositories
- **Knowledge graph** — FalkorDB-powered code graph with semantic search
- **CI/CD pipelines** — AI-generated pipeline creation, execution, failure analysis
- **Task dispatch** — Executor registration, task polling, SSE streaming, prompt relay
- **Stripe billing** — Subscription management with webhook handling
