# CV-Hub

**AI-native Git platform — repository hosting, knowledge graphs, task dispatch, and CI/CD.**

CV-Hub is the web application and API behind [hub.controlvector.io](https://hub.controlvector.io). It provides Git hosting with built-in code intelligence: knowledge graphs, semantic search, AI-assisted code review, task dispatch to remote executors, and a CI/CD pipeline system.

![Status](https://img.shields.io/badge/status-production-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Architecture

This is a pnpm monorepo with three packages:

```
cv-hub/
├── apps/
│   ├── api/          # Hono REST API + MCP gateway (Node.js/TypeScript)
│   └── web/          # React SPA (Vite + MUI)
├── packages/
│   └── shared/       # Shared types and utilities
├── deploy/           # Deployment configs
├── docs/             # Architecture docs, sprint notes, auth design
├── infra/            # Infrastructure configs
└── scripts/          # Operational scripts
```

### API (`apps/api`)

- **Framework**: [Hono](https://hono.dev/) on Node.js
- **Database**: PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)
- **Cache/Queue**: Redis + BullMQ
- **Graph**: FalkorDB (knowledge graph), Qdrant (vector search)
- **Auth**: JWT + refresh tokens, device auth flow, GitHub OAuth, MFA (TOTP + WebAuthn)
- **Payments**: Stripe subscriptions
- **Git hosting**: HTTP smart protocol (push/pull)
- **MCP**: Remote MCP gateway for Claude.ai integration

### Web (`apps/web`)

- **React 19** + TypeScript
- **Material UI (MUI)** with custom dark theme
- **Vite** build tooling
- **React Router** client-side routing
- **TanStack Query** data fetching
- **Monaco Editor** for code viewing
- **D3** for knowledge graph visualization

---

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | >= 20 | Runtime |
| pnpm | >= 9 | Package manager |
| PostgreSQL | 15+ | Primary database |
| Redis | 7+ | Cache, job queue (BullMQ) |
| FalkorDB | Latest | Knowledge graph (optional, for graph features) |
| Qdrant | Latest | Vector search (optional, for semantic search) |

---

## Quick Start (Development)

```bash
# Install dependencies
pnpm install

# Copy and edit environment config
cp .env.example .env
# Edit .env with your Postgres, Redis, and API credentials

# Run database migrations
pnpm db:migrate

# Start both API and web in development mode
pnpm dev

# Or start individually:
pnpm dev:api    # API on http://localhost:3001
pnpm dev:web    # Web on http://localhost:5173
```

---

## Environment Variables

Copy `.env.example` and configure:

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/cvhub

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret

# Git hosting
GIT_REPOS_PATH=/var/lib/cv-hub/repos

# Optional: GitHub OAuth (for "Sign in with GitHub")
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional: Stripe billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Optional: Graph databases
FALKORDB_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333

# Optional: Sentry error tracking
SENTRY_DSN=
```

See `.env.example` and `.env.controlvector` for full variable list.

---

## Scripts

```bash
pnpm dev              # Start API + web in dev mode
pnpm build            # Build all packages
pnpm lint             # Lint all packages
pnpm db:generate      # Generate Drizzle migration files
pnpm db:migrate       # Run pending migrations
pnpm db:studio        # Open Drizzle Studio (database browser)
```

---

## Deployment

### Docker Compose (self-hosted)

```bash
docker compose up -d
```

This starts the API and web containers. You'll need to provide a Postgres instance and Redis instance (or add them to the compose file).

See [DEPLOY.md](DEPLOY.md) for full deployment documentation including:
- Docker build instructions (`Dockerfile.api`, `Dockerfile.web`)
- Nginx reverse proxy config
- SSL/TLS setup
- AWS deployment plan

### Custom Domain

The production instance runs at `hub.controlvector.io`. For self-hosted deployments, configure your reverse proxy to route to the API and web containers, and update the `VITE_API_URL` env var in the web build.

---

## API Routes

The API exposes REST endpoints under `/v1/`:

| Route group | Purpose |
|-------------|---------|
| `/v1/auth` | Registration, login, JWT refresh, device auth |
| `/v1/repos` | Repository CRUD, file browsing, diffs, commits |
| `/v1/git` | Git HTTP smart protocol (push/pull) |
| `/v1/issues` | Issue tracking per repository |
| `/v1/pulls` | Pull request management |
| `/v1/releases` | Release management |
| `/v1/graph` | Knowledge graph queries |
| `/v1/search` | Code and semantic search |
| `/v1/ci-cd` | Pipeline creation, execution, logs |
| `/v1/executors` | Executor registration, task dispatch, heartbeats |
| `/v1/tasks` | Task lifecycle, prompt relay |
| `/v1/context-engine` | Context manifold (bandit, transitions, scoring) |
| `/v1/config` | Repository and org configuration |
| `/v1/mcp-gateway` | Remote MCP server for Claude.ai |
| `/v1/stripe` | Billing webhooks and subscription management |
| `/v1/organizations` | Organization management |

---

## Key Features

- **Git hosting** — Full HTTP smart protocol, push/pull, branch management
- **Knowledge graph** — FalkorDB-powered code graph with symbol relationships
- **Semantic search** — Qdrant vector search with natural language queries
- **AI assistant** — Chat interface for code understanding (explain, find, review)
- **Pull requests** — AI-powered code review with security and quality scoring
- **CI/CD pipelines** — AI-generated pipeline creation with execution and failure analysis
- **Task dispatch** — Send tasks to remote machines running CV-Agent (`cva`)
- **Context engine** — LinUCB bandit scoring, Markov transition model, context versioning
- **Billing** — Stripe-integrated tier system (free, pro, team, enterprise)
- **MFA** — TOTP and WebAuthn passkey support
- **MCP gateway** — Expose CV-Hub tools to Claude.ai via remote MCP

---

## Related Projects

- [CV-Git](https://www.npmjs.com/package/@controlvector/cv-git) (`cv`) — AI-native version control CLI
- [CV-Agent](https://www.npmjs.com/package/@controlvector/cv-agent) (`cva`) — Remote task dispatch daemon

---

## License

MIT
