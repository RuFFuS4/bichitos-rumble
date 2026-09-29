#!/usr/bin/env node
// ---------------------------------------------------------------------------
// attrib-analyze.mjs — merge scripts/attrib-probe.mjs shard outputs and
// attribute every fall: per-critter elimination with 95 % CI, the fall-
// cause table, attacker × victim matrices, and the paired Δ of a what-if.
//
//   node scripts/attrib-analyze.mjs .tmp/attrib/base      (dir of shard*.json, or files)
//   node scripts/attrib-analyze.mjs .tmp/attrib/base --window=0.75 --out=.tmp/attrib/w075.json
//   node scripts/attrib-analyze.mjs .tmp/attrib/base --compare=.tmp/attrib/whatif   (same plan)
//
// Primary cause of a fall (first rule that matches):
//   1. All-in: victim of Sebastian's All-in (or his own miss → self:allin-miss)
//   2. floor:  the spot it last stood on died (collapse, or a Sinkhole hole)
//   3. the MOST RECENT significant impulse within --window s (def 1.5):
//      dash hit, headbutt, K, L, grip, Steel Shell reflect/bounce, or the
//      victim's own headbutt recoil (self:recoil); significant = not a
//      nudge and |Δv| ≥ --min-mag (def 3 u/s), grips always
//   4. pull:   inside an enemy Sinkhole zone in the last 1 s
//   5. nudge:  collision push (most recent within the window)
//   6. self:ownJ — own J cast in the last 1 s
//   7. alone  (flags: on enemy ice / confused / stunned / slowed)
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    window: { type: 'string', default: '1.5' },
    'min-mag': { type: 'string', default: '3' },
    out: { type: 'string', default: '.tmp/attrib/summary.json' },
    compare: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});
let W = Number(opt.window);
const MINMAG = Number(opt['min-mag']);
const ALL = ['Sergei', 'Trunk', 'Kurama', 'Shelly', 'Kermit', 'Sihans', 'Kowalski', 'Cheeto', 'Sebastian'];

function load(paths) {
  const files = [];
  for (const p of paths) {
    if (statSync(p).isDirectory()) for (const f of readdirSync(p)) { if (f.endsWith('.json')) files.push(join(p, f)); }
    else files.push(p);
  }
  const matches = []; const failures = []; const configs = [];
  for (const f of files) {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    if (!d.matches) continue;
    matches.push(...d.matches); failures.push(...(d.failures ?? [])); configs.push(d.config);
  }
  matches.sort((a, b) => a.idx - b.idx);
  return { matches, failures, configs, files };
}

function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = k / n; const z2 = z * z;
  const c = (p + z2 / (2 * n)) / (1 + z2 / n);
  const h = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [c - h, c + h];
}
const pct = (x) => (100 * x).toFixed(1);

