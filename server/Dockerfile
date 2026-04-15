# ---------------------------------------------------------------------------
# Multi-stage Docker build for bichitos-rumble-server
# ---------------------------------------------------------------------------
#
# Problem: Railpack/Nixpacks auto-detection includes devDependencies (tsx,
# TypeScript, @types/*) in the final image, which bloats the runtime image
# and can cause the "importing to docker" step to time out on Railway.
#
# Solution: two-stage build.
#   1. builder — install all deps, compile TS to dist/
#   2. runner  — only production deps + compiled dist/
#
# Final image: ~150 MB instead of ~400+ MB. Node 22 alpine for minimal size.
# ---------------------------------------------------------------------------

# ============ BUILD STAGE ============
FROM node:22-alpine AS builder

WORKDIR /app

# Install all deps (including devDeps needed for tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript to dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ============ RUNTIME STAGE ============
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install ONLY production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Railway injects PORT; /health responds there (see src/index.ts)
EXPOSE 2567

CMD ["node", "dist/index.js"]
