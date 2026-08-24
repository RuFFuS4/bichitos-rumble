// ---------------------------------------------------------------------------
// Bichitos Rumble — persistent store for Online Belts
// ---------------------------------------------------------------------------
//
// Backs the 5 online-only belts (Throne, Flash, Ironclad, Slayer, Hot Streak).
// Zero-login identity: every player registers a nickname once and gets an
// opaque token (random UUID) that lives in their localStorage. The token is
// stored on the server as a SHA-256 hash so stealing the DB dump is useless.
//
// Runs on Railway with a persistent volume mounted at $DATA_DIR (default
// `./data` for local dev). One file, SQLite, better-sqlite3 — synchronous
// and absurdly fast for the traffic a jam game sees.
//
// Public surface is deliberately small; `api.ts` consumes it and nothing
// else talks to SQL directly.
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const DB_PATH = `${DATA_DIR}/br-online.sqlite`;

// Ensure the directory exists before SQLite tries to open the file —
// Railway mounts volumes empty on first deploy.
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
// WAL gives us concurrent reads while a writer is active — rankings can be
// queried freely while match results flow in without blocking each other.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema — idempotent. Runs every boot; safe to re-run.
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id              TEXT PRIMARY KEY,
    nickname_norm   TEXT NOT NULL UNIQUE,   -- lowercase, trimmed — lookup key
    nickname_display TEXT NOT NULL,         -- original case
    token_hash      TEXT NOT NULL,          -- sha256 of client-supplied token
    created_at      INTEGER NOT NULL,
    last_seen       INTEGER NOT NULL
  );
