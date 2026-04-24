// ---------------------------------------------------------------------------
// Local stats collector — schema v2
// ---------------------------------------------------------------------------
//
// Lightweight per-critter + global counters persisted in localStorage. This
// module intentionally knows NOTHING about gameplay — it imports zero game
// code, receives only plain strings / enums, and exposes a tiny counter API.
//
// Schema v2 adds the fields required by BADGES_DESIGN.md (fastest win,
// hits received, lives left, no-death / no-hit / comeback counters, plus
// an `unlockedBadges` cache and a transient `recentlyUnlocked` slot for the
// end-screen notification).
//
// Migration v1 → v2 is soft: if localStorage holds a v1 blob, we preserve
// all existing counters (picks / wins / losses / falls / totalMatches /
// totalWins) and initialise the new fields to their empty values. No one
// loses progress on the jump.
//
// Persistence: single JSON blob under STORAGE_KEY_V2. Failures (quota,
// private mode, disabled storage) are swallowed — stats silently become
// a no-op.
//
// This file is side-effect only on import (calls loadStats() once). No
// gameplay-path code runs here.
// ---------------------------------------------------------------------------

const STORAGE_KEY_V1 = 'br-stats-v1';
const STORAGE_KEY_V2 = 'br-stats-v2';

export type Outcome = 'win' | 'lose';

/** Per-critter counters. */
export interface CritterStats {
  /** Times the critter was chosen at match start. */
  picks: number;
  /** Times the match ended with this critter as the player's win. */
  wins: number;
  /** Times the match ended with this critter as the player's loss. */
  losses: number;
  /** Times the critter (as the player) fell off the arena. */
  falls: number;

  // v2 ------------------------------------------------------------------

  /** Fastest win time in seconds with this critter, or null if never won. */
  fastestWinSecs: number | null;
  /** Cumulative headbutts received (all matches) with this critter. */
  hitsReceived: number;
  /** Cumulative lives left at win moments (sum, not average). Divide by
   *  `wins` if an average is needed. */
  livesLeftSum: number;
}

/** Full persisted stats snapshot. */
export interface Stats {
  /** Schema version — bumped on every breaking change to the shape. */
  version: 2;
  /** Per-critter counters keyed by critter name (e.g. "Sergei"). */
  byCritter: Record<string, CritterStats>;
  /** Total matches the player has started. */
  totalMatches: number;
  /** Total matches the player has won. */
  totalWins: number;

  // v2 ------------------------------------------------------------------

