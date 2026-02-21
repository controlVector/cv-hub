# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for native modules (tree-sitter)
RUN apk add --no-cache python3 make g++ git

# Install pnpm
RUN npm install -g pnpm

# Copy workspace config and all package files
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# Install all dependencies with shameful hoisting so all deps are at root level
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile --shamefully-hoist; \
    else \
      pnpm install --shamefully-hoist; \
    fi

# Copy source
COPY . .

# Build shared package with CJS output (no build script, compile directly)
RUN cd packages/shared && npx tsc --outDir dist --rootDir src --module CommonJS --moduleResolution node --verbatimModuleSyntax false

# Patch shared package.json: point to dist and remove "type": "module" for CJS compat
RUN cd packages/shared && \
    node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); delete p.type; p.main='./dist/index.js'; p.exports={'.':'./dist/index.js','./schemas':'./dist/schemas/index.js','./types':'./dist/types/index.js'}; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"

# Build API
RUN pnpm --filter @cv-hub/api build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install git (needed for git operations), libstdc++ for native modules,
# and buildah + fuse-overlayfs for daemonless container builds (CI/CD worker)
RUN apk add --no-cache git libstdc++ buildah fuse-overlayfs

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 cvhub

# Copy built API dist
COPY --from=builder /app/apps/api/dist ./dist

# Copy node_modules (shamefully-hoisted, all deps at root level)
COPY --from=builder /app/node_modules ./node_modules

# Copy built shared package into node_modules
COPY --from=builder /app/packages/shared ./node_modules/@cv-hub/shared

# Use root package.json (no "type": "module") so CJS-compiled dist works
COPY --from=builder /app/package.json ./

# Fix permissions for workspace packages and create git repos directory
RUN chmod -R a+rX /app/packages /app/node_modules/@cv-hub && \
    mkdir -p /data/git && chown -R cvhub:nodejs /data/git

USER cvhub

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/index.js"]