`);

// 2026-04-29 identity refinement — add device-stable identity_id
// column. Idempotent migration: only adds if missing. Rows from
// before the migration have NULL identity_id, which is fine —
// `registerOrClaimPlayer` handles the null case by falling back to
// token-only auth (legacy behaviour).
const playerCols = db.prepare("PRAGMA table_info(players)").all() as Array<{ name: string }>;
const hasIdentityId = playerCols.some(c => c.name === 'identity_id');
if (!hasIdentityId) {
  db.exec("ALTER TABLE players ADD COLUMN identity_id TEXT");
  console.log('[db] migrated players.identity_id (added column)');
}

// 2026-08-24 H4 retención — código de recuperación cross-device. Guarda
// `salt$sha256(salt:code)` (nunca el código en claro). NULL = el jugador
// nunca ha generado código. Migración idempotente, mismo patrón que
// identity_id.
const hasRecoveryHash = playerCols.some(c => c.name === 'recovery_code_hash');
if (!hasRecoveryHash) {
  db.exec("ALTER TABLE players ADD COLUMN recovery_code_hash TEXT");
  console.log('[db] migrated players.recovery_code_hash (added column)');
}

db.exec(`

  CREATE TABLE IF NOT EXISTS player_stats (
    player_id           TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    wins_online         INTEGER NOT NULL DEFAULT 0,
    matches_online      INTEGER NOT NULL DEFAULT 0,
    fastest_win_ms      INTEGER,
    lives_left_sum      INTEGER NOT NULL DEFAULT 0,   -- sum(lives_left_on_win)
    kills_vs_humans     INTEGER NOT NULL DEFAULT 0,
    current_streak      INTEGER NOT NULL DEFAULT 0,
    longest_streak      INTEGER NOT NULL DEFAULT 0,
    -- one row per critter won with — Nomad / per-critter derived stats future-proof
    critters_won_json   TEXT NOT NULL DEFAULT '[]',
    updated_at          INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_stats_wins         ON player_stats(wins_online DESC);
  CREATE INDEX IF NOT EXISTS idx_stats_fastest      ON player_stats(fastest_win_ms ASC);
  CREATE INDEX IF NOT EXISTS idx_stats_kills        ON player_stats(kills_vs_humans DESC);
  CREATE INDEX IF NOT EXISTS idx_stats_long_streak  ON player_stats(longest_streak DESC);
`);

// 2026-08-24 H4 retención — historial de partidas server-side. Una fila
// por partida terminada (endMatch), incluyendo las que acabaron durante
// el countdown (duration_ms = 0). Alimenta GET /api/metrics/retention.
// winner_player_id solo se rellena si el ganador era un humano verificado
// que seguía en su asiento (rage-quit/bot-takeover → NULL); el endpoint
// de métricas NUNCA lo expone — queda para análisis interno con acceso
// directo a la BD.
db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id               TEXT PRIMARY KEY,
    started_at       INTEGER NOT NULL,       -- epoch ms del inicio de 'playing' (= ended_at si nunca llegó)
    ended_at         INTEGER NOT NULL,       -- epoch ms de endMatch
    duration_ms      INTEGER NOT NULL,       -- 0 si terminó antes de 'playing'
    humans_at_start  INTEGER NOT NULL,       -- asientos humanos (no-bot) al arrancar el countdown
    humans_verified  INTEGER NOT NULL,       -- de esos, cuántos con identidad online verificada
    end_reason       TEXT NOT NULL,          -- eliminated | timeout | draw | opponent_left
    winner_player_id TEXT,                   -- players.id del ganador verificado, o NULL
    winner_critter   TEXT NOT NULL DEFAULT '',
    private_room     INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_matches_ended_at ON matches(ended_at);
`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function nowMs(): number {
  return Date.now();
}

function normaliseNickname(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Nickname validation. Keeps it simple: 3-16 chars, letters/digits/underscore/
 * dash, and a tiny banned list to stop obvious zero-effort trolling. This is
 * NOT a full moderation layer — flag-and-report can come post-jam.
 */
const NICKNAME_RE = /^[a-zA-Z0-9_\-]{3,16}$/;
const BANNED = new Set(['admin', 'root', 'anonymous', 'null', 'undefined', 'guest']);
export function validateNickname(raw: string): { ok: true; nick: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'nickname_required' };
  const trimmed = raw.trim();
  if (trimmed.length < 3) return { ok: false, reason: 'too_short' };
  if (trimmed.length > 16) return { ok: false, reason: 'too_long' };
  if (!NICKNAME_RE.test(trimmed)) return { ok: false, reason: 'invalid_chars' };
  if (BANNED.has(trimmed.toLowerCase())) return { ok: false, reason: 'reserved' };
  return { ok: true, nick: trimmed };
}

// ---------------------------------------------------------------------------
// Public API — consumed by api.ts and BrawlRoom
// ---------------------------------------------------------------------------

export interface PlayerRow {
  id: string;
  nickname: string;         // display form
  isNew: boolean;
}

/**
 * Register a new player or reclaim an existing nickname if the caller proves
 * ownership via the token OR the device identity_id. Returns the canonical
 * player row (with display nickname). Rejects only if the nickname is taken
 * by a different device (neither token NOR identity_id matches).
 *
 * 2026-04-29 identity refinement — Rafa's complaint was "if I clear my
 * cookies and try to use my old nickname I get blocked from my own row".
 * The fix is the identity_id second key: even if the token gets rotated,
 * the identity_id stays put, and we let the same browser-device reclaim.
 * If BOTH are gone (e.g. completely fresh browser), the legacy
 * `nickname_taken` rejection kicks in — that's the right behaviour for
 * "another person on a different device tries to grab my nickname".
 */
export function registerOrClaimPlayer(
  rawNick: string,
  rawToken: string,
  rawIdentityId?: string,
): PlayerRow | { error: string } {
  const v = validateNickname(rawNick);
  if (!v.ok) return { error: v.reason };
  const nickNorm = normaliseNickname(v.nick);

  if (typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 128) {
    return { error: 'invalid_token' };
  }
  const tokenHash = sha256(rawToken);
  const identityId =
    typeof rawIdentityId === 'string' && rawIdentityId.length >= 16 && rawIdentityId.length <= 128
      ? rawIdentityId
      : null;
  const now = nowMs();

  const existing = db
    .prepare('SELECT id, nickname_display, token_hash, identity_id FROM players WHERE nickname_norm = ?')
    .get(nickNorm) as
    | { id: string; nickname_display: string; token_hash: string; identity_id: string | null }
    | undefined;

  if (existing) {
    const tokenMatches = existing.token_hash === tokenHash;
    const identityMatches =
      identityId !== null && existing.identity_id !== null && existing.identity_id === identityId;
    if (!tokenMatches && !identityMatches) {
      return { error: 'nickname_taken' };
    }
    // Same token OR same device identity → same owner. Bump last_seen,
    // and if either piece of identity is missing on the stored row,
    // backfill it so subsequent reclaims work either way (token or id).
    db.prepare(
      'UPDATE players SET last_seen = ?, token_hash = ?, identity_id = COALESCE(identity_id, ?) WHERE id = ?',
    ).run(now, tokenHash, identityId, existing.id);
    return { id: existing.id, nickname: existing.nickname_display, isNew: false };
  }

  // Fresh registration. Store both the token hash and the identity_id
  // so subsequent reclaims succeed via either path.
  const id = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO players (id, nickname_norm, nickname_display, token_hash, identity_id, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, nickNorm, v.nick, tokenHash, identityId, now, now);
    db.prepare(
      'INSERT INTO player_stats (player_id, updated_at) VALUES (?, ?)',
    ).run(id, now);
  });
  tx();
  return { id, nickname: v.nick, isNew: true };
}

