// ---------------------------------------------------------------------------
// shutdown-check — a server shutdown voids the running matches, never scores
// ---------------------------------------------------------------------------
//
// No network: real BrawlRoom rooms on the in-process matchMaker, with
// verified seats seeded the way onJoin/tickWaiting leave them, and the same
// matchMaker.gracefullyShutdown() that SIGTERM triggers (Server's handler,
// minus process.exit). A temporary DB, set before db.ts opens it.
//
//   cd server && node --import tsx tests/shutdown-check.mts
//
// Rooms, all shut down together:
//   playing      public, 2 verified + 2 bots → 1 'server_shutdown' row, no stats
//   countdown    same, cut before GO         → 1 row with duration 0, no stats
//   private      private room, playing       → 1 row, no stats
//   waiting      1 verified seat             → no row, no stats
//   timeout      ended by endMatch('timeout') BEFORE the shutdown: still
//                scored (win and loss), and the shutdown adds nothing
//   throws       endMatch throws inside onBeforeShutdown: the room must
//                still disconnect and dispose (else the shutdown hangs)
// And /api/metrics/retention counts the voided matches, but leaves them out
// of the average length.
//
// Before the fix the first three wrote a loss (and reset the streak) for
// every verified seat through onDispose → endMatch('all_humans_left').
// Exit 0 when everything holds, 1 otherwise.
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'br-shutdown-'));
process.env.DATA_DIR = DATA; // before db.ts opens the sqlite file on import

