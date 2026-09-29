#!/usr/bin/env node
// ---------------------------------------------------------------------------
// online-shutdown-e2e — shutdown and maintenance window, with real clients
// ---------------------------------------------------------------------------
//
// Starts the real server (server/src/index.ts through tsx) on its own port
// with a temporary DB and drives it with the Colyseus SDK, the way players
// and a deploy do. SIGTERM is the real signal on Linux; on Windows, which
// has no POSIX signals, the same handler through process.emit over IPC.
//
//   node scripts/online-shutdown-e2e.mjs [--port 2584] [--scenario A|B|C|R|M|G|all]
//
// Shutdown mid-match (4 verified players in one room, then SIGTERM):
//   A  in 'playing'
//   B  same, but one dropped a moment before (in its reconnect grace)
//   C  in 'countdown'
//   R  a seat reserved by HTTP just before, whose socket lands after the
//      SIGTERM: turned away, and the shutdown still ends at once (without
//      it the room never disposed and the 8 s cap exited with 1)
// A, B and C must end with: /health counting the room, its 4 clients (a
// player in its grace still counts) and 1 live match; every connected
// client seeing phase 'ended'
// with endReason 'server_shutdown' BEFORE its leave 4001; exit code 0 with
// the start and the length of the shutdown in the log; player_stats
// untouched (updated_at included) and exactly one 'server_shutdown' row.
// Before the fix every verified human got a loss and a broken streak.
//
// Maintenance window (server/scripts/maintenance.mjs, the real CLI):
//   M  with the window on, quick match, private create and a friend's
//      joinById are turned away with 'maintenance_window' and counted in
//      /health; a player of a running match reconnects fine; a corrupt
//      file leaves the online open ('invalid'); 'off' opens it again
//   G  NET_PROTOCOL_GUARD=off does not bypass it, and the window survives
//      a restart (the file lives next to the DB, on the volume)
//
// The port must be free: the script aborts rather than probe a server that
// is not its own child. Needs the root deps (@colyseus/sdk) and server/'s
// (tsx, better-sqlite3). Exit 0 when every scenario holds, 1 otherwise.
// ---------------------------------------------------------------------------

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@colyseus/sdk';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const PORT = Number(opt('port', '2584'));
const SCENARIOS = opt('scenario', 'all') === 'all' ? ['A', 'B', 'C', 'R', 'M', 'G'] : [opt('scenario')];
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;
const SERVER_DIR = fileURLToPath(new URL('../server/', import.meta.url));
const Database = createRequire(join(SERVER_DIR, 'package.json'))('better-sqlite3');
const P = Number(readFileSync(join(SERVER_DIR, 'src/protocol.ts'), 'utf8').match(/export const NET_PROTOCOL\s*=\s*(\d+)/)[1]);
const IS_WIN = process.platform === 'win32';
// Windows: the harness asks the child to raise its own SIGTERM handler.
const WIN_TERM = "data:text/javascript,process.on('message',m=>{if(m==='term')process.emit('SIGTERM')})";
const CACHE_WAIT_MS = 3_300; // the server re-reads maintenance.json every 3 s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => {
  console.log(`[e2e] ${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

async function portBusy() {
  try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; }
}

async function waitUntil(pred, ms, step = 20) {
  const t = Date.now();
  while (!pred()) { if (Date.now() - t > ms) return false; await sleep(step); }
  return true;
}

/** The real server on PORT with its DB in `data`. */
async function startServer(data, extraEnv = {}) {
  if (await portBusy()) throw new Error(`el puerto ${PORT} ya está ocupado (no es mi servidor)`);
  const child = spawn(process.execPath, ['--import', 'tsx', ...(IS_WIN ? ['--import', WIN_TERM] : []), 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: data, ...extraEnv },
    stdio: IS_WIN ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  });
  const srv = { child, log: '' };
  child.stdout.on('data', (d) => { srv.log += d; });
  child.stderr.on('data', (d) => { srv.log += d; });
  srv.exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  if (!(await waitUntil(() => srv.log.includes('[server] listening'), 20_000, 100))) {
    child.kill('SIGKILL'); // never leave an orphan holding the port
    await srv.exited;
    throw new Error(`el servidor no arranca
${srv.log}`);
  }
  return srv;
}

/** SIGTERM, as Railway does; resolves to { code, signal, ms } or null. */
async function terminate(srv) {
  if (srv.child.exitCode !== null || srv.child.signalCode !== null) return { ...(await srv.exited), ms: 0 };
  const t0 = Date.now();
  if (!IS_WIN) srv.child.kill('SIGTERM');
  else if (srv.child.connected) srv.child.send('term');
  const done = await Promise.race([srv.exited, sleep(15_000).then(() => null)]);
  return done && { ...done, ms: Date.now() - t0 };
}

async function cleanup(srv, data, scen) {
  if (srv && srv.child.exitCode === null) { srv.child.kill('SIGKILL'); await srv.exited; }
  if (failures.length && srv) console.log(`[e2e] --- log del servidor (${scen})\n${srv.log}`);
  try { rmSync(data, { recursive: true, force: true }); } catch { /* Windows: EBUSY */ }
}

async function registerPlayers(n, tag) {
  const players = [];
  for (let i = 0; i < n; i++) {
    const nickname = `e2e${tag}${i}${Date.now() % 100000}`;
    const token = randomUUID();
    const res = await fetch(`${BASE}/api/player`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, token }) });
    players.push({ token, id: (await res.json()).id });
  }
  return players;
}

/** 4 verified players sat in one public room, with their event trail. */
async function fullRoom(players) {
  const critters = ['Sergei', 'Trunk', 'Kurama', 'Shelly'];
  const recs = [];
  for (let i = 0; i < 4; i++) {
    const room = await new Client(WS).joinOrCreate('brawl', {
      protocol: P, playerId: players[i].id, playerToken: players[i].token, critterName: critters[i],
    });
    room.reconnection.maxRetries = 0;
    const rec = { room, order: [], leave: null };
    room.onStateChange((s) => { if (s.phase === 'ended' && !rec.order.some((e) => e.startsWith('ended'))) rec.order.push(`ended:${s.endReason}`); });
    room.onMessage('*', () => {});
    room.onLeave((code) => { rec.leave = code; rec.order.push(`leave:${code}`); });
    recs.push(rec);
  }
  return recs;
}

async function health() {
  return (await fetch(`${BASE}/health`)).json();
}

/** Runs the real CLI against `data`, as from the container shell. */
function maintenanceCli(data, ...args) {
  const r = spawnSync(process.execPath, ['scripts/maintenance.mjs', ...args], { cwd: SERVER_DIR, env: { ...process.env, DATA_DIR: data }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** How a join attempt ends: 'ok' (and it leaves again) or the error text. */
async function tryJoin(fn) {
  try {
    const room = await fn(new Client(WS));
    await room.leave();
    return 'ok';
  } catch (e) {
    return String(e?.message ?? e);
  }
}

// --- Shutdown mid-match -----------------------------------------------------

async function shutdownScenario(scen) {
  const data = mkdtempSync(join(tmpdir(), `br-e2e-${scen}-`));
  let srv;
  try {
    srv = await startServer(data);
    const players = await registerPlayers(4, scen);
    const recs = await fullRoom(players);
    const target = scen === 'C' ? 'countdown' : 'playing';
    check(await waitUntil(() => recs[0].room.state?.phase === target, 15_000), `${scen}: la sala llega a '${target}'`);
    if (scen !== 'C') await sleep(1000);
    if (scen === 'B') {
      const dropped = recs.pop();
      dropped.room.connection.close(4999, 'e2e drop'); // abnormal: the seat enters its grace
      await sleep(800);
      check(srv.log.includes('grace de'), `${scen}: el que se cae entra en su gracia`);
    }
    const h = await health();
    // A player in its reconnect grace (B) still counts: its match is alive.
    check(h.live?.rooms === 1 && h.live?.clients === 4 && h.live?.matches === 1, `${scen}: /health live cuenta 1 sala, 4 clientes y 1 partida (${JSON.stringify(h.live)})`);

    const sql = new Database(join(data, 'br-online.sqlite'), { readonly: true });
    const statsRow = sql.prepare('SELECT * FROM player_stats WHERE player_id = ?');
    const statsOf = () => JSON.stringify(players.map((p) => statsRow.get(p.id) ?? null));
    const before = statsOf();

    const done = await terminate(srv);
    check(done !== null, `${scen}: el proceso sale tras el SIGTERM (${done?.ms} ms)`);
    check(done?.code === 0, `${scen}: código de salida ${done?.code} (${done?.signal ?? 'sin señal'})`);
    await waitUntil(() => recs.every((r) => r.leave !== null), 3000);
    for (const [i, r] of recs.entries()) {
      check(r.order[0] === 'ended:server_shutdown' && r.leave === 4001, `${scen}: cliente ${i} ve 'ended:server_shutdown' y luego leave 4001 (${r.order.join(' > ')})`);
    }
    check(statsOf() === before, `${scen}: player_stats sin cambios`);
    const rows = sql.prepare('SELECT end_reason, winner_player_id FROM matches').all();
    check(rows.length === 1 && rows[0].end_reason === 'server_shutdown' && rows[0].winner_player_id === null,
      `${scen}: una sola fila, server_shutdown y sin ganador (${JSON.stringify(rows)})`);
    check(!srv.log.includes('[Belts] recorded'), `${scen}: ningún '[Belts] recorded' en el log`);
    check(/\[server\] shutting down at .* 1 rooms, \d+ clients/.test(srv.log) && /\[server\] shut down in \d+ ms/.test(srv.log),
      `${scen}: el log trae el inicio del cierre y lo que tardó`);
    sql.close();
  } catch (e) {
    check(false, `${scen}: ${e?.stack ?? e}`);
  } finally {
    await cleanup(srv, data, scen);
  }
}

// --- A seat reserved just before the SIGTERM --------------------------------

async function lateSeatScenario() {
  const scen = 'R';
  const data = mkdtempSync(join(tmpdir(), `br-e2e-${scen}-`));
  let srv;
  try {
    srv = await startServer(data);
    const first = await new Client(WS).joinOrCreate('brawl', { protocol: P, critterName: 'Sergei' });
    first.onMessage('*', () => {});
    // The HTTP half of a join: a seat reserved in the same waiting room.
    const res = await fetch(`${BASE}/matchmake/joinOrCreate/brawl`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ protocol: P, critterName: 'Trunk' }),
    });
    const reservation = await res.json();
    check(res.status === 200 && !!reservation.sessionId, `${scen}: asiento reservado por HTTP (${res.status})`);
    const t0 = Date.now();
    const exiting = terminate(srv);
    await sleep(50); // the socket half lands after onBeforeShutdown
    let late;
    try {
      const r2 = await new Client(WS).consumeSeatReservation(reservation);
      late = await new Promise((resolve) => { r2.onLeave((code) => resolve(`leave:${code}`)); setTimeout(() => resolve(`sigue en ${r2.state?.phase}`), 3000); });
    } catch (e) {
      late = `rechazado: ${String(e?.message ?? e).slice(0, 80)}`;
    }
    const done = await exiting;
    const ms = Date.now() - t0;
    check(done?.code === 0 && ms < 3000, `${scen}: el cierre acaba enseguida y con 0 (${done?.code}, ${ms} ms)`);
    check(!late.startsWith('sigue'), `${scen}: al que llega tarde no se le deja sentado (${late})`);
    check(!srv.log.includes('shutdown still running'), `${scen}: sin el aviso del tope de 8 s en el log`);
  } catch (e) {
    check(false, `${scen}: ${e?.stack ?? e}`);
  } finally {
    await cleanup(srv, data, scen);
  }
}

// --- Maintenance window -----------------------------------------------------

async function maintenanceScenario() {
  const scen = 'M';
  const data = mkdtempSync(join(tmpdir(), `br-e2e-${scen}-`));
  let srv;
  try {
    srv = await startServer(data);
    check((await health()).maintenance?.stage === 'none', `${scen}: sin ventana, /health dice 'none'`);
    // Before the window: a friend's private room waiting, and a full match running.
    const host = await new Client(WS).create('brawl', { protocol: P, private: true, critterName: 'Kermit' });
    const recs = await fullRoom(await registerPlayers(4, scen));
    check(await waitUntil(() => recs[0].room.state?.phase === 'playing', 15_000), `${scen}: la partida llega a 'playing'`);

    const on = maintenanceCli(data, 'on', '--for', '5');
    check(on.code === 0 && on.out.includes('ON'), `${scen}: 'maintenance.mjs on --for 5' (${on.out.trim().split('\n')[0]})`);
    await sleep(CACHE_WAIT_MS);
    const h = await health();
    const left = (h.maintenance?.endsAt ?? 0) - Date.now();
    check(h.maintenance?.stage === 'active' && left > 4 * 60_000 && left <= 5 * 60_000, `${scen}: /health dice 'active' y acaba en ~5 min (${JSON.stringify(h.maintenance)})`);

    const quick = await tryJoin((c) => c.joinOrCreate('brawl', { protocol: P, critterName: 'Trunk' }));
    const priv = await tryJoin((c) => c.create('brawl', { protocol: P, private: true, critterName: 'Trunk' }));
    const friend = await tryJoin((c) => c.joinById(host.roomId, { protocol: P, critterName: 'Trunk' }));
    for (const [what, r] of [['partida rápida', quick], ['sala privada', priv], ['enlace de amigo', friend]]) {
      check(r.includes('maintenance_window') && /back in ~5 min|vuelve en ~5 min/.test(r), `${scen}: ${what} rechazada por mantenimiento (${r.slice(0, 70)}…)`);
    }
    check((await health()).maintenance?.rejectedJoins === 3, `${scen}: /health cuenta 3 rechazos por mantenimiento`);

    // A running match is not affected: a dropped player reconnects.
    const dropped = recs[3];
    const token = dropped.room.reconnectionToken;
    dropped.room.connection.close(4999, 'e2e drop');
    await sleep(600);
    const back = await tryJoin((c) => c.reconnect(token));
    check(back === 'ok', `${scen}: un jugador de la partida en marcha se reconecta dentro de la ventana (${back.slice(0, 60)})`);

    // A corrupt file: fail open.
    writeFileSync(join(data, 'maintenance.json'), '{');
    await sleep(CACHE_WAIT_MS);
    check((await health()).maintenance?.stage === 'invalid', `${scen}: con el fichero corrupto /health dice 'invalid'`);
    check(await tryJoin((c) => c.joinOrCreate('brawl', { protocol: P, critterName: 'Trunk' })) === 'ok', `${scen}: y el online queda abierto`);
    check((srv.log.match(/\[maintenance\] .* no es una ventana válida/g) ?? []).length === 1, `${scen}: el aviso del fichero corrupto sale una sola vez en el log`);

    const off = maintenanceCli(data, 'off');
    check(off.code === 0 && off.out.includes('OFF'), `${scen}: 'maintenance.mjs off'`);
    await sleep(CACHE_WAIT_MS);
    check((await health()).maintenance?.stage === 'none', `${scen}: /health vuelve a 'none'`);
    check(await tryJoin((c) => c.joinOrCreate('brawl', { protocol: P, critterName: 'Trunk' })) === 'ok', `${scen}: el online vuelve a abrir`);
    await host.leave();
    for (const r of recs.slice(0, 3)) await r.room.leave();
  } catch (e) {
    check(false, `${scen}: ${e?.stack ?? e}`);
  } finally {
    if (srv) await terminate(srv);
    await cleanup(srv, data, scen);
  }
}

async function guardOffScenario() {
  const scen = 'G';
  const data = mkdtempSync(join(tmpdir(), `br-e2e-${scen}-`));
  let srv;
  try {
    srv = await startServer(data);
    const on = maintenanceCli(data, 'on', '--for', '5');
    check(on.code === 0, `${scen}: 'maintenance.mjs on --for 5'`);
    const noDb = maintenanceCli(join(data, 'nope'), 'on', '--for', '5');
    check(noDb.code === 1 && noDb.out.includes('no DB'), `${scen}: se niega a escribir sin la base de datos al lado`);
    await terminate(srv);

    // The deploy: a new process, with the guard switched off, same volume.
    srv = await startServer(data, { NET_PROTOCOL_GUARD: 'off' });
    const h = await health();
    check(h.protocolGuard === 'off' && h.maintenance?.stage === 'active', `${scen}: tras reiniciar, guard 'off' y la ventana sigue 'active' (${JSON.stringify(h.maintenance)})`);
    const r = await tryJoin((c) => c.joinOrCreate('brawl', { critterName: 'Trunk' })); // no protocol at all
    check(r.includes('maintenance_window'), `${scen}: con el guard apagado el mantenimiento sigue rechazando (${r.slice(0, 60)}…)`);
    const done = await terminate(srv);
    check(done?.code === 0, `${scen}: sale con 0`);
  } catch (e) {
    check(false, `${scen}: ${e?.stack ?? e}`);
  } finally {
    await cleanup(srv, data, scen);
  }
}

for (const s of SCENARIOS) {
  console.log(`\n[e2e] === escenario ${s} (puerto ${PORT})`);
  if (s === 'R') await lateSeatScenario();
  else if (s === 'M') await maintenanceScenario();
  else if (s === 'G') await guardOffScenario();
  else await shutdownScenario(s);
}
if (failures.length) {
  console.error(`\n[e2e] ${failures.length} fallo(s)`);
  process.exit(1);
}
console.log('\n[e2e] todo OK');
process.exit(0);