/**
 * Verify a (playerId, token) pair. Used by BrawlRoom on auth to ensure the
 * client claiming to be "player X" actually owns the stored token hash.
 */
export function verifyPlayer(playerId: string, rawToken: string): boolean {
  if (!playerId || typeof rawToken !== 'string') return false;
  const row = db.prepare('SELECT token_hash FROM players WHERE id = ?').get(playerId) as
    | { token_hash: string }
    | undefined;
  if (!row) return false;
  return row.token_hash === sha256(rawToken);
}

export interface MatchResultInput {
  playerId: string;
  won: boolean;
  durationMs: number;
  livesLeft: number;          // on win: lives remaining; on loss: 0
  killsVsHumans: number;      // kills this match that were humans (never bots)
  critterName: string;
}

/**
 * Record the outcome of one online match for one player. Authoritative —
 * called from BrawlRoom when the match ends. Updates stats + streak in a
 * single transaction so leaderboards stay consistent.
 *
 * Returns the post-update stats row (useful for downstream belt-awarding).
 */
export function recordMatchResult(input: MatchResultInput): void {
  const { playerId, won, durationMs, livesLeft, killsVsHumans, critterName } = input;
  const now = nowMs();

  const tx = db.transaction(() => {
    const row = db.prepare(
      'SELECT * FROM player_stats WHERE player_id = ?',
    ).get(playerId) as
      | {
          wins_online: number;
          matches_online: number;
          fastest_win_ms: number | null;
          lives_left_sum: number;
          kills_vs_humans: number;
          current_streak: number;
          longest_streak: number;
          critters_won_json: string;
        }
      | undefined;

    if (!row) {
      // Defensive: should never happen since registerOrClaimPlayer inserts
      // the stats row. If it did, create a zeroed one on the fly.
      db.prepare('INSERT INTO player_stats (player_id, updated_at) VALUES (?, ?)').run(playerId, now);
    }

    const prev = row ?? {
      wins_online: 0,
      matches_online: 0,
      fastest_win_ms: null,
      lives_left_sum: 0,
      kills_vs_humans: 0,
      current_streak: 0,
      longest_streak: 0,
      critters_won_json: '[]',
    };

    const winsOnline = prev.wins_online + (won ? 1 : 0);
    const matchesOnline = prev.matches_online + 1;
    const livesLeftSum = prev.lives_left_sum + (won ? Math.max(0, livesLeft) : 0);
    const killsVsHumansTotal = prev.kills_vs_humans + Math.max(0, killsVsHumans);
    const fastestWin = won
      ? prev.fastest_win_ms === null
        ? durationMs
        : Math.min(prev.fastest_win_ms, durationMs)
      : prev.fastest_win_ms;
    const currentStreak = won ? prev.current_streak + 1 : 0;
    const longestStreak = Math.max(prev.longest_streak, currentStreak);

    // Track unique critters won with (for Hot Streak / future Nomad-online belt).
    let critters: string[];
    try {
      const parsed = JSON.parse(prev.critters_won_json);
      critters = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      critters = [];
    }
    if (won && critterName && !critters.includes(critterName)) critters.push(critterName);

    db.prepare(`
      UPDATE player_stats SET
        wins_online      = ?,
        matches_online   = ?,
        fastest_win_ms   = ?,
        lives_left_sum   = ?,
        kills_vs_humans  = ?,
        current_streak   = ?,
        longest_streak   = ?,
        critters_won_json = ?,
        updated_at       = ?
      WHERE player_id = ?
    `).run(
      winsOnline,
      matchesOnline,
      fastestWin,
      livesLeftSum,
      killsVsHumansTotal,
      currentStreak,
      longestStreak,
      JSON.stringify(critters),
      now,
      playerId,
    );
  });
  tx();
}

