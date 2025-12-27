# CV-Hub Documentation

> Complete reference for the ControlVector Hub frontend - AI-native Git platform

## Overview

CV-Hub is the cloud-hosted frontend for the ControlVector platform, designed to compete with GitHub and GitLab by putting AI capabilities at the center of the developer experience.

**Repository:** https://github.com/controlVector/cv-hub
**Target Domain:** git.controlvector.io

---

## Architecture

### Frontend Stack

| Technology | Purpose |
|------------|---------|
| React 18 | UI framework |
| TypeScript | Type safety |
| Material UI (MUI) | Google Material Design components |
| Vite 5.4 | Build tooling (Node 18 compatible) |
| React Router 6 | Client-side routing |
| TanStack Query | Data fetching/caching |
| react-syntax-highlighter | Code display |

### Design System

Colors match the cv-prd project:

```css
--cv-navy: #1e2a3a          /* Primary background */
--cv-navy-light: #2a3a4d    /* Card backgrounds */
--cv-navy-lighter: #3a4d63  /* Borders, secondary */
--cv-orange: #f5a623        /* Primary accent */
--cv-coral: #e85d75         /* Secondary accent */
--cv-text-light: #ffffff    /* Primary text */
--cv-text-muted: rgba(255, 255, 255, 0.7)
```

Gradient: `linear-gradient(135deg, #f5a623 0%, #e85d75 100%)`

---

## Pages & Features

### 1. Dashboard (`/`)
- **Stats cards:** Repositories, PRs, Issues, AI Operations
- **Recent repositories:** With health scores and language indicators
- **AI Insights panel:** Security vulnerabilities, complexity warnings, dead code detection
- **Activity feed:** Recent commits, PRs, AI operations
- **Quick actions:** New repo, AI review, search

### 2. Repositories (`/repositories`)
- **Grid view:** Repository cards with metadata
- **Health scores:** Visual progress bars (green/orange/red)
- **Filters:** All, Public, Private, AI-enabled
- **Badges:** AI Insights enabled, Knowledge Graph synced
- **Actions:** Clone, settings, enable AI, sync graph

### 3. Repository Detail (`/repositories/:owner/:repo`)
- **File tree:** Collapsible directory navigation
- **Code viewer:** Syntax highlighting with line numbers
- **File stats:** Lines, size, language, complexity
- **Tabs:** Code, Pull Requests, Issues, Actions, Settings
- **AI actions:** Explain file, view history

### 4. AI Assistant (`/ai-assistant`)
- **Chat interface:** Conversation with AI about codebase
- **Command modes:**
  - `explain` - Get code explanations
  - `find` - Semantic code search
  - `review` - AI code review
  - `do` - Execute development tasks
  - `graph` - Query knowledge graph
- **Code blocks:** Syntax-highlighted responses
- **Repository selector:** Choose context

### 5. Pull Requests (`/pull-requests`)
- **PR list:** With status icons (open/merged/closed)
- **AI review scores:** Percentage-based quality rating
- **Issue breakdown:** Critical/warning/info by category
- **Categories:** Security, performance, maintainability, bugs
- **Expandable details:** Full AI review inline
- **Labels:** Feature, bug, security, refactor, etc.

### 6. Knowledge Graph (`/graph`)
- **Canvas visualization:** Interactive node graph
- **Node types:** Files, functions, classes, modules
- **Edge types:** Calls, imports, inherits
- **Controls:** Zoom, filter by type, search
- **Details panel:** Metrics, connections for selected node
- **Legend:** Color-coded node types

### 7. Search (`/search`)
- **Semantic search:** Natural language queries
- **Result types:** Code, files, symbols, commits, PRs
- **Relevance scores:** AI-powered ranking
- **Code preview:** Expandable syntax-highlighted results
- **Filters:** By type, repository

---

## File Structure

```
cv-hub/
├── public/
│   └── logo.png                 # ControlVector logo
├── src/
│   ├── components/
│   │   └── Layout.tsx           # Main layout with sidebar
│   ├── pages/
│   │   ├── Dashboard.tsx        # Home dashboard
│   │   ├── Repositories.tsx     # Repo list
│   │   ├── RepositoryDetail.tsx # Code browser
│   │   ├── AIAssistant.tsx      # AI chat
│   │   ├── PullRequests.tsx     # PR management
│   │   ├── KnowledgeGraph.tsx   # Graph visualization
│   │   └── Search.tsx           # Semantic search
│   ├── theme/
│   │   └── index.ts             # MUI theme (cv-prd colors)
│   ├── types/
│   │   └── index.ts             # TypeScript interfaces
│   ├── App.tsx                  # Root + routing
│   ├── main.tsx                 # Entry point
│   └── index.css                # Global styles
├── .github/workflows/
│   ├── ci.yml                   # Build/lint on push
│   └── deploy.yml               # Docker image to GHCR
├── Dockerfile                   # Multi-stage production build
├── docker-compose.yml           # With Traefik labels
├── nginx.conf                   # SPA routing + headers
├── vercel.json                  # Vercel deployment
├── package.json
└── README.md
```

