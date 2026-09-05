// Medición del generador de arena (docs/ARENA_V2.md §1.2). Solo lectura:
// importa el generador REAL del cliente y barre 5000 semillas. Ejecutar:
//   node --experimental-strip-types scripts/research/arena-stats.mts
// Base del futuro CLI scripts/arena-layout.mjs (terreno v2, fase 0).

// Análisis numérico del generador real (copia cliente). Solo lectura.
import { generateArenaLayout, isPointOnArena, FRAG } from '../../src/arena-fragments.ts';

const N = 5000;
const TWO_PI = Math.PI * 2;
const area = (f: any) => 0.5 * (f.outerR ** 2 - f.innerR ** 2) * (f.endAngle - f.startAngle);

const fragCount: Record<number, number> = {};
const batchCount: Record<string, number> = {};
let patternB = 0, labMisclass = 0;
const totals: number[] = [];
const firstCollapse: number[] = [];
const delays: number[] = [];
const minSide: number[] = [];
const runsFirstBatchA: number[] = [];
let spanMin = Infinity, spanMax = -Infinity;
const sampleT = [30, 45, 60, 75, 90, 100, 110];
const aliveFracA: number[][] = sampleT.map(() => []);
const aliveFracB: number[][] = sampleT.map(() => []);
let gapMisses = 0, gapSamples = 0;
const seedsTotal: Array<[number, number]> = [];

for (let seed = 1; seed <= N; seed++) {
  const L = generateArenaLayout(seed);
  fragCount[L.fragments.length] = (fragCount[L.fragments.length] ?? 0) + 1;
  const bandSeq = L.batches.map(b => L.fragments[b.indices[0]].band).join('');
  const isB = bandSeq === '321321';
  if (isB) patternB++;
  if (!isB && L.batches.length >= 6) labMisclass++;
  batchCount[`${isB ? 'B' : 'A'}:${L.batches.length}`] = (batchCount[`${isB ? 'B' : 'A'}:${L.batches.length}`] ?? 0) + 1;

  // timeline: collapse time of batch i
  let t = 0; const collapseAt: number[] = [];
  for (const b of L.batches) { t += b.delay + FRAG.warningDuration; collapseAt.push(t); }
  totals.push(t); firstCollapse.push(collapseAt[0]);
  seedsTotal.push([seed, t]);
  for (let i = 1; i < L.batches.length; i++) delays.push(L.batches[i].delay);

  // alive area fraction at sample times
  const totalArea = Math.PI * FRAG.maxRadius ** 2;
  sampleT.forEach((ts, k) => {
    let alive = 0;
    const dead = new Set<number>();
    L.batches.forEach((b, i) => { if (collapseAt[i] <= ts) b.indices.forEach(x => dead.add(x)); });
    for (const f of L.fragments) if (!dead.has(f.index)) alive += area(f);
    (isB ? aliveFracB : aliveFracA)[k].push(alive / totalArea);
  });

  // sector spans (relative to base)
  for (let b = 1; b <= 3; b++) {
    const fs = L.fragments.filter(f => f.band === b);
    const base = TWO_PI / fs.length;
    for (const f of fs) { const rel = (f.endAngle - f.startAngle) / base; spanMin = Math.min(spanMin, rel); spanMax = Math.max(spanMax, rel); }
  }

  if (isB) {
    minSide.push(Math.min(...L.batches.map(b => b.indices.length)));
  } else {
    // contiguity of first batch (half of band 3): count cyclic runs of consecutive indices
    const b3 = L.fragments.filter(f => f.band === 3).map(f => f.index);
    const first = new Set(L.batches[0].indices);
    let runs = 0;
    for (let i = 0; i < b3.length; i++) {
      const cur = first.has(b3[i]); const prev = first.has(b3[(i - 1 + b3.length) % b3.length]);
      if (cur && !prev) runs++;
    }
    runsFirstBatchA.push(runs);
  }

  // coverage: random points r<maxRadius with all alive
  if (seed <= 200) {
    const alive = L.fragments.map(() => true);
    for (let k = 0; k < 500; k++) {
      const r = Math.sqrt(Math.random()) * (FRAG.maxRadius - 1e-6);
      const a = Math.random() * TWO_PI;
      gapSamples++;
      if (!isPointOnArena(Math.cos(a) * r, Math.sin(a) * r, L.fragments, alive)) gapMisses++;
    }
  }
}

const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { min: +s[0].toFixed(2), p10: +s[Math.floor(s.length * 0.1)].toFixed(2), mean: +mean.toFixed(2), p90: +s[Math.floor(s.length * 0.9)].toFixed(2), max: +s[s.length - 1].toFixed(2) };
};
const hist = (xs: number[]) => { const h: Record<number, number> = {}; for (const x of xs) h[x] = (h[x] ?? 0) + 1; return h; };

console.log('N seeds', N);
console.log('fragment count hist', fragCount);
console.log('pattern B share', (patternB / N).toFixed(3), ' | lab heuristic (>=6 → B) misclassifies A-with-6-batches:', (labMisclass / N).toFixed(3));
console.log('batches hist (pattern:count)', batchCount);
console.log('first collapse (s)', stat(firstCollapse));
console.log('total collapse (s)', stat(totals));
console.log('non-first batch delays (s)', stat(delays));
console.log('sector span rel. to base', { min: spanMin.toFixed(3), max: spanMax.toFixed(3) });
console.log('pattern B: min batch size hist', hist(minSide));
console.log('pattern A: cyclic runs in first half-batch of band 3 (1 = contiguous)', hist(runsFirstBatchA));
console.log('coverage misses (all alive, r<12):', gapMisses, '/', gapSamples);
console.log('alive area fraction A by t', Object.fromEntries(sampleT.map((t, k) => [t, stat(aliveFracA[k]).mean])));
console.log('alive area fraction B by t', Object.fromEntries(sampleT.map((t, k) => [t, stat(aliveFracB[k]).mean])));
const areas = { immune: Math.PI * 2.5 ** 2, b1: Math.PI * (5.5 ** 2 - 2.5 ** 2), b2: Math.PI * (8.5 ** 2 - 5.5 ** 2), b3: Math.PI * (12 ** 2 - 8.5 ** 2), total: Math.PI * 144 };
console.log('band areas (u²)', Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, +v.toFixed(1)])));
console.log('mid-radius arc per base sector (u): b1@4.0 n=8:', (4 * TWO_PI / 8).toFixed(2), ' b2@7.0 n=10:', (7 * TWO_PI / 10).toFixed(2), ' b3@10.25 n=10:', (10.25 * TWO_PI / 10).toFixed(2));
// example layouts
for (const s of [1, 2, 3, 501, 502, 503]) {
  const L = generateArenaLayout(s);
  const seq = L.batches.map(b => `${L.fragments[b.indices[0]].band}x${b.indices.length}@+${b.delay.toFixed(1)}`).join(' ');
  console.log(`seed ${s}: frags=${L.fragments.length} batches=${L.batches.length} [${seq}]`);
}