  /** Global fastest win time in seconds (across all critters), or null. */
  fastestWinSecs: number | null;
  /** Wins where the player never took a headbutt. */
  noHitWins: number;
  /** Wins where the player finished with all 3 lives (never died). */
  noDeathWins: number;
  /** Wins where the player finished with only 1 life left (comeback). */
  comebackWins: number;
  /** Badge IDs the player has permanently unlocked. */
  unlockedBadges: string[];
  /** Transient slot for the end-screen toast — badge id of the most recent
   *  unlock, or null once the toast is dismissed. Not stable for long-term
   *  reads; use unlockedBadges for the authoritative list. */
  recentlyUnlocked: string | null;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

function emptyStats(): Stats {
  return {
    version: 2,
    byCritter: {},
    totalMatches: 0,
    totalWins: 0,
    fastestWinSecs: null,
    noHitWins: 0,
    noDeathWins: 0,
    comebackWins: 0,
    unlockedBadges: [],
    recentlyUnlocked: null,
  };
}

function emptyCritter(): CritterStats {
  return {
    picks: 0,
    wins: 0,
    losses: 0,
    falls: 0,
    fastestWinSecs: null,
    hitsReceived: 0,
    livesLeftSum: 0,
  };
}

let current: Stats = emptyStats();

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/** Best-effort migration from v1 → v2 blob. Preserves every counter v1 had. */
function migrateV1ToV2(v1: unknown): Stats {
  const s = emptyStats();
  if (!v1 || typeof v1 !== 'object') return s;
  const r = v1 as Record<string, unknown>;

  if (typeof r.totalMatches === 'number') s.totalMatches = r.totalMatches;
  if (typeof r.totalWins === 'number') s.totalWins = r.totalWins;

  const byCritter = (r.byCritter as Record<string, unknown>) ?? {};
  for (const [name, raw] of Object.entries(byCritter)) {
    const src = (raw ?? {}) as Record<string, unknown>;
    const c = emptyCritter();
    if (typeof src.picks === 'number') c.picks = src.picks;
    if (typeof src.wins === 'number') c.wins = src.wins;
    if (typeof src.losses === 'number') c.losses = src.losses;
    if (typeof src.falls === 'number') c.falls = src.falls;
    s.byCritter[name] = c;
  }
  return s;
}

/** Parse a raw v2 blob, filling missing fields with defaults. */
function parseV2(raw: unknown): Stats {
  const s = emptyStats();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;

  if (typeof r.totalMatches === 'number') s.totalMatches = r.totalMatches;
  if (typeof r.totalWins === 'number') s.totalWins = r.totalWins;
  if (typeof r.fastestWinSecs === 'number' || r.fastestWinSecs === null)
    s.fastestWinSecs = r.fastestWinSecs as number | null;
  if (typeof r.noHitWins === 'number') s.noHitWins = r.noHitWins;
  if (typeof r.noDeathWins === 'number') s.noDeathWins = r.noDeathWins;
  if (typeof r.comebackWins === 'number') s.comebackWins = r.comebackWins;
  if (Array.isArray(r.unlockedBadges))
    s.unlockedBadges = (r.unlockedBadges as unknown[]).filter(
      (x): x is string => typeof x === 'string',
    );
  if (typeof r.recentlyUnlocked === 'string' || r.recentlyUnlocked === null)
    s.recentlyUnlocked = r.recentlyUnlocked as string | null;

  const byCritter = (r.byCritter as Record<string, unknown>) ?? {};
  for (const [name, raw2] of Object.entries(byCritter)) {
    const src = (raw2 ?? {}) as Record<string, unknown>;
    const c = emptyCritter();
    if (typeof src.picks === 'number') c.picks = src.picks;
    if (typeof src.wins === 'number') c.wins = src.wins;
    if (typeof src.losses === 'number') c.losses = src.losses;
    if (typeof src.falls === 'number') c.falls = src.falls;
    if (typeof src.fastestWinSecs === 'number' || src.fastestWinSecs === null)
      c.fastestWinSecs = src.fastestWinSecs as number | null;
    if (typeof src.hitsReceived === 'number') c.hitsReceived = src.hitsReceived;
    if (typeof src.livesLeftSum === 'number') c.livesLeftSum = src.livesLeftSum;
    s.byCritter[name] = c;
  }
  return s;
}

/**
 * Read persisted stats from localStorage and install them as the current
 * in-memory snapshot. Safe to call multiple times. Returns the loaded stats.
 *
 * Preference order:
 *   1. v2 blob under STORAGE_KEY_V2 — parse normally.
 *   2. v1 blob under STORAGE_KEY_V1 — migrate to v2, write the v2 blob
 *      back so future loads skip the migration (v1 stays as-is as a
 *      just-in-case until the user clears site data).
 *   3. No persisted blob — start empty.
 *
 * On any parse / storage error the in-memory state is reset to an empty v2
 * stats object and the error is swallowed.
 */
function loadStats(): Stats {
  try {
    const v2raw = localStorage.getItem(STORAGE_KEY_V2);
    if (v2raw) {
      current = parseV2(JSON.parse(v2raw));
      return current;
    }
    const v1raw = localStorage.getItem(STORAGE_KEY_V1);
    if (v1raw) {
      current = migrateV1ToV2(JSON.parse(v1raw));
      save(); // persist as v2 so the next load is a clean v2 read
      return current;
    }
    current = emptyStats();
  } catch {
    current = emptyStats();
  }
  return current;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(current));
  } catch {
    // Quota exceeded or storage disabled — silently drop.
  }
}