// ---------------------------------------------------------------------------
// Match history — H4 retención (2026-08-24)
// ---------------------------------------------------------------------------

export interface MatchRecordInput {
  /** Epoch ms del inicio de 'playing'; null si la partida murió antes. */
  startedAtMs: number | null;
  endedAtMs: number;
  durationMs: number;
  humansAtStart: number;
  humansVerified: number;
  endReason: string;
  winnerPlayerId: string | null;
  winnerCritter: string;
  privateRoom: boolean;
}

/**
 * Persiste UNA partida terminada en `matches`. Igual de robusta que
 * recordMatchResult: el caller (BrawlRoom.endMatch) la envuelve en
 * try/catch — un fallo de disco/BD jamás tumba el room ni corta el
 * flujo de fin de partida.
 */
export function recordMatch(input: MatchRecordInput): void {
  db.prepare(`
    INSERT INTO matches (
      id, started_at, ended_at, duration_ms,
      humans_at_start, humans_verified, end_reason,
      winner_player_id, winner_critter, private_room
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.startedAtMs ?? input.endedAtMs,
    input.endedAtMs,
    Math.max(0, Math.round(input.durationMs)),
    Math.max(0, input.humansAtStart),
    Math.max(0, input.humansVerified),
    input.endReason,
    input.winnerPlayerId,
    input.winnerCritter,
    input.privateRoom ? 1 : 0,
  );
}

export interface RetentionMetrics {
  totalMatches: number;
  /** Partidas por día natural (UTC) de los últimos 14 días. Solo días con
   *  al menos una partida — los vacíos se omiten. */
  byDay: Array<{ day: string; matches: number }>;
  /** Media de duración sobre partidas que llegaron a 'playing' (>0 ms). */
  avgDurationMs: number;
  /** % de partidas con ≥2 humanos en el arranque. */
  pctWithTwoPlusHumans: number;
  /** % de partidas jugadas en sala privada. */
  pctPrivateRooms: number;
}

/**
 * Agregados de retención para GET /api/metrics/retention. SOLO datos
 * agregados — nada de player_ids ni nicknames (ver decisión de no-auth
 * documentada en api.ts).
 */
export function getRetentionMetrics(): RetentionMetrics {
  const now = nowMs();
  const since = now - 14 * 24 * 60 * 60 * 1000;

  const total = (db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n;

  const byDay = (db.prepare(`
    SELECT strftime('%Y-%m-%d', ended_at / 1000, 'unixepoch') AS day, COUNT(*) AS matches
    FROM matches WHERE ended_at >= ?
    GROUP BY day ORDER BY day ASC
  `).all(since) as Array<{ day: string; matches: number }>);

  const avgRow = db.prepare(
    'SELECT AVG(duration_ms) AS avg_ms FROM matches WHERE duration_ms > 0',
  ).get() as { avg_ms: number | null };

  const pctRow = db.prepare(`
    SELECT
      AVG(CASE WHEN humans_at_start >= 2 THEN 100.0 ELSE 0.0 END) AS pct_multi,
      AVG(CASE WHEN private_room = 1 THEN 100.0 ELSE 0.0 END)     AS pct_private
    FROM matches
  `).get() as { pct_multi: number | null; pct_private: number | null };

  const round1 = (v: number | null) => v === null ? 0 : Math.round(v * 10) / 10;
  return {
    totalMatches: total,
    byDay,
    avgDurationMs: Math.round(avgRow.avg_ms ?? 0),
    pctWithTwoPlusHumans: round1(pctRow.pct_multi),
    pctPrivateRooms: round1(pctRow.pct_private),
  };
}

// ---------------------------------------------------------------------------
// Recovery codes — identidad cross-device sin login (H4 retención)
// ---------------------------------------------------------------------------
//
// El jugador con identidad online puede generar UN código legible
// (BICHO-XXXX-XXXX) que le permite recuperar su fila (playerId + nick)
// desde otro dispositivo. En BD solo vive `salt$sha256(salt:code)` — un
// dump de la BD no sirve para robar cuentas.
//
// Decisiones de seguridad (razonadas):
//  · El código NO se invalida al usarse. Es la llave duradera del
//    jugador ("apúntalo en un papel"): invalidarlo en cada uso obligaría
//    a regenerarlo y re-apuntarlo tras cada recuperación, y el jugador
//    puede ya no tener acceso al dispositivo original para generar otro.
//    Riesgo aceptado: un código filtrado da acceso hasta que se rote —
//    mitigado por entropía alta, rate-limit en /identity/recover y la
//    posibilidad de rotar desde cualquier dispositivo con sesión.
//  · Generar un código nuevo ROTA (invalida) el anterior — solo hay una
//    columna de hash. Así el jugador siempre puede "cambiar la
//    cerradura" si sospecha que su código se filtró.
//  · Alfabeto sin ambigüedades (sin 0/O/1/I/L) para que apuntarlo a mano
//    no falle. 8 chars sobre 31 símbolos ≈ 2^39.6 de entropía; con el
//    rate-limit de 5 intentos/min/IP un brute-force online es inviable.
//  · Comparación con timingSafeEqual — sin oráculos de timing.

const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 símbolos, sin 0/O/1/I/L

function generateRecoveryCodeString(): string {
  const block = (n: number) =>
    Array.from({ length: n }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
  return `BICHO-${block(4)}-${block(4)}`;
}

/** Normaliza el código para hashear/comparar: mayúsculas y solo [A-Z0-9]
 *  (los guiones y espacios que el jugador teclee dan igual). */
function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(code: string, salt: string): string {
  return sha256(`${salt}:${normalizeRecoveryCode(code)}`);
}

/**
 * Genera (o rota) el código de recuperación de un jugador autenticado
 * con su (playerId, token) actuales. Devuelve el código EN CLARO una
 * única vez — el server solo guarda el hash salteado.
 */
export function createRecoveryCode(
  playerId: string,
  rawToken: string,
): { code: string } | { error: string } {
  if (!verifyPlayer(playerId, rawToken)) return { error: 'invalid_credentials' };
  const code = generateRecoveryCodeString();
  const salt = randomBytes(8).toString('hex');
  db.prepare('UPDATE players SET recovery_code_hash = ?, last_seen = ? WHERE id = ?')
    .run(`${salt}$${hashRecoveryCode(code, salt)}`, nowMs(), playerId);
  return { code };
}

/**
 * Recupera una identidad con (nickname + código). Si el hash cuadra,
 * ROTA el device token al que envía el cliente nuevo (mismo contrato que
 * registerOrClaimPlayer: el cliente genera el token, aquí se guarda su
 * hash) y hace backfill del identity_id si la fila no tenía. El
 * identity_id existente NO se machaca: así el dispositivo original
 * conserva su vía de reclamo por identidad aunque el token haya rotado —
 * ambos dispositivos quedan operativos.
 *
 * Error único 'recovery_failed' tanto para "nick no existe" como para
 * "código incorrecto": no regala información de qué mitad falló.
 */
export function recoverWithCode(
  rawNick: string,
  rawCode: string,
  rawToken: string,
  rawIdentityId?: string,
): { id: string; nickname: string } | { error: string } {
  const v = validateNickname(rawNick);
  if (!v.ok) return { error: v.reason };
  if (typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 128) {
    return { error: 'invalid_token' };
  }
  const normCode = typeof rawCode === 'string' ? normalizeRecoveryCode(rawCode) : '';
  if (normCode.length < 8 || normCode.length > 32) return { error: 'recovery_failed' };

  const row = db.prepare(
    'SELECT id, nickname_display, recovery_code_hash FROM players WHERE nickname_norm = ?',
  ).get(normaliseNickname(v.nick)) as
    | { id: string; nickname_display: string; recovery_code_hash: string | null }
    | undefined;
  if (!row || !row.recovery_code_hash) return { error: 'recovery_failed' };

  const sep = row.recovery_code_hash.indexOf('$');
  if (sep <= 0) return { error: 'recovery_failed' };
  const salt = row.recovery_code_hash.slice(0, sep);
  const storedHash = row.recovery_code_hash.slice(sep + 1);
  const candidate = hashRecoveryCode(rawCode, salt);
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: 'recovery_failed' };

  const identityId =
    typeof rawIdentityId === 'string' && rawIdentityId.length >= 16 && rawIdentityId.length <= 128
      ? rawIdentityId
      : null;
  db.prepare(
    'UPDATE players SET token_hash = ?, identity_id = COALESCE(identity_id, ?), last_seen = ? WHERE id = ?',
  ).run(sha256(rawToken), identityId, nowMs(), row.id);
  return { id: row.id, nickname: row.nickname_display };
}

// ---------------------------------------------------------------------------
// Leaderboard queries — one per belt. Each returns the top N holders.
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  value: number;             // the metric itself
  secondaryValue?: number;   // e.g. matches_played for ratio belts
}

export type OnlineBeltId =
  | 'throne-online'
  | 'flash-online'
  | 'ironclad-online'
  | 'slayer-online'
  | 'hot-streak-online';

const TOP_N = 10;
const IRONCLAD_MIN_MATCHES = 5;  // avoid "1 match 3 lives = perfect ratio" farming

export function getLeaderboard(belt: OnlineBeltId): LeaderboardEntry[] {
  switch (belt) {
    case 'throne-online':
      return db.prepare(`
        SELECT p.id, p.nickname_display, s.wins_online
        FROM player_stats s JOIN players p ON p.id = s.player_id
        WHERE s.wins_online > 0
        ORDER BY s.wins_online DESC, s.updated_at ASC
        LIMIT ?
      `).all(TOP_N).map((r: any) => ({
        playerId: r.id, nickname: r.nickname_display, value: r.wins_online,
      }));

    case 'flash-online':
      return db.prepare(`
        SELECT p.id, p.nickname_display, s.fastest_win_ms
        FROM player_stats s JOIN players p ON p.id = s.player_id
        WHERE s.fastest_win_ms IS NOT NULL
        ORDER BY s.fastest_win_ms ASC, s.updated_at ASC
        LIMIT ?
      `).all(TOP_N).map((r: any) => ({
        playerId: r.id, nickname: r.nickname_display, value: r.fastest_win_ms,
      }));

    case 'ironclad-online':
      // ratio = lives_left_sum / matches_online, gated by a minimum
      // matches threshold so a single lucky match doesn't dominate.
      return db.prepare(`
        SELECT p.id, p.nickname_display, s.lives_left_sum, s.matches_online,
               CAST(s.lives_left_sum AS REAL) / s.matches_online AS ratio
        FROM player_stats s JOIN players p ON p.id = s.player_id
        WHERE s.matches_online >= ?
        ORDER BY ratio DESC, s.updated_at ASC
        LIMIT ?
      `).all(IRONCLAD_MIN_MATCHES, TOP_N).map((r: any) => ({
        playerId: r.id, nickname: r.nickname_display,
        value: r.ratio, secondaryValue: r.matches_online,
      }));

    case 'slayer-online':
      return db.prepare(`
        SELECT p.id, p.nickname_display, s.kills_vs_humans
        FROM player_stats s JOIN players p ON p.id = s.player_id
        WHERE s.kills_vs_humans > 0
        ORDER BY s.kills_vs_humans DESC, s.updated_at ASC
        LIMIT ?
      `).all(TOP_N).map((r: any) => ({
        playerId: r.id, nickname: r.nickname_display, value: r.kills_vs_humans,
      }));

    case 'hot-streak-online':
      return db.prepare(`
        SELECT p.id, p.nickname_display, s.longest_streak
        FROM player_stats s JOIN players p ON p.id = s.player_id
        WHERE s.longest_streak > 0
        ORDER BY s.longest_streak DESC, s.updated_at ASC
        LIMIT ?
      `).all(TOP_N).map((r: any) => ({
        playerId: r.id, nickname: r.nickname_display, value: r.longest_streak,
      }));
  }
}

/**
 * The single current belt holder per belt (top of the leaderboard).
 * Used to detect "belt changed hands" after a match update.
 */
export function getBeltHolder(belt: OnlineBeltId): LeaderboardEntry | null {
  const top = getLeaderboard(belt);
  return top[0] ?? null;
}

/** Snapshot of all 5 belt holders at one point in time. Pairs with
 *  `diffBeltHolders()` so the BrawlRoom can detect belt changes after
 *  a match-result write. */
export type BeltHolders = Record<OnlineBeltId, LeaderboardEntry | null>;

export function getAllBeltHolders(): BeltHolders {
  return {
    'throne-online':    getBeltHolder('throne-online'),
    'flash-online':     getBeltHolder('flash-online'),
    'ironclad-online':  getBeltHolder('ironclad-online'),
    'slayer-online':    getBeltHolder('slayer-online'),
    'hot-streak-online': getBeltHolder('hot-streak-online'),
  };
}

/**
 * Compute which belts changed hands between two holder snapshots. A belt
 * "changed" if:
 *   - it was unheld and now has a holder (first winner), OR
 *   - the playerId of the holder is different from before.
 * Returns the list of changed belts with the NEW holder (the one to toast).
 */
export function diffBeltHolders(
  before: BeltHolders,
  after: BeltHolders,
): Array<{ belt: OnlineBeltId; holder: LeaderboardEntry }> {
  const out: Array<{ belt: OnlineBeltId; holder: LeaderboardEntry }> = [];
  const belts = Object.keys(after) as OnlineBeltId[];
  for (const belt of belts) {
    const prev = before[belt];
    const curr = after[belt];
    if (!curr) continue;               // no holder now → nothing to toast
    if (!prev || prev.playerId !== curr.playerId) {
      out.push({ belt, holder: curr });
    }
  }
  return out;
}

/** Stats summary for a single player (used by the client to show "your ranks"). */
export function getPlayerStats(playerId: string): {
  wins_online: number;
  matches_online: number;
  fastest_win_ms: number | null;
  lives_left_sum: number;
  kills_vs_humans: number;
  current_streak: number;
  longest_streak: number;
} | null {
  const row = db.prepare(`
    SELECT wins_online, matches_online, fastest_win_ms, lives_left_sum,
           kills_vs_humans, current_streak, longest_streak
    FROM player_stats WHERE player_id = ?
  `).get(playerId);
  return (row as any) ?? null;
}
