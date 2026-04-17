// ---------------------------------------------------------------------------
// Deterministic arena fragment generator (SERVER copy)
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
  // Each band has a sector-count range. The PRNG picks a value in [min, max]
  // per band per match — small density variations keep repeat plays fresh
  // without changing the overall cake-slice feel.
  bands: [
    { inner: 2.5, outer: 5.5, sectorMin: 7, sectorMax: 9  }, // band 1 inner
    { inner: 5.5, outer: 8.5, sectorMin: 9, sectorMax: 11 }, // band 2 mid
    { inner: 8.5, outer: 12,  sectorMin: 9, sectorMax: 11 }, // band 3 outer
  ],
  sectorJitter: 0.28,      // fraction of base angle width
  // Collapse schedule: outer band first, then mid, then inner. Each band
  // may optionally split into 2 batches (probability below) so match length
  // can vary between 4 and 6 batches. Target is still ≈97s full collapse.
  splitProbability: {
    3: 1.0,  // outer always splits (too big for one batch visually)
    2: 0.5,  // mid splits half the time
    1: 0.3,  // inner splits occasionally
  },
  /** Probability a given match uses the axis-split macro pattern instead
   *  of the outer→inner band sweep. Keeps macro feel fresh between plays. */
  patternBProbability: 0.45,
  // Timing model: distribute remaining delays adaptively so total collapse
  // duration fits a constant budget regardless of batch count.
  firstBatchDelay: 25,
  targetTotalDuration: 96, // seconds to full collapse (≈ 24s endgame)
  delayJitter: 0.2,        // ±20% jitter around the computed mean
  minBatchDelay: 8,        // hard floor so batches are never too close
  warningDuration: 3.0,
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

  // Bands 1-3: collapsible sectors with angular jitter. Sector count is
  // randomised per band so each match has a slightly different density.
  for (let b = 0; b < FRAG.bands.length; b++) {
    const band = FRAG.bands[b];
    const range = band.sectorMax - band.sectorMin + 1;
    const n = band.sectorMin + Math.floor(rand() * range);
    const baseAngle = TWO_PI / n;

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

  // --- Collapse schedule ------------------------------------------------
  // Two macro patterns, selected per match by the seed so repeat plays
  // don't all feel identical:
  //
  //   Pattern A (≈55%): band-aligned sweep outer → inner. A band may
  //     split into two batches (see splitProbability). Classic, steady.
  //
  //   Pattern B (≈45%): axis-split sweep. Pick a random world axis; the
  //     arena is divided into two halves by that axis. Each half is
  //     collapsed OUTER → INNER as its own mini-sweep. Produces an
  //     asymmetric "one-half-eaten-first" feel that is clearly legible
  //     (no island states — sideA's band-1 is still attached to the
  //     immune center, and the immune center itself never falls).
  //
  // Both patterns keep every batch band-aligned WITHIN a side, so the
  // alive/dead state stays visually legible at every moment.

  const byBand = new Map<number, number[]>();
  for (const f of fragments) {
    if (f.immune) continue;
    if (!byBand.has(f.band)) byBand.set(f.band, []);
    byBand.get(f.band)!.push(f.index);
  }
  for (const indices of byBand.values()) shuffle(indices, rand);

  const usePatternB = rand() < FRAG.patternBProbability;

  const groups: number[][] = [];

  if (usePatternB) {
    // Pattern B: axis-split. Pick axis, split each band into two halves
    // by the signed angle delta from the axis (mod 2π).
    const axis = rand() * TWO_PI;
    const TWO = TWO_PI;
    const splitByAxis = (indices: number[]): [number[], number[]] => {
      const a: number[] = [];
      const b: number[] = [];
      for (const i of indices) {
        const f = fragments[i];
        const mid = (f.startAngle + f.endAngle) / 2;
        let delta = ((mid - axis) % TWO + TWO) % TWO;
        if (delta < Math.PI) a.push(i); else b.push(i);
      }
      return [a, b];
    };
    const [aOuter, bOuter] = splitByAxis(byBand.get(3) ?? []);
    const [aMid,   bMid]   = splitByAxis(byBand.get(2) ?? []);
    const [aInner, bInner] = splitByAxis(byBand.get(1) ?? []);

    // 50/50 coin flip: do sideA first or sideB first. More variety.
    const aFirst = rand() < 0.5;
    const [firstOuter, firstMid, firstInner, secondOuter, secondMid, secondInner] =
      aFirst
        ? [aOuter, aMid, aInner, bOuter, bMid, bInner]
        : [bOuter, bMid, bInner, aOuter, aMid, aInner];

    // 6 batches: each batch is ONE side of ONE band. ~4-6 pieces each.
    // Any zero-length slice is skipped (defensive — shouldn't happen with
    // current sector counts).
    for (const g of [firstOuter, firstMid, firstInner, secondOuter, secondMid, secondInner]) {
      if (g.length > 0) groups.push(g);
    }
  } else {
    // Pattern A: band-aligned outer → inner, with optional intra-band split.
    for (const bandIdx of [3, 2, 1]) {
      const indices = byBand.get(bandIdx) ?? [];
      if (indices.length === 0) continue;
      const splitProb = FRAG.splitProbability[bandIdx as 1 | 2 | 3] ?? 0;
      const shouldSplit = indices.length >= 6 && rand() < splitProb;
      if (shouldSplit) {
        const mid = Math.floor(indices.length / 2);
        const cut = mid + (rand() < 0.5 ? 0 : 1);
        groups.push(indices.slice(0, cut));
        groups.push(indices.slice(cut));
      } else {
        groups.push(indices);
      }
    }
  }

  // Adaptive delays so total collapse duration ≈ FRAG.targetTotalDuration
  // regardless of batch count (4-6). Without this, more batches would
  // over-run the match length.
  //   totalWarnings = nBatches * warningDuration
  //   budgetForDelays = target - firstBatchDelay - totalWarnings
  //   meanDelay = budgetForDelays / (nBatches - 1)   ← applied to non-first
  //   actualDelay = meanDelay * (1 ± jitter), clamped to >= minBatchDelay
  const nBatches = groups.length;
  const delayBudget =
    FRAG.targetTotalDuration - FRAG.firstBatchDelay - nBatches * FRAG.warningDuration;
  const meanDelay = nBatches > 1
    ? Math.max(FRAG.minBatchDelay, delayBudget / (nBatches - 1))
    : 0;

  const batches: BatchDef[] = groups.map((indices, i) => {
    if (i === 0) return { indices, delay: FRAG.firstBatchDelay };
    const jitter = 1 + (rand() - 0.5) * 2 * FRAG.delayJitter;
    const delay = Math.max(FRAG.minBatchDelay, meanDelay * jitter);
    return { indices, delay };
  });

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
