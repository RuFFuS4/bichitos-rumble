// ---------------------------------------------------------------------------
// Bichitos Rumble — multiplayer server entry point
// ---------------------------------------------------------------------------
//
// Colyseus 0.17 (H1 2026-08-18): migrated from the classic
// `new Server({ transport: new WebSocketTransport({ server }) })` wiring to
// `defineServer()`. Reason discovered live in the local e2e: in 0.17 the
// transport attaches its OWN request listener to a provided http server,
// so the old pattern (our handler in createServer + colyseus on top) made
// BOTH respond to every request → ERR_HTTP_HEADERS_SENT on /api calls.
//
// defineServer's `express` hook is the official surface for custom HTTP
// routes (express 5 already arrives transitively with colyseus 0.17 —
// via @colyseus/monitor — zero new runtime deps of our own). Our
// zero-dependency api.ts dispatcher is mounted unchanged as the first
// middleware: it returns true when it handled the request, false → next().
// CORS caveat: colyseus's router intercepts OPTIONS preflights before
// express — see the note in api.ts.
// ---------------------------------------------------------------------------

import { defineServer, defineRoom, matchMaker } from 'colyseus';
import type { Request, Response, NextFunction } from 'express';
import { BrawlRoom } from './BrawlRoom.js';
import { handleApiRequest } from './api.js';
import { NET_PROTOCOL } from './protocol.js';
import { isGuardEnabled, rejectedJoins } from './net-protocol-guard.js';
import { maintenanceStatus } from './maintenance.js';

const PORT = Number(process.env.PORT) || 2567;
/** Short SHA of the deployed commit (Railway injects it); null elsewhere. */
const COMMIT = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
/** Cap on a shutdown. Colyseus waits for every room to dispose with no
 *  timeout of its own (MatchMaker lockAndDisposeAll); 8 s stays under the
 *  10 s of RAILWAY_DEPLOYMENT_DRAINING_SECONDS, so the log says what hung
 *  before Railway's SIGKILL would. */
const SHUTDOWN_WATCHDOG_MS = 8_000;

const server = defineServer({
  rooms: {
    brawl: defineRoom(BrawlRoom),
  },
  express: (app) => {
    // REST API (Online Belts leaderboards + nickname register). Plain
    // (req, res) dispatcher carried over from 0.16 — express req/res
    // extend IncomingMessage/ServerResponse, so it mounts as-is.
    app.use(async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!(await handleApiRequest(req, res))) next();
      } catch (e) {
        next(e);
      }
    });

    // Health check endpoint for hosting platforms (Railway). Also the
    // agent/post-deploy surface of the version guard: which protocol this
    // server speaks, whether the guard is on, and how many joins it has
    // turned away since boot (ONLINE.md → "Versión de protocolo"). And of
    // the deploy runbook: which commit and deployment are serving, and how
    // many rooms, clients and matches there are right now. live.clients is
    // Colyseus' ccu (connected plus those in their reconnect grace, end
    // screens and waiting rooms included); live.matches counts the rooms
    // in countdown or playing — 0 means a deploy cuts no match. And the
    // maintenance window
    // (server/src/maintenance.ts): stage none | active | invalid, when it
    // ends, and how many joins it turned away. Always 200 with status 'ok':
    // Railway's healthcheck and the client's pre-join probe rely on it.
    app.get("/health", (_req: Request, res: Response) => {
      const { roomCount, ccu } = matchMaker.stats.local;
      res.json({
        status: 'ok',
        uptime: process.uptime(),
        protocol: NET_PROTOCOL,
        protocolGuard: isGuardEnabled() ? 'on' : 'off',
        rejectedJoins: rejectedJoins(),
        commit: COMMIT,
        deployment: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
        live: { rooms: roomCount, clients: ccu, matches: BrawlRoom.liveMatches() },
        maintenance: maintenanceStatus(),
      });
    });

    app.get("/", (_req: Request, res: Response) => {
      res.send('Bichitos Rumble multiplayer server. Connect via WebSocket.');
    });
  },
});

// Shutdown (Railway's SIGTERM on a deploy, or a crash): Colyseus runs its
// own graceful shutdown and every BrawlRoom voids its running match
// (BrawlRoom.onBeforeShutdown). These two hooks put the when and the how
// long in the log — Railway's teardown with a volume is not documented, so
// the first deploys measure it — and cap a shutdown that hangs.
let shutdownStartedAt = 0;
server.onBeforeShutdown(() => {
  shutdownStartedAt = Date.now();
  const { roomCount, ccu } = matchMaker.stats.local;
  console.log(`[server] shutting down at ${new Date(shutdownStartedAt).toISOString()} — ${roomCount} rooms, ${ccu} clients`);
  setTimeout(() => {
    console.error(`[server] shutdown still running after ${SHUTDOWN_WATCHDOG_MS} ms (${matchMaker.stats.local.roomCount} rooms left) — exiting`);
    process.exit(1);
  }, SHUTDOWN_WATCHDOG_MS).unref();
});
server.onShutdown(() => {
  console.log(`[server] shut down in ${Date.now() - shutdownStartedAt} ms`);
});

server.listen(PORT).then(() => {
  console.log(`[server] listening on ws://localhost:${PORT}`);
  console.log(`[server] health:   http://localhost:${PORT}/health`);
  console.log(`[server] api:      http://localhost:${PORT}/api/leaderboard`);
  if (!isGuardEnabled()) {
    console.warn(`[server] NET_PROTOCOL_GUARD=off — the server accepts joins of ANY protocol (emergency only: v1.7 tabs WILL desync; v1.8+ clients still check /health and the state echo themselves)`);
  }
});