const SIG_KINDS = new Set(['dash', 'headbutt', 'J', 'K', 'L', 'grip', 'shell', 'allin', 'recoil']);
function attribute(f) {
  if (f.trig === 'fireAllInResolution') {
    if (f.allin?.self) return { group: 'self:allin-miss', kind: 'self', by: null, ab: 'All-in miss' };
    return { group: 'L', kind: 'L', by: f.allin?.by ?? '?', ab: 'All-in Side Slash', ago: 0 };
  }
  if (f.floorGone) {
    return f.floorBy?.by
      ? { group: 'floor:sinkhole', kind: 'floor', by: f.floorBy.by, ab: f.floorBy.ab }
      : { group: 'floor:collapse', kind: 'floor', by: null, ab: 'collapse' };
  }
  const win = f.hits.filter((h) => h.ago <= W);
  const sig = win.filter((h) => SIG_KINDS.has(h.kind) && (h.kind === 'grip' || h.mag >= MINMAG));
  if (sig.length) {
    const h = sig.reduce((a, b) => (b.ago < a.ago ? b : a));
    if (h.kind === 'recoil') return { group: 'self:recoil', kind: 'recoil', by: null, ab: 'own headbutt recoil', hitBy: h.by, ago: h.ago, hit: h };
    return { group: h.kind, kind: h.kind, by: h.by, ab: h.ab, ago: h.ago, hit: h };
  }
  if (f.sinkBy) return { group: 'pull:sinkhole', kind: 'pull', by: f.sinkBy, ab: 'Sinkhole pull' };
  const nud = win.filter((h) => h.kind === 'nudge');
  if (nud.length) {
    const h = nud.reduce((a, b) => (b.ago < a.ago ? b : a));
    return { group: 'nudge', kind: 'nudge', by: h.by, ab: 'collision push', ago: h.ago, hit: h };
  }
  if (f.sinceOwnJ !== null && f.sinceOwnJ <= 1.0) return { group: 'self:ownJ', kind: 'self', by: null, ab: f.jName };
  const flags = [f.iceBy ? `ice(${f.iceBy})` : null, f.vs?.conf ? `confused(${f.confBy?.by ?? '?'})` : null, f.vs?.stun ? 'stunned' : null, f.vs?.slow ? 'slowed' : null].filter(Boolean);
  return { group: 'alone', kind: 'alone', by: null, ab: flags.join('+') || 'plain' };
}

// What the victim was doing when it took the hit (priority order).
function activity(vs, victim) {
  if (!vs) return 'n/a';
  if (vs.stun) return 'stunned';
  if (vs.allin) return 'charging All-in';
  if (vs.k === 'w') return 'K wind-up';
  if (vs.l === 'w') return 'L wind-up';
  if (vs.j === 'w') return 'J wind-up';
  if (vs.hb === 'w') return 'headbutt wind-up';
  if (vs.k === 'a') return 'K active';
  if (vs.hb === 'a') return 'headbutt lunge';
  if (vs.j === 'a') return 'J active (dash)';
  if (vs.l === 'a') return 'L active';
  if (vs.rooted) return 'rooted (other)';
  return vs.spd > 1 ? 'moving' : 'standing';
}

function analyze(data) {
  const { matches } = data;
  const per = Object.fromEntries(ALL.map((n) => [n, {
    app: 0, appP: 0, appB: 0, elim: 0, elimP: 0, elimB: 0, wins: 0, winsP: 0, winsB: 0, minutes: 0, minutesP: 0, minutesB: 0,
    falls: 0, fallsP: 0, fallsB: 0, recFalls: 0, cause: {}, causeBy: {}, groups: {},
  }]));
  const dashLanded = {}; const dashFalls = {}; const hitLanded = {};
  const fallsAll = [];
  let totalMin = 0;
  const qa = { matches: matches.length, failures: data.failures.length, fallMismatch: 0, other: 0, unpaired: 0, selfCounts: {}, otherSamples: [], hashes: {} };
  for (const m of matches) {
    const min = m.durationSim / 60;
    totalMin += min;
    qa.hashes[m.idx] = m.eventsHash;
    for (const [k, v] of Object.entries(m.counts ?? {})) {
      if (k.startsWith('other:')) qa.other += v;
      else if (k.startsWith('unpaired')) qa.unpaired += v;
      else qa.selfCounts[k] = (qa.selfCounts[k] ?? 0) + v;
    }
    if (m.others?.length && qa.otherSamples.length < 20) qa.otherSamples.push(...m.others.slice(0, 3));
    const myFalls = {};
    for (const f of m.falls) myFalls[f.v] = (myFalls[f.v] ?? 0) + 1;
    for (const c of m.critters) {
      const P = per[c.name]; const r = c.role;
      P.app++; P[`app${r}`]++;
      if (c.eliminated) { P.elim++; P[`elim${r}`]++; }
      if (c.won) { P.wins++; P[`wins${r}`]++; }
      P.minutes += min; P[`minutes${r}`] += min;
      const nf = myFalls[c.name] ?? 0;
      P.falls += nf; P[`falls${r}`] += nf;
      P.recFalls += m.recFalls?.[c.name] ?? 0;
      if ((m.recFalls?.[c.name] ?? 0) !== nf) qa.fallMismatch++;
    }
    for (const h of m.hits) {
      const key = `${h.by}>${h.v}`;
      hitLanded[h.kind] ??= {}; hitLanded[h.kind][key] = (hitLanded[h.kind][key] ?? 0) + 1;
      if (h.kind === 'dash') dashLanded[key] = (dashLanded[key] ?? 0) + 1;
    }
    for (const f of m.falls) {
      const a = attribute(f);
      const P = per[f.v];
      P.groups[a.group] = (P.groups[a.group] ?? 0) + 1;
      const ck = `${a.group}|${a.ab}`;
      P.cause[ck] = (P.cause[ck] ?? 0) + 1;
      if (a.by) { const bk = `${a.group}|${a.by}`; P.causeBy[bk] = (P.causeBy[bk] ?? 0) + 1; }
      if (a.group === 'dash') { const key = `${a.by}>${f.v}`; dashFalls[key] = (dashFalls[key] ?? 0) + 1; }
      fallsAll.push({ idx: m.idx, seed: m.seed, player: m.player, ...f, attr: a, act: a.hit ? activity(a.hit.vs, f.v) : null });
    }
  }
  return { per, dashLanded, dashFalls, hitLanded, fallsAll, totalMin, qa };
}

