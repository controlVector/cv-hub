# ControlVector Hub

AI-native Git platform frontend - an intelligent alternative to GitHub and GitLab.

![ControlVector Hub Dashboard](https://img.shields.io/badge/status-alpha-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Dashboard** - Overview with AI insights, activity feed, and health scores
- **Repository Browser** - File tree navigation with syntax-highlighted code viewer
- **AI Assistant** - Chat interface for code understanding (`explain`, `find`, `review`, `do`)
- **Pull Requests** - AI-powered code review with security and quality scoring
- **Knowledge Graph** - Interactive visualization of code relationships
- **Semantic Search** - Find code using natural language, powered by embeddings

## Tech Stack

- **React 18** + **TypeScript**
- **Material UI (MUI)** - Google's Material Design
- **Vite** - Fast build tooling
- **React Router** - Client-side routing
- **TanStack Query** - Data fetching and caching

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Deployment

### Option 1: Vercel (Recommended for quick deployment)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/controlVector/cv-hub)

Or via CLI:
```bash
npm i -g vercel
vercel
```

### Option 2: Docker (Self-hosted)

```bash
# Build and run with Docker Compose
docker compose up -d

# Or build manually
docker build -t cv-hub .
docker run -p 3000:80 cv-hub
```

Access at `http://localhost:3000`

### Option 3: Static Hosting (Netlify, Cloudflare Pages, etc.)

```bash
npm run build
# Upload the `dist/` folder to your static host
```

### Custom Domain (git.controlvector.io)

1. Deploy using Docker or your preferred method
2. Configure your reverse proxy (nginx, Traefik, Caddy) to point to the container
3. Set up SSL certificate (Let's Encrypt recommended)
4. Update DNS A/CNAME record to point `git.controlvector.io` to your server

Example with Traefik (labels included in `docker-compose.yml`):
```bash
docker compose up -d
```

## Project Structure

```
cv-hub/
├── src/
│   ├── components/      # Reusable UI components
│   │   └── Layout.tsx   # Main layout with navigation
│   ├── pages/           # Route pages
│   │   ├── Dashboard.tsx
│   │   ├── Repositories.tsx
│   │   ├── RepositoryDetail.tsx
│   │   ├── AIAssistant.tsx
│   │   ├── PullRequests.tsx
│   │   ├── KnowledgeGraph.tsx
│   │   └── Search.tsx
│   ├── theme/           # MUI theme configuration
│   ├── types/           # TypeScript interfaces
│   ├── App.tsx          # Root component with routing
│   └── main.tsx         # Entry point
├── public/              # Static assets
├── Dockerfile           # Production Docker image
├── docker-compose.yml   # Docker Compose configuration
├── nginx.conf           # Nginx config for Docker
└── vercel.json          # Vercel deployment config
```

## Environment Variables

Create a `.env` file for configuration:

```env
# API endpoint for cv-git backend
VITE_API_URL=https://api.controlvector.io

# Optional: Analytics
VITE_ANALYTICS_ID=
```

## CI/CD

GitHub Actions workflows are included:

- **CI** (`.github/workflows/ci.yml`) - Runs on every push/PR: type checking, linting, build
- **Deploy** (`.github/workflows/deploy.yml`) - Builds and pushes Docker image to GitHub Container Registry

## Roadmap

- [ ] Connect to cv-git backend APIs
- [ ] User authentication (OAuth, JWT)
- [ ] Real-time notifications (WebSocket)
- [ ] Dark/light theme toggle
- [ ] Mobile responsive improvements
- [ ] Collaborative features (comments, mentions)

## Related Projects

- [cv-git](https://github.com/controlVector/cv-git) - AI-native version control CLI with knowledge graph
- [cv-prd](https://github.com/controlVector/cv-prd) - PRD management system (design reference)

## License

MIT