function ensure(name: string): CritterStats {
  let c = current.byCritter[name];
  if (!c) {
    c = emptyCritter();
    current.byCritter[name] = c;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Public recording API (counters — call from gameplay side)
// ---------------------------------------------------------------------------

/** Call when a match begins — increments the picked critter's counter. */
export function recordPick(critterName: string): void {
  ensure(critterName).picks++;
  current.totalMatches++;
  save();
}

/** Call when a match ends for the player — win or lose (draws are ignored). */
export function recordOutcome(critterName: string, outcome: Outcome): void {
  const c = ensure(critterName);
  if (outcome === 'win') {
    c.wins++;
    current.totalWins++;
  } else {
    c.losses++;
  }
  save();
}

/** Call when the player falls off the arena (not for bots). */
export function recordFall(critterName: string): void {
  ensure(critterName).falls++;
  save();
}

/**
 * Call when the local player wins a match. Records the completion time and
 * lives-left for the badges that care (Speedrun Belt / Iron Will /
 * Arena Apex). Does NOT double-book the win itself — pair with recordOutcome
 * for that.
 *
 * @param critterName which critter won
 * @param durationSecs match duration in seconds (countdown end → match end)
 * @param livesLeft lives remaining at the moment of victory (0..maxLives)
 * @param hitsThisMatch headbutts the player received this match (for
 *                      Untouchable / Pain Tolerance aggregation)
 */
export function recordWin(
  critterName: string,
  durationSecs: number,
  livesLeft: number,
  hitsThisMatch: number,
): void {
  const c = ensure(critterName);

  // Fastest win (per-critter + global)
  if (c.fastestWinSecs === null || durationSecs < c.fastestWinSecs) {
    c.fastestWinSecs = durationSecs;
  }
  if (current.fastestWinSecs === null || durationSecs < current.fastestWinSecs) {
    current.fastestWinSecs = durationSecs;
  }

  c.livesLeftSum += livesLeft;
  // Accumulate lifetime hits received, per-critter. Used by the Pain
  // Tolerance badge (sum across critters ≥ PAIN_TOLERANCE_MIN_HITS).
  // We only add on wins — recording hits from losses would require an
  // extra hook and the badge copy specifies "after taking N+ headbutts"
  // which most naturally reads as "over your winning runs".
  c.hitsReceived += hitsThisMatch;

  // Win-type tallies (Iron Will / Untouchable / Arena Apex)
  if (hitsThisMatch === 0) current.noHitWins++;
  if (livesLeft >= 3) current.noDeathWins++;
  if (livesLeft <= 1) current.comebackWins++;

  save();
}

// ---------------------------------------------------------------------------
// Public read API (read from UI / badges system)
// ---------------------------------------------------------------------------

/** Read-only snapshot of the current in-memory stats. Do not mutate. */
export function getStats(): Stats {
  return current;
}

/**
 * Add newly-unlocked badge IDs to the persistent list and set the
 * `recentlyUnlocked` slot to the first one (so the end-screen can
 * surface a single toast). No-op for IDs already unlocked.
 */
export function addUnlockedBadges(ids: string[]): void {
  if (ids.length === 0) return;
  const set = new Set(current.unlockedBadges);
  let first: string | null = null;
  for (const id of ids) {
    if (!set.has(id)) {
      set.add(id);
      if (first === null) first = id;
    }
  }
  current.unlockedBadges = Array.from(set);
  if (first !== null) current.recentlyUnlocked = first;
  save();
}

/** Clear the recently-unlocked slot. Call after the toast is dismissed. */
export function clearRecentlyUnlocked(): void {
  if (current.recentlyUnlocked === null) return;
  current.recentlyUnlocked = null;
  save();
}

// ---------------------------------------------------------------------------
// Auto-load on module import so callers don't have to remember.
// ---------------------------------------------------------------------------
loadStats();