function tables(res, label = '') {
  const { per, dashLanded, dashFalls, fallsAll } = res;
  const out = [];
  const GROUPS = ['dash', 'headbutt', 'K', 'L', 'grip', 'shell', 'floor:collapse', 'floor:sinkhole', 'pull:sinkhole', 'nudge', 'self:recoil', 'self:allin-miss', 'self:ownJ', 'alone'];
  // 1. per-critter table
  let t = '| Critter | App (P/B) | Eliminated % [95% CI] | Win % [95% CI] | Falls/min | Falls |\n|---|---|---|---|---|---|\n';
  const rows = ALL.map((n) => ({ n, ...per[n] })).sort((a, b) => b.elim / b.app - a.elim / a.app);
  for (const r of rows) {
    const [el, eh] = wilson(r.elim, r.app); const [wl, wh] = wilson(r.wins, r.app);
    t += `| ${r.n} | ${r.app} (${r.appP}/${r.appB}) | ${pct(r.elim / r.app)} [${pct(el)}–${pct(eh)}] | ${pct(r.wins / r.app)} [${pct(wl)}–${pct(wh)}] | ${(r.falls / r.minutes).toFixed(2)} | ${r.falls} |\n`;
  }
  out.push({ title: `Per critter${label}`, markdown: t });
  // 1b. split by role
  t = '| Critter | Elim % as player (n) | Elim % as bot (n) | Win % as player | Win % as bot | Falls/min P | Falls/min B |\n|---|---|---|---|---|---|---|\n';
  for (const r of rows) {
    t += `| ${r.n} | ${pct(r.elimP / r.appP)} (${r.appP}) | ${pct(r.elimB / r.appB)} (${r.appB}) | ${pct(r.winsP / r.appP)} | ${pct(r.winsB / r.appB)} | ${(r.fallsP / r.minutesP).toFixed(2)} | ${(r.fallsB / r.minutesB).toFixed(2)} |\n`;
  }
  out.push({ title: `By role${label}`, markdown: t });
  // 2. cause breakdown (% of the critter's falls, and per minute)
  t = `| Victim | Falls | ${GROUPS.join(' | ')} |\n|---|---|${GROUPS.map(() => '---').join('|')}|\n`;
  for (const r of rows) {
    t += `| ${r.n} | ${r.falls} | ${GROUPS.map((gk) => pct((r.groups[gk] ?? 0) / r.falls)).join(' | ')} |\n`;
  }
  out.push({ title: `Fall cause, % of each critter's falls (window ${W} s)${label}`, markdown: t });
  t = `| Victim | ${GROUPS.join(' | ')} |\n|---|${GROUPS.map(() => '---').join('|')}|\n`;
  for (const r of rows) t += `| ${r.n} | ${GROUPS.map((gk) => ((r.groups[gk] ?? 0) / r.minutes).toFixed(3)).join(' | ')} |\n`;
  out.push({ title: `Fall cause per match-minute${label}`, markdown: t });
  // 3. attacker × victim dash-hit falls and landed dash hits
  const attackers = ['Sergei', 'Trunk', 'Shelly', 'Kermit', 'Sihans', 'Cheeto', 'Sebastian', 'Kowalski', 'Kurama'];
  const dashers = attackers.filter((a) => ALL.some((v) => dashLanded[`${a}>${v}`]));
  t = `| Victim \\ Dasher | ${dashers.join(' | ')} | total |\n|---|${dashers.map(() => '---').join('|')}|---|\n`;
  for (const v of ALL) {
    let tot = 0;
    const cells = dashers.map((a) => { const f = dashFalls[`${a}>${v}`] ?? 0; const l = dashLanded[`${a}>${v}`] ?? 0; tot += f; return l ? `${f}/${l}` : '–'; });
    t += `| ${v} | ${cells.join(' | ')} | ${tot} |\n`;
  }
  out.push({ title: `Dash-hit falls / dash hits landed (attacker × victim)${label}`, markdown: t });
  // 4. per-attacker cause matrix (all groups): who pushes whom off
  t = `| Victim \\ Attacker | ${ALL.join(' | ')} |\n|---|${ALL.map(() => '---').join('|')}|\n`;
  for (const v of ALL) {
    const cells = ALL.map((a) => {
      const P = per[v];
      let n = 0;
      for (const [k, c] of Object.entries(P.causeBy)) if (k.endsWith(`|${a}`) && !k.startsWith('floor')) n += c;
      return n ? String(n) : '–';
    });
    t += `| ${v} | ${cells.join(' | ')} |\n`;
  }
  out.push({ title: `Falls attributed to an attacker (any push; floor/self/alone excluded)${label}`, markdown: t });
  return out;
}

