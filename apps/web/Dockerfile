# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy monorepo root package files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

# Copy workspace package files
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY . .

# Build arguments for environment
ARG VITE_API_URL=https://api.hub.controlvector.io
ARG VITE_APP_URL=https://hub.controlvector.io

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_URL=$VITE_APP_URL

# Build web only (skip API which OOMs tsc in Docker)
RUN pnpm --filter @cv-hub/web build

# Production stage with nginx
FROM nginx:alpine AS runner

# Copy nginx config
COPY apps/web/nginx.conf /etc/nginx/nginx.conf

# Copy built files
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
