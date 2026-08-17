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

import { defineServer, defineRoom } from 'colyseus';
import type { Request, Response, NextFunction } from 'express';
import { BrawlRoom } from './BrawlRoom.js';
import { handleApiRequest } from './api.js';

const PORT = Number(process.env.PORT) || 2567;

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

    // Health check endpoint for hosting platforms (Railway).
    app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });

    app.get("/", (_req: Request, res: Response) => {
      res.send('Bichitos Rumble multiplayer server. Connect via WebSocket.');
    });
  },
});

server.listen(PORT).then(() => {
  console.log(`[server] listening on ws://localhost:${PORT}`);
  console.log(`[server] health:   http://localhost:${PORT}/health`);
  console.log(`[server] api:      http://localhost:${PORT}/api/leaderboard`);
});
