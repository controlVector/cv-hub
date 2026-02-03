# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for native modules (tree-sitter)
RUN apk add --no-cache python3 make g++ git

# Install pnpm
RUN npm install -g pnpm

# Copy package files - lockfile is optional for standalone builds
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install dependencies (use frozen-lockfile only if lockfile exists)
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    else \
      pnpm install; \
    fi

# Copy source
COPY . .

# Build
RUN pnpm build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install git (needed for git operations), libstdc++ for native modules,
# and buildah + fuse-overlayfs for daemonless container builds (CI/CD worker)
RUN apk add --no-cache git libstdc++ buildah fuse-overlayfs && npm install -g pnpm

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 cvhub

# Copy built files including native modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create git repos directory
RUN mkdir -p /data/git && chown -R cvhub:nodejs /data/git

USER cvhub

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/index.js"]
