# Bichitos Rumble — Multiplayer Server

Authoritative Colyseus server for online matches. Runs Node + TypeScript.

## Local development

```bash
npm install
npm run dev      # tsx watch, listens on ws://localhost:2567
```

Health check: `curl http://localhost:2567/health` → `{"status":"ok",...}`

## Deploy to Railway (recommended)

This directory ships a multi-stage `Dockerfile` that Railway detects
automatically and uses instead of Nixpacks/Railpack. It produces a
~150 MB runtime image (vs ~400+ MB with devDeps included) which avoids
`importing to docker` timeouts on free/hobby plans.

Procedure:

1. Log in at https://railway.com → "New Project" → "Deploy from GitHub Repo"
2. Pick this repo (`RuFFuS4/bichitos-rumble`)
3. In the created service, go to **Settings**:
   - **Root Directory**: `server`
   - Build system: auto-detected as Dockerfile (no need to override)
4. Railway assigns a random `PORT` env var; `src/index.ts` reads it
5. Go to **Networking** → **Generate Domain** → copy the public URL
   (e.g. `bichitos-rumble-server.up.railway.app`)
6. The WebSocket URL is `wss://<that-domain>` (Railway terminates TLS)

## Connect the client

Set `VITE_SERVER_URL` in Vercel project environment variables:

- Name: `VITE_SERVER_URL`
- Value: `wss://bichitos-rumble-server.up.railway.app` (your Railway domain)
- Environments: Production (and Preview, if desired)

Trigger a new Vercel deployment for the env var to take effect. The
`PLAY ONLINE` button on the title screen becomes visible only when this
env var is set at client build time.

## Build / start manually

```bash
npm run build    # tsc → dist/
npm run start    # node dist/index.js (honours PORT env var)
```
