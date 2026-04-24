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
import { createHash, randomUUID } from 'crypto';
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
 * ownership via the token. Returns the canonical player row (with display
 * nickname). Rejects if the nickname is taken by someone else.
 */
export function registerOrClaimPlayer(rawNick: string, rawToken: string): PlayerRow | { error: string } {
  const v = validateNickname(rawNick);
  if (!v.ok) return { error: v.reason };
  const nickNorm = normaliseNickname(v.nick);

  if (typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 128) {
    return { error: 'invalid_token' };
  }
  const tokenHash = sha256(rawToken);
  const now = nowMs();

  const existing = db
    .prepare('SELECT id, nickname_display, token_hash FROM players WHERE nickname_norm = ?')
    .get(nickNorm) as { id: string; nickname_display: string; token_hash: string } | undefined;

  if (existing) {
    if (existing.token_hash !== tokenHash) {
      return { error: 'nickname_taken' };
    }
    // Same token → same owner, bump last_seen and return.
    db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, existing.id);
    return { id: existing.id, nickname: existing.nickname_display, isNew: false };
  }

  // Fresh registration.
  const id = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO players (id, nickname_norm, nickname_display, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, nickNorm, v.nick, tokenHash, now, now);
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
