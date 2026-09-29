#!/usr/bin/env node
// ---------------------------------------------------------------------------
// probe-server.mjs — sonda del servidor online (CI y runbook de despliegue)
// ---------------------------------------------------------------------------
//
// Uso:
//   node scripts/probe-server.mjs <url>          solo lee /health
//   node scripts/probe-server.mjs <url> --full   además, el guard y una sala
//
// Sin --full no toca nada, así que sirve contra producción:
//   - /health responde con status 'ok';
//   - protocol es el NET_PROTOCOL de server/src/protocol.ts (una imagen o un
//     proceso con el protocolo viejo falla aquí, sin un número a mano);
//   - protocolGuard es 'on'.
//
// Con --full (el job server-docker del CI; en producción, solo dentro de una
// ventana de mantenimiento, porque sube rejectedJoins, que es la señal del
// runbook):
//   - POST {} (un cliente v1.7, sin protocolo) → 523 client_outdated;
//   - POST {protocol: P+1} → 523 server_outdated;
//   - rejectedJoins sube exactamente 2;
//   - create privado con el protocolo correcto → 200 con roomId. La sala no
//     la ve el matchmaking y muere sola al caducar el asiento (15 s; en el CI,
//     2 s con COLYSEUS_SEAT_RESERVATION_TIME=2). Nunca pasa de la espera,
//     así que no escribe en la base de datos.
//
// Espera hasta 30 s a que /health conteste (el contenedor recién arrancado).
// Sale con 0 si todo cuadra y con 1 si algo falla; imprime el detalle.
// Sin dependencias: el fetch de Node 20+.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--'))?.replace(/\/+$/, '');
const full = args.includes('--full');
if (!base) {
  console.error('uso: node scripts/probe-server.mjs <url> [--full]');
  process.exit(2);
}

const protocolSrc = readFileSync(fileURLToPath(new URL('../server/src/protocol.ts', import.meta.url)), 'utf8');
const P = Number(protocolSrc.match(/export const NET_PROTOCOL\s*=\s*(\d+)/)?.[1]);
if (!Number.isInteger(P)) {
  console.error('[probe] no encuentro NET_PROTOCOL en server/src/protocol.ts');
  process.exit(2);
}

const failures = [];
const check = (ok, what) => {
  console.log(`[probe] ${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

async function health() {
  const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
  return { status: res.status, body: await res.json() };
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      return await health();
    } catch (e) {
      last = String(e?.cause?.code ?? e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`/health no contesta en 30 s (${last})`);
}

async function matchmake(method, body) {
  const res = await fetch(`${base}/matchmake/${method}/brawl`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, text: await res.text() };
}

try {
  const h = await waitForHealth();
  console.log(`[probe] /health ${JSON.stringify(h.body)}`);
  check(h.status === 200 && h.body.status === 'ok', "/health 200 con status 'ok'");
  check(h.body.protocol === P, `/health protocol ${h.body.protocol} = NET_PROTOCOL ${P}`);
  check(h.body.protocolGuard === 'on', `/health protocolGuard '${h.body.protocolGuard}' = 'on'`);

  if (full) {
    const before = h.body.rejectedJoins;
    const old = await matchmake('joinOrCreate', {});
    check(old.status === 523 && old.text.includes(`client_outdated 1<${P}`), `POST {} → ${old.status} client_outdated 1<${P}`);
    const future = await matchmake('joinOrCreate', { protocol: P + 1 });
    check(future.status === 523 && future.text.includes('server_outdated'), `POST {protocol:${P + 1}} → ${future.status} server_outdated`);
    const after = (await health()).body.rejectedJoins;
    check(after === before + 2, `rejectedJoins ${before} → ${after} (+2)`);
    const created = await matchmake('create', { protocol: P, private: true });
    let roomId;
    try { roomId = JSON.parse(created.text)?.roomId; } catch { /* cuerpo no JSON */ }
    check(created.status === 200 && typeof roomId === 'string', `create privado con protocol ${P} → ${created.status} roomId ${roomId}`);
  }
} catch (e) {
  failures.push(String(e?.message ?? e));
  console.error(`[probe] FAIL ${e?.message ?? e}`);
}

if (failures.length) {
  console.error(`[probe] ${failures.length} fallo(s)`);
  process.exit(1);
}
console.log(`[probe] todo OK${full ? ' (--full)' : ''}`);