function focus(res, who) {
  const { fallsAll } = res;
  const falls = fallsAll.filter((f) => f.v === who);
  const out = {};
  const count = (arr, fn) => { const o = {}; for (const x of arr) { const k = fn(x); o[k] = (o[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1])); };
  out.falls = falls.length;
  out.byCause = count(falls, (f) => `${f.attr.group}: ${f.attr.ab}${f.attr.by ? ` by ${f.attr.by}` : ''}`);
  out.byAttacker = count(falls.filter((f) => f.attr.by && !f.attr.group.startsWith('floor')), (f) => f.attr.by);
  const hitFalls = falls.filter((f) => f.attr.hit);
  out.activityAtFatalHit = count(hitFalls, (f) => f.act);
  out.activityAtFatalDash = count(hitFalls.filter((f) => f.attr.group === 'dash'), (f) => `${f.act} ← ${f.attr.by}`);
  out.stateFlagsAtFatalHit = (() => {
    const o = { n: hitFalls.length };
    for (const f of hitFalls) {
      const vs = f.attr.hit.vs;
      for (const [k, v] of Object.entries({ jWind: vs.j === 'w', jAct: vs.j === 'a', kWind: vs.k === 'w', kAct: vs.k === 'a', lWind: vs.l === 'w', lAct: vs.l === 'a', hbWind: vs.hb === 'w', hbLunge: vs.hb === 'a', rooted: !!vs.rooted, stunned: !!vs.stun, slowed: !!vs.slow })) if (v) o[k] = (o[k] ?? 0) + 1;
    }
    return o;
  })();
  out.agoFatalHit = (() => { const a = hitFalls.map((f) => f.attr.ago).sort((x, y) => x - y); return { p25: a[Math.floor(a.length * 0.25)], median: a[Math.floor(a.length / 2)], p75: a[Math.floor(a.length * 0.75)] }; })();
  out.ringAtFatalHit = (() => { const a = hitFalls.map((f) => f.attr.hit.ring).sort((x, y) => x - y); return { median: a[Math.floor(a.length / 2)] }; })();
  return out;
}

