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

# Toolchain for native modules. better-sqlite3 v13 dropped musl
# prebuilds (H1 2026-08-17 — caught by the CI server-docker job on its
# first run), so node-gyp compiles it from source HERE, once. The
# runtime stage copies the result and stays toolchain-free.
RUN apk add --no-cache python3 make g++

# Install all deps (including devDeps needed for tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript to dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDeps in place: node_modules now holds ONLY production deps,
# with the compiled native binary already inside — ready to copy.
RUN npm prune --omit=dev && npm cache clean --force

# ============ RUNTIME STAGE ============
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Production node_modules come prebuilt from the builder (no npm ci
# here — the runtime image never needs a compiler toolchain).
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Admin CLI (list/delete/reset/backup players) — plain .mjs, no build step.
# H0 2026-08-17: this was never copied into the runtime image, so the
# documented production-DB cleanup commands could not work on Railway
# (found live: "Cannot find module '/app/scripts/admin-players.mjs'").
# better-sqlite3 is a production dep, so the CLI runs as-is in the
# container: `npm run admin:list-players`, `admin:delete-test`, etc.
COPY scripts ./scripts

# Railway injects PORT; /health responds there (see src/index.ts)
EXPOSE 2567

CMD ["node", "dist/index.js"]
