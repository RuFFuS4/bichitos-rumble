// ---------------------------------------------------------------------------
// Deterministic arena fragment generator (CLIENT copy)
// ---------------------------------------------------------------------------
// Creates irregular sector-shaped fragments for the arena floor. Both server
// and client run this with the SAME seed to produce identical layouts.
//
// KEEP IN SYNC with server/src/sim/arena-fragments.ts — the two files must
// produce byte-identical output for the same seed.
// ---------------------------------------------------------------------------

// --- Mulberry32 PRNG ---------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr: number[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// --- Types --------------------------------------------------------------

export interface FragmentDef {
  index: number;
  innerR: number;
  outerR: number;
  startAngle: number;
  endAngle: number;
  band: number;       // 0 = center (immune), 1 = inner, 2 = mid, 3 = outer
  immune: boolean;
}

export interface BatchDef {
  indices: number[];   // fragment indices that collapse in this batch
  delay: number;       // seconds before this batch starts warning
}

export interface ArenaLayout {
  seed: number;
  fragments: FragmentDef[];
  batches: BatchDef[];
  immuneRadius: number;
  maxRadius: number;
}

// --- Config (tuning values — centralised per CLAUDE.md) -----------------

export const FRAG = {
  maxRadius: 12,
  immuneRadius: 2.5,
  bands: [
    { inner: 2.5, outer: 5.5, baseSectors: 8 },
    { inner: 5.5, outer: 8.5, baseSectors: 10 },
    { inner: 8.5, outer: 12,  baseSectors: 10 },
  ],
  sectorJitter: 0.25,      // fraction of base angle width
  // Batch sizes tuned to yield ~4 batches over 28 collapsible fragments
  // (28 / 7 = 4 exact, 28 / 8 leaves a 4-piece remainder — still 4 batches).
  batchSizeMin: 7,
  batchSizeMax: 8,
  // Total collapse target ≈ 97s of a 120s match, so ~23s of endgame on the
  // immune center: 25 (first delay) + 3 (warn) + 3 × (20 + 3) = 97.
  firstBatchDelay: 25,     // seconds into playing before first collapse
  batchDelayMin: 18,
  batchDelayMax: 22,
  warningDuration: 3.0,    // seconds of blinking before disappear
  arenaHeight: 1.2,
  warningBaseRate: 4,
  warningPeakRate: 16,
};

// --- Generator ----------------------------------------------------------

export function generateArenaLayout(seed: number): ArenaLayout {
  const rand = mulberry32(seed);
  const TWO_PI = Math.PI * 2;

  const fragments: FragmentDef[] = [];
  let idx = 0;

  // Band 0: immune center (full circle)
  fragments.push({
    index: idx++,
    innerR: 0,
    outerR: FRAG.immuneRadius,
    startAngle: 0,
    endAngle: TWO_PI,
    band: 0,
    immune: true,
  });

  // Bands 1-3: collapsible sectors with angular jitter
  for (let b = 0; b < FRAG.bands.length; b++) {
    const band = FRAG.bands[b];
    const n = band.baseSectors;
    const baseAngle = TWO_PI / n;

    // Generate jittered boundary angles
    const angles: number[] = [];
    for (let s = 0; s < n; s++) {
      const jitter = (rand() - 0.5) * baseAngle * FRAG.sectorJitter;
      angles.push(s * baseAngle + jitter);
    }
    angles.sort((a, b) => a - b);

    for (let s = 0; s < n; s++) {
      const start = angles[s];
      const end = s < n - 1 ? angles[s + 1] : angles[0] + TWO_PI;

      fragments.push({
        index: idx++,
        innerR: band.inner,
        outerR: band.outer,
        startAngle: start,
        endAngle: end,
        band: b + 1,
        immune: false,
      });
    }
  }

  // --- Collapse schedule: outer band first → inner ---------------------

  const byBand = new Map<number, number[]>();
  for (const f of fragments) {
    if (f.immune) continue;
    if (!byBand.has(f.band)) byBand.set(f.band, []);
    byBand.get(f.band)!.push(f.index);
  }
  for (const indices of byBand.values()) shuffle(indices, rand);

  const collapseOrder = [
    ...(byBand.get(3) ?? []),
    ...(byBand.get(2) ?? []),
    ...(byBand.get(1) ?? []),
  ];

  const batches: BatchDef[] = [];
  let cursor = 0;
  let isFirst = true;
  while (cursor < collapseOrder.length) {
    const size = Math.min(
      Math.floor(rand() * (FRAG.batchSizeMax - FRAG.batchSizeMin + 1)) + FRAG.batchSizeMin,
      collapseOrder.length - cursor,
    );
    const delay = isFirst ? FRAG.firstBatchDelay
      : FRAG.batchDelayMin + rand() * (FRAG.batchDelayMax - FRAG.batchDelayMin);
    batches.push({ indices: collapseOrder.slice(cursor, cursor + size), delay });
    cursor += size;
    isFirst = false;
  }

  return { seed, fragments, batches, immuneRadius: FRAG.immuneRadius, maxRadius: FRAG.maxRadius };
}

// --- Point-in-fragment --------------------------------------------------

const TWO_PI = Math.PI * 2;

function normalizeAngle(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

export function pointInFragment(x: number, z: number, f: FragmentDef): boolean {
  const r = Math.sqrt(x * x + z * z);
  if (r < f.innerR || r > f.outerR) return false;
  if (f.immune) return true; // full circle

  const angle = normalizeAngle(Math.atan2(z, x));
  const start = normalizeAngle(f.startAngle);
  const end   = normalizeAngle(f.endAngle);

  return start <= end
    ? (angle >= start && angle <= end)
    : (angle >= start || angle <= end);
}

export function isPointOnArena(
  x: number, z: number,
  fragments: FragmentDef[], alive: boolean[],
): boolean {
  for (let i = 0; i < fragments.length; i++) {
    if (!alive[i]) continue;
    if (pointInFragment(x, z, fragments[i])) return true;
  }
  return false;
}