// Activity when hit (all hits, not only fatal) — per victim, per kind.
function activityAllHits(data, who, kinds) {
  const o = {}; let n = 0;
  for (const m of data.matches) for (const h of m.hits) {
    if (h.v !== who || !kinds.includes(h.kind)) continue;
    n++; const k = activity(h.vs, who); o[k] = (o[k] ?? 0) + 1;
  }
  return { n, ...Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1])) };
}

// Extra views: dash involvement, exposure-normalised attackers, mutual
// headbutts, window sensitivity.
function extras(data, res) {
  const out = {};
  // (a) involvement: a dash hit (any attacker) on the victim within W before the fall.
  const inv = {};
  for (const f of res.fallsAll) {
    const o = (inv[f.v] ??= { falls: 0, dashInWin: 0, dashInWinBy: {}, dashThenHeadbutt: 0 });
    o.falls++;
    const d = f.hits.filter((h) => h.kind === 'dash' && h.ago <= W);
    if (d.length) {
      o.dashInWin++;
      for (const by of new Set(d.map((h) => h.by))) o.dashInWinBy[by] = (o.dashInWinBy[by] ?? 0) + 1;
      if (f.attr.group === 'headbutt') o.dashThenHeadbutt++;
    }
  }
  out.dashInvolvement = inv;
  // (a2) floor falls that also had a significant external hit shortly before
  // (floor-first may steal a push: the tile died while the victim flew over it).
  const fl = {};
  for (const f of res.fallsAll) {
    if (!f.attr.group.startsWith('floor')) continue;
    const o = (fl[f.v] ??= { floor: 0, hit05: 0, hit15: 0 });
    o.floor++;
    const sig = f.hits.filter((h) => SIG_KINDS.has(h.kind) && h.kind !== 'recoil' && (h.kind === 'grip' || h.mag >= MINMAG));
    if (sig.some((h) => h.ago <= 0.5)) o.hit05++;
    if (sig.some((h) => h.ago <= 1.5)) o.hit15++;
  }
  out.floorOverlap = fl;
  // (b) exposure: falls by attacker X per match-minute in matches where X is present.
  const expo = {};
  for (const m of data.matches) {
    const names = m.critters.map((c) => c.name);
    for (const v of names) for (const a of names) if (a !== v) {
      const k = `${a}>${v}`; (expo[k] ??= { min: 0, allin: 0, headbutt: 0, dash: 0, L: 0, K: 0, any: 0 }).min += m.durationSim / 60;
    }
  }
  for (const f of res.fallsAll) {
    const a = f.attr; if (!a.by || a.group.startsWith('floor')) continue;
    const e = expo[`${a.by}>${f.v}`]; if (!e) continue;
    e.any++;
    if (a.ab === 'All-in Side Slash') e.allin++;
    else if (a.group === 'headbutt') e.headbutt++;
    else if (a.group === 'dash') e.dash++;
    else if (a.group === 'L') e.L++;
    else if (a.group === 'K') e.K++;
  }
  out.exposure = expo;
  // (c) mutual headbutts: victim in its own lunge when headbutted → is the attacker the lower index?
  let mutual = 0; let lowerIdx = 0; let hbAll = 0;
  for (const m of data.matches) {
    const idx = Object.fromEntries(m.critters.map((c, i) => [c.name, i]));
    for (const h of m.hits) {
      if (h.kind !== 'headbutt') continue;
      hbAll++;
      if (h.vs.hb === 'a') { mutual++; if (idx[h.by] < idx[h.v]) lowerIdx++; }
    }
  }
  out.mutualHeadbutts = { headbuttHits: hbAll, victimAlsoLunging: mutual, attackerLowerIndex: lowerIdx };
  // (d) window sensitivity of the group shares.
  const keep = W; const sens = {};
  for (const w of [0.5, 0.75, 1.5, 3.0]) {
    W = w;
    const g = {};
    for (const f of res.fallsAll) { const a = attribute(f); g[f.v] ??= {}; g[f.v][a.group] = (g[f.v][a.group] ?? 0) + 1; }
    sens[w] = g;
  }
  W = keep;
  out.windowSensitivity = sens;
  return out;
}

