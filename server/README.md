# Bichitos Rumble — Multiplayer Server

Authoritative Colyseus server for online matches. Runs Node + TypeScript.

## Local development

```bash
npm install
npm run dev      # tsx watch, listens on ws://localhost:2567
```

Health check: `curl http://localhost:2567/health` → `{"status":"ok",...}`

## Deploy to Railway (recommended)

Railway uses Nixpacks to auto-detect Node projects. Procedure:

1. Log in at https://railway.com → "New Project" → "Deploy from GitHub Repo"
2. Pick this repo (`RuFFuS4/bichitos-rumble`)
3. In the created service, go to **Settings**:
   - **Root Directory**: `server`
   - **Build Command**: `npm run build` (auto-detected)
   - **Start Command**: `npm run start` (auto-detected)
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
