// ---------------------------------------------------------------------------
// Badges — WWE-belt-style local achievements
// ---------------------------------------------------------------------------
//
// Implementation of Fase 1 from BADGES_DESIGN.md.
//
// Scope of this file:
//   - Declare the 16-badge catalog (9 per-critter Champions + 7 globals).
//   - Expose `checkBadgeUnlocks(stats)` — a pure function that returns the
//     IDs of badges whose condition is met but which haven't been unlocked
//     yet. The caller is expected to pipe that through
//     `addUnlockedBadges()` from stats.ts (which persists + sets the
//     `recentlyUnlocked` slot for the end-screen toast).
//   - Expose read helpers (`getBadgeById`, `getAllBadges`,
//     `getUnlockedBadges`, `isUnlocked`) for UI code to bind against.
//
// Out of scope (future phases):
//   - UI overlay (toast on end-screen — Fase 3 in BADGES_DESIGN).
//   - "Hall of Belts" grid on character-select (Fase 4).
//   - The generated PNG sprites per badge (Fase 5).
//
// Condition functions are pure — they take a Stats snapshot and return a
// boolean. That keeps this file trivially testable and cheap to call on
// every `recordWin` without any side effects.
// ---------------------------------------------------------------------------

import type { Stats } from './stats';

// ---------------------------------------------------------------------------
// Thresholds — exposed so ops can tune them without touching each entry.
// ---------------------------------------------------------------------------

/** Wins needed with a single critter to unlock their Champion belt. */
const CHAMPION_WINS_THRESHOLD = 5;
/** Match duration (seconds) at or below which the Speedrun Belt triggers. */
const SPEEDRUN_MAX_SECS = 30;
/** Cumulative wins for the Survivor belt. */
const SURVIVOR_WINS_THRESHOLD = 20;
/** Hits received (cumulative across all critters) at or above which
 *  Pain Tolerance triggers — provided there's also been at least one win. */
const PAIN_TOLERANCE_MIN_HITS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BadgeCategory = 'champion' | 'global';

export interface BadgeDef {
  /** Stable identifier used in `Stats.unlockedBadges`. kebab-case. */
  id: string;
  /** 'champion' → one per critter (9 total).
   *  'global'   → cross-critter trophy (7 total). */
  category: BadgeCategory;
  /** Human-facing name for the belt. */
  name: string;
  /** Short description surfaced in tooltips and the Hall of Belts. */
  description: string;
  /** Placeholder emoji shown in the toast + Hall of Belts until the real
   *  PNG assets land (Phase 5). Chosen for silhouette legibility at the
   *  small sizes the UI uses. Swap to SVG masks later if desired. */
  icon: string;
  /** Only for `category: 'champion'` — which critter this belongs to. */
  critter?: string;
  /** Pure predicate — true when the player's stats meet the criteria. */
  condition: (stats: Stats) => boolean;
}

// ---------------------------------------------------------------------------
// Champion belts — one per playable critter (9 in total).
// ---------------------------------------------------------------------------
//
// Each Champion is "win N matches with this critter" (N = CHAMPION_WINS_THRESHOLD).
// Names use the habitat flavour from BADGES_DESIGN.md §A.

interface ChampionSpec {
  critter: string;
  flavour: string;   // "Jungle Champion" / "Swamp Champion" / …
  icon: string;      // placeholder emoji until Phase 5 art lands
}

const CHAMPIONS: ChampionSpec[] = [
  { critter: 'Sergei',    flavour: 'Jungle Champion',    icon: '🦍' },
  { critter: 'Trunk',     flavour: 'Savanna Champion',   icon: '🐘' },
  { critter: 'Kurama',    flavour: 'Kitsune Champion',   icon: '🦊' },
  { critter: 'Shelly',    flavour: 'Beachside Champion', icon: '🐢' },
  { critter: 'Kermit',    flavour: 'Swamp Champion',     icon: '🐸' },
  { critter: 'Sihans',    flavour: 'Desert Champion',    icon: '🦫' },
  { critter: 'Kowalski',  flavour: 'Tundra Champion',    icon: '🐧' },
  { critter: 'Cheeto',    flavour: 'Apex Champion',      icon: '🐯' },
  { critter: 'Sebastian', flavour: 'Tide Champion',      icon: '🦀' },
];

function championBadges(): BadgeDef[] {
  return CHAMPIONS.map(({ critter, flavour, icon }) => ({
    id: `${critter.toLowerCase()}-champion`,
    category: 'champion' as const,
    name: `${critter} — ${flavour}`,
    description: `Win ${CHAMPION_WINS_THRESHOLD} matches with ${critter}.`,
    icon,
    critter,
    condition: (s: Stats) => (s.byCritter[critter]?.wins ?? 0) >= CHAMPION_WINS_THRESHOLD,
  }));
}