const data = load(positionals.length ? positionals : ['raw/base']);
const res = analyze(data);
const tbl = tables(res);
const focusK = focus(res, 'Kowalski');
const focusS = focus(res, 'Sergei');
const actAll = Object.fromEntries(ALL.map((n) => [n, activityAllHits(data, n, ['dash'])]));
const actFocus = Object.fromEntries(['Kowalski', 'Sergei'].map((n) => [n, Object.fromEntries(['headbutt', 'dash', 'K', 'L', 'allin'].map((k) => [k, activityAllHits(data, n, [k])]))]));
const ext = extras(data, res);
const summary = {
  extras: ext,
  inputs: data.files, window: W, minMag: MINMAG, matches: data.matches.length, failures: data.failures, totalMatchMinutes: +res.totalMin.toFixed(1),
  qa: { ...res.qa, hashes: undefined },
  perCritter: Object.fromEntries(ALL.map((n) => { const P = res.per[n]; const [el, eh] = wilson(P.elim, P.app); const [wl, wh] = wilson(P.wins, P.app); return [n, { ...P, elimRate: P.elim / P.app, elimCI: [el, eh], winRate: P.wins / P.app, winCI: [wl, wh], fallsPerMin: P.falls / P.minutes }]; })),
  dashLanded: res.dashLanded, dashFalls: res.dashFalls, hitLanded: res.hitLanded,
  focus: { Kowalski: focusK, Sergei: focusS },
  activityWhenDashHit: actAll,
  activityWhenHitFocus: actFocus,
  tables: tbl,
};
writeFileSync(resolve(opt.out), JSON.stringify(summary, null, 1));
if (!opt.quiet) {
  console.log(`matches ${data.matches.length} · failures ${data.failures.length} · match-minutes ${res.totalMin.toFixed(1)} · window ${W}s minMag ${MINMAG}`);
  console.log('QA', JSON.stringify({ ...res.qa, hashes: undefined, otherSamples: res.qa.otherSamples.slice(0, 5) }));
  for (const x of tbl) console.log(`\n### ${x.title}\n${x.markdown}`);
  console.log('\n### Kowalski focus\n' + JSON.stringify(focusK, null, 1));
  console.log('\n### Sergei focus\n' + JSON.stringify(focusS, null, 1));
  console.log('\n### Activity when dash-hit (all dash hits)\n' + JSON.stringify(actAll, null, 1));
  console.log('\n### Activity when hit (all hits, focus)\n' + JSON.stringify(actFocus));
  console.log('\n### Dash involvement\n' + JSON.stringify(ext.dashInvolvement));
  console.log('\n### Mutual headbutts\n' + JSON.stringify(ext.mutualHeadbutts));
  console.log('\n### Floor falls with a recent external hit\n' + JSON.stringify(ext.floorOverlap));
  let t = '| Victim | ' + ALL.join(' | ') + ' |\n|---|' + ALL.map(() => '---').join('|') + '|\n';
  for (const v of ALL) t += `| ${v} | ${ALL.map((a) => { const e = ext.exposure[`${a}>${v}`]; return a === v || !e ? '–' : (e.any / e.min).toFixed(2); }).join(' | ')} |\n`;
  console.log('\n### Attributed falls per match-minute together (victim row, attacker col)\n' + t);
  t = '| Victim | Sebastian All-in | Trunk headbutt | Trunk K |\n|---|---|---|---|\n';
  for (const v of ALL) { const s = ext.exposure[`Sebastian>${v}`]; const tr = ext.exposure[`Trunk>${v}`]; t += `| ${v} | ${s ? (s.allin / s.min).toFixed(3) : '–'} | ${tr ? (tr.headbutt / tr.min).toFixed(3) : '–'} | ${tr ? (tr.K / tr.min).toFixed(3) : '–'} |\n`; }
  console.log('\n### Exposure-normalised (per match-minute with the attacker present)\n' + t);
  for (const w of Object.keys(ext.windowSensitivity)) {
    const g = ext.windowSensitivity[w];
    console.log(`W=${w}: ` + ['Kowalski', 'Sergei'].map((v) => `${v} ` + JSON.stringify(g[v])).join(' · '));
  }
}
if (opt.compare) {
  // Paired on the plan: only specs present in both runs; per appearance
  // (idx, critter) the difference other − base of eliminated / won, with a
  // 95% CI from the paired SE.
  const d2 = load([opt.compare]);
  const common = new Set(d2.matches.map((m) => m.idx).filter((i) => data.matches.some((m) => m.idx === i)));
  const A = { ...data, matches: data.matches.filter((m) => common.has(m.idx)) };
  const B = { ...d2, matches: d2.matches.filter((m) => common.has(m.idx)) };
  const ra = analyze(A); const rb = analyze(B);
  const byIdx = (d) => Object.fromEntries(d.matches.map((m) => [m.idx, Object.fromEntries(m.critters.map((c) => [c.name, c]))]));
  const ia = byIdx(A); const ib = byIdx(B);
  const paired = (n, key) => {
    const ds = [];
    for (const i of common) { const x = ia[i][n]; const y = ib[i][n]; if (x && y) ds.push((y[key] ? 1 : 0) - (x[key] ? 1 : 0)); }
    const mean = ds.reduce((s, v) => s + v, 0) / ds.length;
    const sd = Math.sqrt(ds.reduce((s, v) => s + (v - mean) ** 2, 0) / (ds.length - 1));
    return { n: ds.length, mean, lo: mean - 1.96 * sd / Math.sqrt(ds.length), hi: mean + 1.96 * sd / Math.sqrt(ds.length) };
  };
  console.log(`\n### Compare: ${opt.compare} vs base, paired on ${common.size} common matches`);
  let t = '| Critter | App | Elim % base | Elim % other | Δ elim [95% CI] | Win % base | Win % other | Falls/min base → other | dash-hit falls base → other |\n|---|---|---|---|---|---|---|---|---|\n';
  const cmp = {};
  for (const n of ALL) {
    const a = ra.per[n]; const b = rb.per[n]; const pe = paired(n, 'eliminated'); const pw = paired(n, 'won');
    cmp[n] = { app: a.app, elimBase: a.elim / a.app, elimOther: b.elim / b.app, dElim: pe, winBase: a.wins / a.app, winOther: b.wins / b.app, dWin: pw, fpmBase: a.falls / a.minutes, fpmOther: b.falls / b.minutes, dashFallsBase: a.groups.dash ?? 0, dashFallsOther: b.groups.dash ?? 0, groupsBase: a.groups, groupsOther: b.groups };
    t += `| ${n} | ${a.app} | ${pct(a.elim / a.app)} | ${pct(b.elim / b.app)} | ${(100 * pe.mean).toFixed(1)} [${(100 * pe.lo).toFixed(1)}, ${(100 * pe.hi).toFixed(1)}] | ${pct(a.wins / a.app)} | ${pct(b.wins / b.app)} | ${(a.falls / a.minutes).toFixed(2)} → ${(b.falls / b.minutes).toFixed(2)} | ${a.groups.dash ?? 0} → ${b.groups.dash ?? 0} |\n`;
  }
  console.log(t);
  writeFileSync(resolve(opt.out.replace(/\.json$/, '') + '-compare.json'), JSON.stringify({ base: positionals, other: opt.compare, common: common.size, perCritter: cmp, table: t }, null, 1));
}