---

## Deployment

### Option 1: Vercel (Quickest)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy (follow prompts)
vercel

# Set custom domain in Vercel dashboard
# Point git.controlvector.io CNAME to cname.vercel-dns.com
```

Or use the deploy button: https://vercel.com/new/clone?repository-url=https://github.com/controlVector/cv-hub

### Option 2: Docker (Self-hosted)

```bash
# Clone repository
git clone https://github.com/controlVector/cv-hub.git
cd cv-hub

# Build and run
docker compose up -d

# Access at http://localhost:3000
```

### Option 3: Docker + Traefik (Production)

The `docker-compose.yml` includes Traefik labels for automatic SSL:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.cv-hub.rule=Host(`git.controlvector.io`)"
  - "traefik.http.routers.cv-hub.tls=true"
  - "traefik.http.routers.cv-hub.tls.certresolver=letsencrypt"
```

**Prerequisites:**
1. VPS with Docker installed
2. Traefik running as reverse proxy
3. DNS A record: `git.controlvector.io` → server IP

```bash
# On your server
git clone https://github.com/controlVector/cv-hub.git
cd cv-hub
docker compose up -d
```

### Option 4: Static Hosting

```bash
npm run build
# Upload dist/ folder to: Netlify, Cloudflare Pages, S3+CloudFront, etc.
```

---

## CI/CD Pipelines

### CI Workflow (`.github/workflows/ci.yml`)

Triggers: Push to main, Pull requests

Steps:
1. Checkout code
2. Setup Node.js 20
3. Install dependencies (`npm ci`)
4. Type check (`tsc --noEmit`)
5. Lint (if configured)
6. Build (`npm run build`)
7. Upload artifacts

### Deploy Workflow (`.github/workflows/deploy.yml`)

Triggers: Push to main, Tags (v*), Manual

Steps:
1. Build Docker image
2. Push to GitHub Container Registry (`ghcr.io/controlvector/cv-hub`)
3. Tags: branch name, version, SHA

**To pull the image:**
```bash
docker pull ghcr.io/controlvector/cv-hub:main
```

---

## Environment Variables

Create `.env` for local development:

```env
# cv-git backend API
VITE_API_URL=http://localhost:3001

# Production
VITE_API_URL=https://api.controlvector.io
```

---

## Integration with cv-git

CV-Hub is designed to be the frontend for cv-git's backend APIs:

| CV-Hub Feature | cv-git Backend |
|----------------|----------------|
| Repository list | `GET /api/repos` |
| File browser | `GET /api/repos/:id/files` |
| AI Explain | `POST /api/ai/explain` |
| AI Find | `POST /api/ai/find` |
| AI Review | `POST /api/ai/review` |
| AI Do | `POST /api/ai/do` |
| Knowledge Graph | `GET /api/graph/:repo` |
| Semantic Search | `POST /api/search` |
| Pull Requests | `GET /api/repos/:id/pulls` |

Currently using mock data - replace with API calls in `src/services/api.ts` (to be created).

---

## Related Projects

| Project | Description | Location |
|---------|-------------|----------|
| cv-git | AI-native version control CLI | `/home/schmotz/project/cv-git` |
| cv-prd | PRD management (design reference) | `/home/schmotz/project/cv-prd` |
| cv-md | Document viewer | `/home/schmotz/project/cv-md` |
| cv-hub | This project (frontend) | `/home/schmotz/project/cv-hub` |

---

## Development

```bash
# Start dev server
npm run dev
# → http://localhost:5173

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npx tsc --noEmit
```

---

## Next Steps

1. **Connect to cv-git APIs** - Replace mock data with real endpoints
2. **Authentication** - Add OAuth/JWT login flow
3. **Real-time updates** - WebSocket for notifications
4. **Mobile optimization** - Responsive improvements
5. **Dogfood** - Deploy to git.controlvector.io and use for cv-git development

---

*Last updated: December 2024*
