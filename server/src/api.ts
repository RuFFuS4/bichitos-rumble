// ---------------------------------------------------------------------------
// Bichitos Rumble — REST API for Online Belts
// ---------------------------------------------------------------------------
//
// Tiny JSON HTTP routing attached to the same Node http server as the
// Colyseus WebSocket transport. No Express — a handful of paths don't
// justify another dependency.
//
// Routes:
//   POST /api/player                 register/claim nickname → { id, nickname, isNew }
//   GET  /api/leaderboard/:beltId    top 10 holders of a belt
//   GET  /api/leaderboard            all 5 belts top 10s (batch)
//   GET  /api/player/:id/stats       stats snapshot for one player
//   POST /api/identity/recovery-code auth playerId+token → genera/rota el
//                                    código de recuperación, lo devuelve UNA vez
//   POST /api/identity/recover       nickname+código+token nuevo → recupera
//                                    identidad en otro dispositivo (rota token)
//   GET  /api/metrics/retention      agregados de partidas (H4 retención)
//
// GET /api/metrics/retention va SIN auth a propósito: solo expone datos
// agregados (conteos, medias, porcentajes) sin PII — ni player_ids ni
// nicknames ni IPs. Es el mismo nivel de sensibilidad que el leaderboard
// público, y montar un ADMIN_TOKEN para esto añadiría más superficie de
// la que quita. Si alguna vez se añade detalle por jugador, ese día se
// gatea.
//
// Anti-cheat posture: the client can register nicknames and request
// leaderboards freely, but match results are only accepted from the
// server itself (BrawlRoom imports recordMatchResult from db.ts directly,
// never via HTTP) — there is deliberately NO HTTP route for match
// results. (H0 2026-08-16: this header used to document a
// POST /api/match/result gated by ADMIN_TOKEN that was never
// implemented; removed to match reality.)
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'http';
import {
  registerOrClaimPlayer,
  getLeaderboard,
  getPlayerStats,
  createRecoveryCode,
  recoverWithCode,
  getRetentionMetrics,
  type OnlineBeltId,
} from './db.js';

const ALL_BELTS: readonly OnlineBeltId[] = [
  'throne-online',
  'flash-online',
  'ironclad-online',
  'slayer-online',
  'hot-streak-online',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    // The client + server run on different origins in prod (game on
    // Vercel, API on Railway). CORS open for GET/POST — no credentials
    // are involved because authentication is token-in-body.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  res.end(JSON.stringify(body));
}

function sendNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'not_found' });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 4 * 1024; // 4 KB — our payloads are tiny, reject anything bigger
    req.on('data', (c) => {
      chunks.push(c);
      total += c.length;
      if (total > MAX) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

// Simple token-bucket rate limiter keyed by IP. Burst-friendly.
// Limits nickname registrations to ~10/min/IP — enough to register a
// family's devices, not enough to spam-create accounts.
const rlBuckets = new Map<string, { tokens: number; refilledAt: number }>();
function rateLimit(ip: string, capacity = 10, refillPerSecond = 10 / 60): boolean {
  const now = Date.now();
  const b = rlBuckets.get(ip) ?? { tokens: capacity, refilledAt: now };
  const elapsed = (now - b.refilledAt) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSecond);
  b.refilledAt = now;
  if (b.tokens < 1) {
    rlBuckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  rlBuckets.set(ip, b);
  return true;
}

function clientIp(req: IncomingMessage): string {
  // Railway sits behind a proxy — prefer X-Forwarded-For if present.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Main dispatcher — mounted from index.ts
// ---------------------------------------------------------------------------

/**
 * Returns true if the request was handled (i.e. the URL matched an /api/*
 * route). The outer http server keeps its health/info handler for the rest.
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/api/')) return false;

  // CORS preflight — NOTE (Colyseus 0.17, H1 review): in the
  // defineServer() wiring, @colyseus/core's router prepends its own
  // request listener that answers EVERY OPTIONS itself (204 + its
  // permissive CORS headers), so this branch is effectively dead in
  // production. Kept as defense-in-depth for any wiring where the
  // router interception isn't present. If a stricter CORS policy is
  // ever needed, the override point is matchMaker.controller's CORS
  // headers, not this file.
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }

  try {
    // --- POST /api/player ---
    if (req.method === 'POST' && url === '/api/player') {
      if (!rateLimit(clientIp(req))) {
        sendJson(res, 429, { error: 'rate_limited' });
        return true;
      }
      const body = (await readJsonBody(req)) as {
        nickname?: string; token?: string; identityId?: string;
      };
      const nickname = typeof body.nickname === 'string' ? body.nickname : '';
      const token = typeof body.token === 'string' ? body.token : '';
      // 2026-04-29 identity refinement — second auth key, optional
      // for backwards compat. Older clients (pre-update) don't send
      // it; the server falls back to token-only validation in that
      // case and reclaim still works exactly like before.
      const identityId = typeof body.identityId === 'string' ? body.identityId : undefined;
      const result = registerOrClaimPlayer(nickname, token, identityId);
      if ('error' in result) {
        sendJson(res, 400, { error: result.error });
      } else {
        sendJson(res, 200, result);
      }
      return true;
    }

    // --- POST /api/identity/recovery-code ---
    // Autenticado con las credenciales actuales (playerId + token). Cada
    // llamada genera un código NUEVO y rota el anterior (solo se guarda
    // un hash) — el cliente cachea el código en local para re-mostrarlo
    // sin regenerar. Rate-limit propio (5/min/IP, bucket separado del de
    // registro con el prefijo de clave).
    if (req.method === 'POST' && url === '/api/identity/recovery-code') {
      if (!rateLimit('rcode:' + clientIp(req), 5, 5 / 60)) {
        sendJson(res, 429, { error: 'rate_limited' });
        return true;
      }
      const body = (await readJsonBody(req)) as { playerId?: string; token?: string };
      const playerId = typeof body.playerId === 'string' ? body.playerId : '';
      const token = typeof body.token === 'string' ? body.token : '';
      const result = createRecoveryCode(playerId, token);
      if ('error' in result) {
        sendJson(res, 401, { error: result.error });
      } else {
        sendJson(res, 200, result);
      }
      return true;
    }

    // --- POST /api/identity/recover ---
    // Sin auth previa (es EL mecanismo de auth): nickname + código. El
    // cliente manda un token nuevo generado por él (mismo contrato que
    // el registro) que pasa a ser el token del dispositivo. Rate-limit
    // estricto de 5 intentos/min/IP contra brute-force de códigos.
    if (req.method === 'POST' && url === '/api/identity/recover') {
      if (!rateLimit('recover:' + clientIp(req), 5, 5 / 60)) {
        sendJson(res, 429, { error: 'rate_limited' });
        return true;
      }
      const body = (await readJsonBody(req)) as {
        nickname?: string; code?: string; token?: string; identityId?: string;
      };
      const nickname = typeof body.nickname === 'string' ? body.nickname : '';
      const code = typeof body.code === 'string' ? body.code : '';
      const token = typeof body.token === 'string' ? body.token : '';
      const identityId = typeof body.identityId === 'string' ? body.identityId : undefined;
      const result = recoverWithCode(nickname, code, token, identityId);
      if ('error' in result) {
        sendJson(res, 400, { error: result.error });
      } else {
        sendJson(res, 200, result);
      }
      return true;
    }

    // --- GET /api/metrics/retention ---
    // Sin auth — solo agregados, sin PII (decisión documentada en la
    // cabecera de este fichero).
    if (req.method === 'GET' && url === '/api/metrics/retention') {
      sendJson(res, 200, getRetentionMetrics());
      return true;
    }

    // --- GET /api/leaderboard/:beltId ---
    const singleLb = url.match(/^\/api\/leaderboard\/([\w-]+)$/);
    if (req.method === 'GET' && singleLb) {
      const belt = singleLb[1] as OnlineBeltId;
      if (!ALL_BELTS.includes(belt)) {
        sendJson(res, 404, { error: 'unknown_belt' });
        return true;
      }
      sendJson(res, 200, { belt, entries: getLeaderboard(belt) });
      return true;
    }

    // --- GET /api/leaderboard (batch for all 5 belts) ---
    if (req.method === 'GET' && url === '/api/leaderboard') {
      const out: Record<string, unknown> = {};
      for (const belt of ALL_BELTS) out[belt] = getLeaderboard(belt);
      sendJson(res, 200, out);
      return true;
    }

    // --- GET /api/player/:id/stats ---
    const playerStats = url.match(/^\/api\/player\/([\w-]+)\/stats$/);
    if (req.method === 'GET' && playerStats) {
      const playerId = playerStats[1];
      const stats = getPlayerStats(playerId);
      if (!stats) {
        sendNotFound(res);
      } else {
        sendJson(res, 200, stats);
      }
      return true;
    }

    sendNotFound(res);
    return true;
  } catch (err) {
    console.error('[api] error handling', req.method, url, err);
    sendJson(res, 500, { error: 'internal_error' });
    return true;
  }
}
