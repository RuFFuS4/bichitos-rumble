// ---------------------------------------------------------------------------
// Local stats collector
// ---------------------------------------------------------------------------
//
// Lightweight per-critter counters persisted in localStorage. This module
// intentionally knows NOTHING about gameplay — it imports zero game code,
// receives only plain strings / enums, and exposes a tiny counter API.
//
// Scope for this sprint: collect only. No HUD integration, no dashboards.
// A later task can read `getStats()` and paint whatever UI is needed.
//
// Persistence: single JSON blob under STORAGE_KEY. Failures (quota, private
// mode, disabled storage) are swallowed — stats silently become a no-op.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'br-stats-v1';

export type Outcome = 'win' | 'lose';

export interface CritterStats {
  /** Times the critter was chosen at match start. */
  picks: number;
  /** Times the match ended with this critter as the player's win. */
  wins: number;
  /** Times the match ended with this critter as the player's loss. */
  losses: number;
  /** Times the critter (as the player) fell off the arena. */
  falls: number;
}

export interface Stats {
  /** Per-critter counters keyed by critter name (e.g. "Rojo"). */
  byCritter: Record<string, CritterStats>;
  /** Total matches the player has started. */
  totalMatches: number;
  /** Total matches the player has won. */
  totalWins: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

function empty(): Stats {
  return {
    byCritter: {},
    totalMatches: 0,
    totalWins: 0,
  };
}

function emptyCritter(): CritterStats {
  return { picks: 0, wins: 0, losses: 0, falls: 0 };
}

let current: Stats = empty();

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/**
 * Read persisted stats from localStorage and install them as the current
 * in-memory snapshot. Safe to call multiple times. Returns the loaded stats.
 * On any error (parse, disabled storage) the in-memory state is reset to
 * an empty stats object and the error is swallowed.
 */
export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stats>;
      current = {
        byCritter: parsed.byCritter ?? {},
        totalMatches: parsed.totalMatches ?? 0,
        totalWins: parsed.totalWins ?? 0,
      };
    } else {
      current = empty();
    }
  } catch {
    current = empty();
  }
  return current;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
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
// Public recording API
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

/** Read-only snapshot of the current in-memory stats. Do not mutate. */
export function getStats(): Stats {
  return current;
}

// Auto-load on module import so callers don't have to remember.
loadStats();