// ---------------------------------------------------------------------------
// Global trophies — cross-critter (7 in total).
// ---------------------------------------------------------------------------

const GLOBAL_BADGES: BadgeDef[] = [
  {
    id: 'speedrun-belt',
    category: 'global',
    name: 'Speedrun Belt',
    description: `Win a match in ${SPEEDRUN_MAX_SECS} seconds or less.`,
    icon: '⚡',
    condition: (s) =>
      s.fastestWinSecs !== null && s.fastestWinSecs <= SPEEDRUN_MAX_SECS,
  },
  {
    id: 'iron-will',
    category: 'global',
    name: 'Iron Will',
    description: 'Win a match without losing a single life.',
    icon: '🛡️',
    condition: (s) => s.noDeathWins >= 1,
  },
  {
    id: 'untouchable',
    category: 'global',
    name: 'Untouchable',
    description: 'Win a match without taking a single headbutt.',
    icon: '👻',
    condition: (s) => s.noHitWins >= 1,
  },
  {
    id: 'survivor',
    category: 'global',
    name: 'Survivor',
    description: `Reach ${SURVIVOR_WINS_THRESHOLD} total wins across the roster.`,
    icon: '🏔️',
    condition: (s) => s.totalWins >= SURVIVOR_WINS_THRESHOLD,
  },
  {
    id: 'globetrotter',
    category: 'global',
    name: 'Globetrotter',
    description: 'Win at least one match with every playable critter.',
    icon: '🌍',
    condition: (s) => {
      // Every critter in CHAMPIONS must have at least 1 win.
      for (const { critter } of CHAMPIONS) {
        if ((s.byCritter[critter]?.wins ?? 0) < 1) return false;
      }
      return true;
    },
  },
  {
    id: 'arena-apex',
    category: 'global',
    name: 'Arena Apex',
    description: 'Win a match with only one life left (comeback victory).',
    icon: '🔥',
    condition: (s) => s.comebackWins >= 1,
  },
  {
    id: 'pain-tolerance',
    category: 'global',
    name: 'Pain Tolerance',
    description: `Win at least one match after taking ${PAIN_TOLERANCE_MIN_HITS}+ headbutts.`,
    icon: '💪',
    // Coarse heuristic: cumulative hits received ≥ threshold AND ≥1 total
    // win. Phase 2 may refine with per-match tracking if the bar feels off.
    condition: (s) => {
      if (s.totalWins < 1) return false;
      let totalHits = 0;
      for (const stats of Object.values(s.byCritter)) totalHits += stats.hitsReceived;
      return totalHits >= PAIN_TOLERANCE_MIN_HITS;
    },
  },
];

// ---------------------------------------------------------------------------
// Public catalog
// ---------------------------------------------------------------------------

/** Full list of every badge the game ships with. 9 champion + 7 global. */
export const BADGE_CATALOG: readonly BadgeDef[] = Object.freeze([
  ...championBadges(),
  ...GLOBAL_BADGES,
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Given the current stats, return the IDs of badges whose condition is
 * met AND which are NOT already marked unlocked. Pure, no side effects.
 *
 * Recommended call site: inside a post-match stats update (after
 * `recordOutcome('win', …)` + `recordWin(…)`), pipe the result through
 * `addUnlockedBadges(ids)` from stats.ts.
 */
export function checkBadgeUnlocks(stats: Stats): string[] {
  const already = new Set(stats.unlockedBadges);
  const newly: string[] = [];
  for (const badge of BADGE_CATALOG) {
    if (already.has(badge.id)) continue;
    if (badge.condition(stats)) newly.push(badge.id);
  }
  return newly;
}

/** Single-lookup helper. Returns null for unknown IDs. */
export function getBadgeById(id: string): BadgeDef | null {
  return BADGE_CATALOG.find((b) => b.id === id) ?? null;
}

/** Stable copy of the catalog, for UI code that wants to iterate. */
export function getAllBadges(): readonly BadgeDef[] {
  return BADGE_CATALOG;
}

/** Badges the player has already unlocked (resolved from the stats blob). */
export function getUnlockedBadges(stats: Stats): BadgeDef[] {
  const set = new Set(stats.unlockedBadges);
  return BADGE_CATALOG.filter((b) => set.has(b.id));
}

/** True when the given badge id appears in Stats.unlockedBadges. */
export function isUnlocked(stats: Stats, id: string): boolean {
  return stats.unlockedBadges.includes(id);
}