const { matchMaker } = await import('colyseus');
const { BrawlRoom } = await import('../src/BrawlRoom.ts');
const db = await import('../src/db.ts');
const { default: Database } = await import('better-sqlite3');

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`[shutdown-check] ${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

await matchMaker.setup();
matchMaker.defineRoomType('brawl', BrawlRoom);

let nick = 0;
function verifiedPlayer(): string {
  nick++;
  const row = db.registerOrClaimPlayer(`chk${nick}`, `${nick}`.padEnd(32, 'x')) as { id: string };
  return row.id;
}

// A room with `humans` verified seats (+ bots up to 4 when it starts).
async function seededRoom(opts: { humans: number; private?: boolean; start: boolean }) {
  const listing = await matchMaker.createRoom('brawl', opts.private ? { private: true } : {});
  const room: any = matchMaker.getLocalRoomById(listing.roomId);
  const ids: string[] = [];
  for (let i = 0; i < opts.humans; i++) {
    const sid = `s${listing.roomId}${i}`;
    const id = verifiedPlayer();
    ids.push(id);
    room.state.players.set(sid, room.buildPlayerSchema(sid, 'Sergei', [0, 5 - 3 * i], false));
    room.internal.set(sid, { onlinePlayerId: id, killsVsHumansThisMatch: 0 });
  }
  if (opts.start) {
    while (room.state.players.size < 4) room.spawnBot();
    room.transitionToCountdown(); // measures humansVerifiedAtStart
  }
  return { room, ids, roomId: listing.roomId as string };
}

const playing = await seededRoom({ humans: 2, start: true });
playing.room.state.phase = 'playing';
playing.room.playingStartedAtMs = Date.now() - 30_000;

const countdown = await seededRoom({ humans: 2, start: true });

const privateRoom = await seededRoom({ humans: 2, private: true, start: true });
privateRoom.room.state.phase = 'playing';
privateRoom.room.playingStartedAtMs = Date.now() - 10_000;

const waiting = await seededRoom({ humans: 1, start: false });

const timeout = await seededRoom({ humans: 2, start: true });
timeout.room.state.phase = 'playing';
timeout.room.playingStartedAtMs = Date.now() - 60_000;
const [winnerSid] = [...timeout.room.state.players.keys()];
timeout.room.endMatch('timeout', winnerSid);

const throws = await seededRoom({ humans: 2, start: true });
throws.room.state.phase = 'playing';
throws.room.endMatch = () => { throw new Error('endMatch failed on purpose'); };

// The whole player_stats row, updated_at included (a separate read-only
// connection; the DB runs in WAL mode).
const sql = new Database(join(DATA, 'br-online.sqlite'), { readonly: true });
const statsRow = sql.prepare('SELECT * FROM player_stats WHERE player_id = ?');
const statsOf = (ids: string[]) => JSON.stringify(ids.map((id) => statsRow.get(id) ?? null));
const snapshot = {
  playing: statsOf(playing.ids),
  countdown: statsOf(countdown.ids),
  private: statsOf(privateRoom.ids),
  waiting: statsOf(waiting.ids),
};

// /health's live.matches: playing, countdown, private and throws are in a
// match; waiting and the timeout-ended room are not.
check(BrawlRoom.liveMatches() === 4, `liveMatches cuenta las 4 salas en partida (${BrawlRoom.liveMatches()})`);

// The shutdown itself. Colyseus waits for every room to dispose, with no
// timeout of its own: a room that never disconnects would hang here.
const done = await Promise.race([
  matchMaker.gracefullyShutdown().then(() => true),
  new Promise<false>((r) => setTimeout(() => r(false), 10_000)),
]);
check(done, 'gracefullyShutdown terminó (todas las salas se cerraron, también la que lanza)');
check(BrawlRoom.liveMatches() === 0, `tras el cierre no queda ninguna partida viva (${BrawlRoom.liveMatches()})`);

const allRows = sql.prepare('SELECT end_reason, winner_player_id, duration_ms, private_room FROM matches').all() as any[];
const byReason = (r: string) => allRows.filter((row) => row.end_reason === r);

for (const [name, r] of [['playing', playing], ['countdown', countdown], ['private', privateRoom], ['waiting', waiting]] as const) {
  check(statsOf(r.ids) === snapshot[name], `${name}: player_stats sin cambios`);
}
const shutdownRows = byReason('server_shutdown');
check(shutdownRows.length === 3, `3 filas server_shutdown (playing, countdown, private): ${shutdownRows.length}`);
check(shutdownRows.every((row) => row.winner_player_id === null), 'server_shutdown sin ganador');
check(shutdownRows.some((row) => row.duration_ms === 0), 'la de countdown dura 0');
check(shutdownRows.filter((row) => row.private_room === 1).length === 1, 'una de ellas es la sala privada');
check(byReason('all_humans_left').length === 0 && byReason('opponent_left').length === 0, 'ninguna fila all_humans_left ni opponent_left');

// Regression: a normal end still scores.
const t = timeout.ids.map((id) => db.getPlayerStats(id));
check(byReason('timeout').length === 1, 'la partida terminada por tiempo tiene su fila');
check(t[0]?.wins_online === 1 && t[0]?.matches_online === 1, `timeout: el ganador suma victoria (${JSON.stringify(t[0])})`);
check(t[1]?.wins_online === 0 && t[1]?.matches_online === 1, `timeout: el otro suma derrota (${JSON.stringify(t[1])})`);

// Metrics: voided matches count as matches, but not in the average length
// (theirs is cut short): only the 60 s timeout match is averaged.
const metrics = db.getRetentionMetrics();
check(metrics.totalMatches === 4, `métricas: 4 partidas en total, anuladas incluidas (${metrics.totalMatches})`);
check(Math.abs(metrics.avgDurationMs - 60_000) < 1_000, `métricas: la duración media no cuenta las anuladas (${metrics.avgDurationMs} ms)`);

sql.close();
// Best effort: on Windows db.ts still holds the file open (EBUSY); the OS
// temp dir takes care of it.
try { rmSync(DATA, { recursive: true, force: true }); } catch { /* EBUSY */ }
if (failures.length) {
  console.error(`[shutdown-check] ${failures.length} fallo(s)`);
  process.exit(1);
}
console.log('[shutdown-check] todo OK');
process.exit(0);
