#!/usr/bin/env node
// ---------------------------------------------------------------------------
// attrib-probe.mjs — who pushed whom off? Every fall of EVERY critter,
// attributed in SIM time, on deterministic bot matches in /tools.html.
// ---------------------------------------------------------------------------
//
// fall-probe says why ONE critter falls; this says who pushed EVERY critter
// off, with what. Built for the dash-hit balance pass (2026-09-29: 900
// matches, ~400 appearances per critter; see docs/REPASO_HABILIDADES.md
// §«Pase de balance de las embestidas: medido»). scripts/attrib-analyze.mjs
// turns its shards into the tables and the paired what-if deltas.
//
// It only drives the running dev server's lab page; nothing in the game
// knows about it. How the attribution works:
//   · Each critter instance gets accessor properties for vx / vz. Every
//     velocity write goes through the setter; x and z writes come in
//     adjacent pairs (all writers do `c.vx … ; c.vz …`), so a pair is one
//     impulse. Pairs below --th u/s, zeroings, the bot/player move (the
//     writer sets `pace` just before) and anything inside the critter's
//     own Critter.simulate (lunge, friction, cap, dead zone) are ignored
//     without a stack.
//   · For the rest, `new Error().stack` names the WRITER function
//     (rushContact, resolveCollisions, fireGroundPound, fireBlink,
//     tickLOffline, tickProjectiles, fireAllInResolution, reflectOff,
//     hitAnchored …). The attacker is then read from live state at that
//     instant: the dasher whose AbilityState.rammed holds the victim, the
//     collision partner (and who is headbutting), the caster whose ability
//     is firing (active, wind-up over, effectFired still false), the L
//     channel that reaches the victim, the snowball's owner.
//   · startFalling / markTeleported / stunTimer / confusedTimer are wrapped
//     per instance (All-in victims, Trunk Grip yanks, stun and confusion
//     sources); arena.killFragmentIndices marks Sinkhole holes. Zones
//     (enemy ice, enemy sinkhole) are read through a page-side
//     import('/src/abilities-runtime.ts') — checked at install to be the
//     SAME module instance the game uses (a zone pushed through it slows a
//     live critter).
//   · Time = FEEL.match.duration − game.matchTimer (sim seconds; hit-stop
//     steps don't advance it).
//
// Usage (dev server running; every browser muted):
//   node scripts/attrib-probe.mjs --url=http://localhost:5181 --players=Kowalski --matches=5
//   node scripts/attrib-probe.mjs --matches=100 --shard=0/3 --out=.tmp/attrib/base/shard0.json
//   node scripts/attrib-probe.mjs --specs=.tmp/attrib/plan.json --shard=2/3 --kit=Sergei.0.dashHitForce=0
//   node scripts/attrib-probe.mjs --plan-only --matches=100 --out=.tmp/attrib/plan.json
//   node scripts/attrib-analyze.mjs .tmp/attrib/base --compare=.tmp/attrib/whatif
// Up to 3 shards in parallel is safe on a shared machine; at 6, other
// sessions' browsers made renderers crash (the probe resumes with --resume).
//
// Options:
//   --url        dev server base (def http://localhost:5173)
//   --players    comma list of player critters (def: all 9)
//   --matches    matches per player (def 10)
//   --seed       base seed; match seed = seed + 1000·playerIndex + m (def 30000)
//   --specs      JSON file: array of {player, bots, seed} (or an output of
//                this script: its .plan) — overrides players/matches/seed
//   --seeds      comma list of seeds; with --players, one match per seed per player
//   --shard      i/n — run only specs with index % n === i
//   --speed      sim steps per rendered frame (def 16; dt is fixed 1/60,
//                the outcome does not depend on it)
//   --feel       sec.key=value,... what-ifs on the live FEEL (as run-match-batch)
//   --th         impulse threshold in u/s (def 0.5)
//   --window     seconds of impulses kept per fall (def 3; analysis cuts 1.5)
//   --out        output JSON (def .tmp/attrib/attrib.json)
//   --kit        Critter.slot.key=value,... what-ifs on the live ability defs
//                (e.g. Sergei.0.dashHitForce=0); checked to be the game's objects
//   --no-gpu     SwiftShader instead of ANGLE/D3D11
//   --resume     keep the matches already in --out, run only the missing ones
//   --retries    retries per match after a crash/hang (def 2; fresh browser)
//   --plan-only  write the plan (specs) and exit
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launchMutedBrowser, newMutedPage } from './lib/headless-browser.mjs';

const ALL = ['Sergei', 'Trunk', 'Kurama', 'Shelly', 'Kermit', 'Sihans', 'Kowalski', 'Cheeto', 'Sebastian'];

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173' },
    players: { type: 'string', default: ALL.join(',') },
    matches: { type: 'string', default: '10' },
    seed: { type: 'string', default: '30000' },
    seeds: { type: 'string' },
    specs: { type: 'string' },
    shard: { type: 'string', default: '0/1' },
    speed: { type: 'string', default: '16' },
    feel: { type: 'string', default: '' },
    kit: { type: 'string', default: '' },
    th: { type: 'string', default: '0.5' },
    window: { type: 'string', default: '3' },
    out: { type: 'string', default: '.tmp/attrib/attrib.json' },
    'no-gpu': { type: 'boolean', default: false },
    'debug-nudges': { type: 'boolean', default: false },
    'plan-only': { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
    retries: { type: 'string', default: '2' },
  },
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Same picker as run-match-batch (pickDefaultBots), seeded per match.
function pickBots(player, seed) {
  const rng = mulberry32(seed);
  const pool = ALL.filter((n) => n !== player);
  const picks = [];
  for (let k = 0; k < 3; k++) picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return picks;
}

// --kit=Sergei.0.dashHitForce=0,Cheeto.0.dashHitForce=15 — what-ifs on the
// live ability defs (CRITTER_ABILITIES, the objects the game's AbilityStates
// point at; the lab's sidebar tuner edits the same objects).
const kit = opt.kit.split(',').map((s) => s.trim()).filter(Boolean).map((kv) => {
  const m = /^([A-Za-z]+)\.([0-2])\.([A-Za-z_$][\w$]*)=(-?\d+(?:\.\d+)?)$/.exec(kv);
  if (!m) throw new Error(`--kit: "${kv}" no es Bicho.slot.clave=numero`);
  if (!ALL.includes(m[1])) throw new Error(`--kit: ${m[1]} no es del roster`);
  return { critter: m[1], slot: Number(m[2]), key: m[3], value: Number(m[4]) };
});
const feel = Object.fromEntries(opt.feel.split(',').map((s) => s.trim()).filter(Boolean).map((kv) => {
  const m = /^([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)=(-?\d+(?:\.\d+)?)$/.exec(kv);
  if (!m) throw new Error(`--feel: "${kv}" no es seccion.clave=numero`);
  return [m[1], Number(m[2])];
}));

// ---- plan ------------------------------------------------------------------
let plan;
if (opt.specs) {
  const doc = JSON.parse(readFileSync(resolve(opt.specs), 'utf8'));
  plan = Array.isArray(doc) ? doc : doc.plan;
} else {
  const players = opt.players.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of players) if (!ALL.includes(p)) throw new Error(`--players: ${p} no es del roster`);
  plan = [];
  if (opt.seeds) {
    const seeds = opt.seeds.split(',').map(Number);
    for (const p of players) for (const s of seeds) plan.push({ player: p, bots: pickBots(p, s), seed: s });
  } else {
    const base = Number(opt.seed);
    for (const p of players) {
      const pi = ALL.indexOf(p);
      for (let m = 0; m < Number(opt.matches); m++) {
        const seed = base + 1000 * pi + m;
        plan.push({ player: p, bots: pickBots(p, seed), seed });
      }
    }
  }
}
plan = plan.map((s, i) => ({ idx: s.idx ?? i, player: s.player, bots: s.bots, seed: s.seed }));
const OUT = resolve(opt.out);
if (opt['plan-only']) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ plan }, null, 1));
  console.log(`plan: ${plan.length} partidas → ${OUT}`);
  process.exit(0);
}
const [si, sn] = opt.shard.split('/').map(Number);
const mine = plan.filter((s) => s.idx % sn === si);

// ---- page-side instrumentation ---------------------------------------------
async function install(cfg) {
  if (window.__attr) return window.__attr.installInfo;
  const g = window.__game;
  const FEEL = window.__feel;
  const AR = await import('/src/abilities-runtime.ts');
  const TH = cfg.th;
  const KEEP = cfg.window;

  // Module identity: a zone pushed through OUR import must slow a live critter.
  const identity = (() => {
    const c = g.critters[0];
    if (!c) return 'no-critter';
    const before = c.effectiveSpeed;
    AR.pushNetworkZone({ x: c.x, z: c.z, radius: 1000, slowMultiplier: 0.5, ttl: 99, vfxKind: 'generic', ownerKey: '__attr_probe__' });
    const after = c.effectiveSpeed;
    AR.clearActiveZones();
    return before > 0 && Math.abs(after - before * 0.5) < 1e-9 ? 'same-instance' : `DIFFERENT (${before} → ${after})`;
  })();

  const AB = await import('/src/abilities.ts');
  const kitIdentity = (() => {
    const c = g.critters[0];
    const defs = AB.CRITTER_ABILITIES[c.config.name];
    return defs && c.abilityStates.every((s, i) => s.def === defs[i]) ? 'same-instance' : 'DIFFERENT';
  })();
  const A = { cur: null, installInfo: { identity, kitIdentity } };
  // Ability-def what-ifs: remember the code values once, then set.
  const kitOrig = new Map();
  A.applyKit = (list) => {
    for (const [k, v] of kitOrig) { const [n, sl, key] = k.split('|'); AB.CRITTER_ABILITIES[n][+sl][key] = v; }
    for (const o of list) {
      const def = AB.CRITTER_ABILITIES[o.critter]?.[o.slot];
      if (!def) throw new Error(`--kit: ${o.critter}.${o.slot} no existe`);
      const cur = def[o.key];
      if (cur !== undefined && typeof cur !== 'number') throw new Error(`--kit: ${o.critter}.${o.slot}.${o.key} no es numerico`);
      const k = `${o.critter}|${o.slot}|${o.key}`;
      if (!kitOrig.has(k)) kitOrig.set(k, cur);
      def[o.key] = o.value;
    }
    return list.map((o) => `${o.critter}.${o.slot}.${o.key}: ${kitOrig.get(`${o.critter}|${o.slot}|${o.key}`)} → ${AB.CRITTER_ABILITIES[o.critter][o.slot][o.key]}`);
  };
  window.__attr = A;
  let seq = 0;
  let pending = null;
  const inst = new WeakSet();
  const PRIO = { allin: 9, grip: 8, L: 7, K: 6, headbutt: 5, dash: 4, J: 4, shell: 3, recoil: 2, nudge: 1 };

  const now = () => (A.cur ? A.cur.T0 - g.matchTimer : 0);
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const r2 = (x) => Math.round(x * 100) / 100;
  const nm = (c) => (c ? c.config.name : null);
  const live = (o) => o.alive && !o.falling;

  function frames() {
    const lim = Error.stackTraceLimit;
    Error.stackTraceLimit = 10;
    const s = new Error().stack;
    Error.stackTraceLimit = lim;
    const out = [];
    for (const line of s.split('\n')) {
      const m = /at (?:(\S+)(?: \[as \S+\])? \()?[^()]*\/src\/([\w\-/]+)\.ts[^:]*:(\d+):\d+\)?\s*$/.exec(line);
      if (m) out.push({ fn: (m[1] || '?').split('.').pop(), file: m[2], line: +m[3] });
    }
    return out;
  }

  function vstate(c, ovx = c.vx, ovz = c.vz) {
    const st = c.abilityStates.map((s) => (s.active ? (s.windUpLeft > 0 ? 'w' : 'a') : '-'));
    return {
      j: st[0], k: st[1], l: st[2],
      hb: c.headbuttAnticipating ? 'w' : c.isHeadbutting ? 'a' : '-',
      stun: c.stunTimer > 0 ? 1 : 0, slow: c.slowTimer > 0 ? 1 : 0, conf: c.confusedTimer > 0 ? 1 : 0,
      allin: c.lHoldCharging ? 1 : 0, rooted: c.effectiveSpeed === 0 ? 1 : 0,
      imm: c.immunityTimer > 0 ? 1 : 0, inp: c.hasInput ? 1 : 0,
      spd: r2(Math.hypot(ovx, ovz)), ring: r2(Math.hypot(c.x, c.z)),
    };
  }

  function partner(c) {
    let best = null; let gap = Infinity;
    for (const o of g.critters) {
      if (o === c || !live(o)) continue;
      const d = Math.abs(Math.hypot(o.x - c.x, o.z - c.z) - (o.radius + c.radius));
      if (d < gap) { gap = d; best = o; }
    }
    return { o: best, gap };
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  function nearestOf(c, list) {
    let best = null; let bd = Infinity;
    for (const x of list) { const d = dist(x.o, c); if (d < bd) { bd = d; best = x; } }
    return best;
  }
  // The caster whose ability `pred` is firing right now (fireEffect runs
  // before effectFired is set).
  function firing(c, pred) {
    const list = [];
    for (const o of g.critters) {
      o.abilityStates.forEach((s, slot) => {
        if (pred(s) && s.active && s.windUpLeft <= 0 && !s.effectFired) list.push({ o, s, slot });
      });
    }
    return nearestOf(c, list);
  }
  const SLOT = ['J', 'K', 'L'];
  // The All-in resolves from updateAbilities (duration end) or, hold-to-fire,
  // from releaseSebastianAllInCharge (state not active then). Only an allInL
  // kit can cast it (Copycat does not copy it): the victim itself, if it has
  // one, else the nearest owner.
  function allInCaster(c) {
    const list = [];
    for (const o of g.critters) { const s = o.abilityStates[2]; if (s && s.def.allInL) list.push({ o, s }); }
    const self = list.find((x) => x.o === c);
    return self ?? nearestOf(c, list);
  }

  function classify(c, fr) {
    const f = fr[0] ?? { fn: '?', file: '?' };
    const fn = f.fn;
    if (f.file === 'bot' || f.file === 'player') return { kind: 'self', ab: 'move' };
    switch (fn) {
      case 'rushContact': {
        const list = [];
        for (const o of g.critters) {
          if (o === c) continue;
          const s = o.abilityStates.find((x) => x.active && x.windUpLeft <= 0 && x.def.type === 'charge_rush');
          if (s && s.rammed && s.rammed.has(c)) list.push({ o, s });
        }
        const x = nearestOf(c, list);
        return x ? { kind: 'dash', by: x.o, ab: x.s.def.name } : { kind: 'other', ab: 'rushContact?' };
      }
      case 'resolveCollisions': {
        const p = partner(c);
        if (!p.o) return { kind: 'other', ab: 'collision?' };
        const ia = g.critters.indexOf(c); const ib = g.critters.indexOf(p.o);
        const [a, b] = ia < ib ? [c, p.o] : [p.o, c];
        let res;
        if (a.isHeadbutting) res = c === b ? { kind: 'headbutt', by: a, ab: 'headbutt' } : { kind: 'recoil', by: b, ab: 'headbutt' };
        else if (b.isHeadbutting) res = c === a ? { kind: 'headbutt', by: b, ab: 'headbutt' } : { kind: 'recoil', by: a, ab: 'headbutt' };
        else res = { kind: 'nudge', by: p.o, ab: 'nudge' };
        res.gap = p.gap;
        return res;
      }
      case 'headbuttClash': {
        // Both in their lunge: each takes the other's headbutt plus its own
        // recoil, written as ONE pair, so it counts as the partner's
        // headbutt (since 2026-09-29; before, resolveCollisions gave it to
        // `a`). Same ab as a one-sided headbutt so --compare lines up with
        // older runs; the clash shows as vs.hb === 'a' (analyze:
        // mutualHeadbutts).
        const p = partner(c);
        return p.o ? { kind: 'headbutt', by: p.o, ab: 'headbutt', gap: p.gap } : { kind: 'other', ab: 'clash?' };
      }
      case 'reflectOff':
      case 'hitAnchored': {
        const p = partner(c);
        return { kind: 'shell', by: p.o, ab: fn === 'reflectOff' ? 'Steel Shell reflect' : 'Steel Shell bounce', gap: p.gap };
      }
      case 'fireGroundPound':
      case 'fireBlink': {
        const type = fn === 'fireBlink' ? 'blink' : 'ground_pound';
        const x = firing(c, (s) => s.def.type === type);
        if (!x) return { kind: 'other', ab: fn + '?' };
        if (x.o === c) return { kind: 'self', ab: x.s.def.name };
        return { kind: x.s.def.gripK ? 'grip' : SLOT[x.slot], by: x.o, ab: x.s.def.name };
      }
      case 'fireAllInResolution': {
        const x = allInCaster(c);
        if (!x) return { kind: 'other', ab: 'allin?' };
        if (x.o === c) return { kind: 'self', ab: 'All-in' };
        return { kind: 'allin', by: x.o, ab: x.s.def.name };
      }
      case 'tickLOffline': {
        const list = [];
        for (const o of g.critters) {
          if (o === c || !live(o)) continue;
          const s = o.abilityStates[2];
          if (!s) continue;
          const d = s.def;
          if (!(d.sawL || d.rammingL || d.conePulseL)) continue;
          if (s.active || d.conePulseL) list.push({ o, s, act: s.active });
        }
        const act = list.filter((x) => x.act);
        const x = nearestOf(c, act.length ? act : list);
        if (!x) return { kind: 'other', ab: 'Lcontact?' };
        const d = x.s.def;
        const flag = d.sawL ? 'saw' : d.rammingL ? 'ram' : 'cone';
        return { kind: 'L', by: x.o, ab: d.copycatL ? `Copycat(${flag})` : d.name };
      }
      case 'tickProjectiles': {
        const list = g.critters.filter((o) => o !== c && o.abilityStates.some((s) => s.def.type === 'projectile')).map((o) => ({ o }));
        const x = nearestOf(c, list);
        const s = x?.o.abilityStates.find((s2) => s2.def.type === 'projectile');
        return x ? { kind: 'K', by: x.o, ab: s.def.name } : { kind: 'other', ab: 'projectile?' };
      }
      case 'fireChargeRush': case 'anchorInPlace': case 'simulate': case 'respawnAt': case 'reset':
      case 'fireFrenzy': case 'releaseSebastianAllInCharge': case 'advanceAllInCharge':
        return { kind: 'self', ab: fn };
      default:
        return { kind: 'other', ab: `${f.file}:${fn}:${f.line}` };
    }
  }

  function bump(key) { const C = A.cur.counts; C[key] = (C[key] ?? 0) + 1; }

  // One impulse (a vx/vz pair) on victim c.
  function evalPair(c, ox, nx, oz, nz, canStack, loneAxis) {
    const dvx = nx - ox; const dvz = nz - oz;
    const mag = Math.hypot(dvx, dvz);
    if (mag < TH) return;
    // Zeroing (grip victim — recorded by markTeleported —, blink, decoy,
    // shell anchor, All-in caster, respawn): never a push.
    if (nx === 0 && nz === 0) return;
    if (!canStack) { bump(`unpaired:${loneAxis}`); return; }
    const fr = frames();
    const k = classify(c, fr);
    if (k.kind === 'self') { bump(`self:${k.ab}`); return; }
    if (k.kind === 'other') { bump(`other:${k.ab}`); A.cur.others.push({ t: r4(now()), v: nm(c), ab: k.ab, fr: fr.slice(0, 3).map((x) => `${x.file}:${x.fn}:${x.line}`) }); return; }
    const t = now();
    const r = Math.hypot(c.x, c.z) || 1;
    const ev = {
      t, step: A.cur.step, v: c, by: k.by, kind: k.kind, ab: k.ab,
      dvx, dvz, vs: vstate(c, ox, oz), gap: k.gap,
      ring: Math.hypot(c.x, c.z), rx: c.x / r, rz: c.z / r,
    };
    pushImpulse(c, ev);
  }

  function pushImpulse(c, ev) {
    if (!A.cur.buf.has(c)) A.cur.buf.set(c, []);
    const buf = A.cur.buf.get(c);
    const last = buf[buf.length - 1];
    // Same step, same attacker: one hit (a dash hit comes with its nudge).
    if (last && last.step === ev.step && last.by === ev.by) {
      last.dvx += ev.dvx; last.dvz += ev.dvz;
      if ((PRIO[ev.kind] ?? 0) > (PRIO[last.kind] ?? 0)) { last.kind = ev.kind; last.ab = ev.ab; if (ev.gap !== undefined) last.gap = ev.gap; }
      last.parts = (last.parts ?? 1) + 1;
      if (last.kind !== 'nudge' && !last.listed) { last.listed = true; A.cur.hitList.push(last); }
    } else {
      buf.push(ev);
      while (buf.length && buf[0].t < ev.t - KEEP - 0.5) buf.shift();
      if (ev.kind !== 'nudge' || cfg.debugNudges) { ev.listed = true; A.cur.hitList.push(ev); }
      if (ev.kind === 'nudge') bump('nudge');
    }
  }

  let paceMark = null;
  let inSim = null; // the critter whose own Critter.simulate is running
  function onWrite(c, axis, o, v) {
    seq++;
    if (!A.cur || !A.cur.playing) return;
    // Its own step: lunge, friction, speed cap, dead zone — never someone else's push.
    if (inSim === c) return;
    if (axis === 0) {
      if (pending) flushPending();
      // updateBot / updatePlayer write `pace` right before their vx/vz pair.
      if (paceMark && paceMark.c === c && paceMark.seq === seq - 1) { pending = { c, o, v, seq, move: true }; return; }
      pending = { c, o, v, seq };
      return;
    }
    if (pending && pending.c === c && pending.seq === seq - 1) {
      const p = pending; pending = null;
      if (p.move) return;
      evalPair(c, p.o, p.v, o, v, true, null);
    } else {
      if (pending) flushPending();
      const x = c.vx;
      evalPair(c, x, x, o, v, true, 'z');
    }
  }
  function flushPending() {
    const p = pending; pending = null;
    if (!p || !A.cur || p.move) return;
    const z = p.c.vz;
    evalPair(p.c, p.o, p.v, z, z, false, 'x');
  }

  function instrument(c) {
    if (inst.has(c)) return;
    inst.add(c);
    const st = { vx: c.vx, vz: c.vz, stun: c.stunTimer, conf: c.confusedTimer, pace: c.pace };
    Object.defineProperty(c, 'pace', { configurable: true, enumerable: true, get() { return st.pace; }, set(v) { st.pace = v; seq++; paceMark = { c, seq }; } });
    Object.defineProperty(c, 'vx', { configurable: true, enumerable: true, get() { return st.vx; }, set(v) { const o = st.vx; st.vx = v; onWrite(c, 0, o, v); } });
    Object.defineProperty(c, 'vz', { configurable: true, enumerable: true, get() { return st.vz; }, set(v) { const o = st.vz; st.vz = v; onWrite(c, 1, o, v); } });
    Object.defineProperty(c, 'stunTimer', {
      configurable: true, enumerable: true, get() { return st.stun; },
      set(v) {
        const o = st.stun; st.stun = v;
        if (A.cur && A.cur.playing && v > o + 1e-6) {
          const fr = frames();
          const caller = fr.find((x) => x.fn !== 'stun');
          let by = null; let ab = caller ? caller.fn : '?';
          if (caller && caller.fn === 'fireGroundPound') {
            const x = firing(c, (s) => s.def.type === 'ground_pound');
            if (x && x.o !== c) { by = x.o; ab = x.s.def.name; }
          }
          A.cur.stunBy.set(c, { t: now(), by: nm(by), ab, dur: r2(v) });
          A.cur.statusList.push({ t: r4(now()), v: nm(c), what: 'stun', by: nm(by), ab, dur: r2(v) });
        }
      },
    });
    Object.defineProperty(c, 'confusedTimer', {
      configurable: true, enumerable: true, get() { return st.conf; },
      set(v) {
        const o = st.conf; st.conf = v;
        if (A.cur && A.cur.playing && v > o + 1e-6) {
          const list = [];
          for (const x of g.critters) { const s = x.abilityStates[2]; if (x !== c && s && s.def.toxicTouchL && s.active) list.push({ o: x, s }); }
          const x = nearestOf(c, list);
          A.cur.confBy.set(c, { t: now(), by: nm(x?.o), ab: x?.s.def.name ?? '?' });
          A.cur.statusList.push({ t: r4(now()), v: nm(c), what: 'confuse', by: nm(x?.o), ab: x?.s.def.name ?? '?' });
        }
      },
    });
    const simc = c.simulate;
    c.simulate = function (dt) {
      const prev = inSim; inSim = this;
      try { return simc.call(this, dt); } finally { inSim = prev; }
    };
    const mt = c.markTeleported;
    c.markTeleported = function () {
      if (A.cur && A.cur.playing) {
        const fr = frames();
        const w = fr.find((x) => x.fn !== 'markTeleported');
        if (w && w.fn === 'fireGroundPound') {
          const x = firing(c, (s) => s.def.type === 'ground_pound' && s.def.gripK);
          if (x && x.o !== c) {
            const r = Math.hypot(c.x, c.z) || 1;
            pushImpulse(c, { t: now(), step: A.cur.step, v: c, by: x.o, kind: 'grip', ab: x.s.def.name, dvx: 0, dvz: 0, vs: vstate(c), ring: Math.hypot(c.x, c.z), rx: c.x / r, rz: c.z / r });
          }
        }
      }
      return mt.call(this);
    };
    const sf = c.startFalling;
    c.startFalling = function () {
      if (!this.falling && A.cur && A.cur.playing) onFall(this);
      return sf.call(this);
    };
  }

  // Arena: Sinkhole holes (killFragmentIndices is called by fireFrenzy's sinkhole branch).
  const arena = g.arena;
  const kfi = arena.killFragmentIndices.bind(arena);
  arena.killFragmentIndices = function (indices) {
    if (A.cur && A.cur.playing) {
      const fr = frames();
      const w = fr.find((x) => x.fn !== 'killFragmentIndices');
      let by = null; let ab = w ? w.fn : '?';
      if (w && w.fn === 'fireFrenzy') {
        const x = firing({ x: 0, z: 0 }, (s) => s.def.sinkholeL);
        if (x) { by = nm(x.o); ab = x.s.def.copycatL ? 'Copycat(sinkhole)' : x.s.def.name; }
      }
      A.cur.holes.push({ t: now(), by, ab, n: indices.length });
    }
    return kfi(indices);
  };

  function onFall(c) {
    const t = now();
    const fr = frames();
    const trig = fr.find((x) => x.fn !== 'startFalling');
    const rec = {
      t: r4(t), v: nm(c), role: g.critters.indexOf(c) === 0 ? 'P' : 'B', livesBefore: c.lives,
      trig: trig ? trig.fn : '?',
      ring: r2(Math.hypot(c.x, c.z)), spd: r2(Math.hypot(c.vx, c.vz)),
      vs: vstate(c),
    };
    const rr = Math.hypot(c.x, c.z) || 1;
    rec.radialV = r2((c.vx * c.x + c.vz * c.z) / rr / (Math.hypot(c.vx, c.vz) || 1));
    // All-in: victim or the caster's own miss.
    if (rec.trig === 'fireAllInResolution') {
      const x = allInCaster(c);
      rec.allin = x ? (x.o === c ? { self: true } : { by: nm(x.o), ab: x.s.def.name }) : { by: '?' };
    }
    // Floor: the spot it last stood on (start of a step) is gone now.
    const lof = A.cur.lastOnFloor.get(c);
    rec.floorGone = lof ? !g.arena.isOnArena(lof.x, lof.z) : false;
    rec.lastOnFloorAgo = lof ? r4(t - lof.t) : null;
    const hole = A.cur.holes.filter((h) => h.t >= t - 0.05);
    if (rec.floorGone && hole.length) rec.floorBy = { by: hole[hole.length - 1].by, ab: hole[hole.length - 1].ab };
    // Window of impulses before the fall.
    const buf = A.cur.buf.get(c) ?? [];
    rec.hits = buf.filter((e) => e.t >= t - KEEP).map((e) => ({
      ago: r4(t - e.t), kind: e.kind, ab: e.ab, by: nm(e.by), mag: r2(Math.hypot(e.dvx, e.dvz)),
      radial: r2(e.dvx * e.rx + e.dvz * e.rz), ring: r2(e.ring), vs: e.vs, parts: e.parts ?? 1,
    }));
    // Context: zones, stun, confusion, own J.
    const zc = A.cur.zoneCtx.get(c);
    if (zc) {
      if (zc.iceT !== undefined && t - zc.iceT <= 1.0) rec.iceBy = zc.iceBy;
      if (zc.sinkT !== undefined && t - zc.sinkT <= 1.0) rec.sinkBy = zc.sinkBy;
    }
    const sb = A.cur.stunBy.get(c); if (sb && t - sb.t <= KEEP) rec.stunBy = { ...sb, ago: r4(t - sb.t) };
    const cb = A.cur.confBy.get(c); if (cb && t - cb.t <= 4.5) rec.confBy = { ...cb, ago: r4(t - cb.t) };
    const jt = A.cur.lastJ.get(c); rec.sinceOwnJ = jt !== undefined ? r4(t - jt) : null;
    const kt = A.cur.lastK.get(c); rec.sinceOwnK = kt !== undefined ? r4(t - kt) : null;
    rec.jName = c.abilityStates[0].def.name;
    A.cur.falls.push(rec);
  }

  // Sinkhole / ice owner of the zone at the critter's spot (null = none).
  function sinkOwner(c) {
    const all = [];
    AR.forEachSinkhole((z) => { const d = Math.hypot(z.x - c.x, z.z - c.z); if (d <= z.radius) all.push(z); }, c.config.name);
    if (!all.length) return null;
    for (const o of g.critters) {
      if (o === c) continue;
      let seen = false;
      AR.forEachSinkhole((z) => { if (z.x === all[0].x && z.z === all[0].z) seen = true; }, o.config.name);
      if (!seen) return o.config.name;
    }
    return '?';
  }
  function iceOwner(c) {
    const eff = AR.getSlipperyZone(c.x, c.z, c.config.name);
    if (!eff) return null;
    for (const o of g.critters) {
      if (o === c) continue;
      if (AR.getSlipperyZone(c.x, c.z, o.config.name) !== eff) return o.config.name;
    }
    return '?';
  }

  // QA: every dash contact (physics.ts takeDashContact adds the victim to
  // AbilityState.rammed) per dasher, force or not, to compare with the
  // dash impulses the setter saw.
  function tallyRammed() {
    const cur = A.cur;
    for (const c of g.critters) {
      const s = c.abilityStates[0];
      if (!s || !s.rammed) continue;
      const last = cur.rammedSize.get(s) ?? 0;
      const n = s.rammed.size;
      if (n > last) {
        const k = `rammed:${c.config.name}`; cur.counts[k] = (cur.counts[k] ?? 0) + (n - last);
        if (cfg.debugNudges) cur.others.push({ t: r4(now()), rammedBy: c.config.name, victims: [...s.rammed].slice(last).map(nm) });
      }
      cur.rammedSize.set(s, n);
    }
  }
  function preStep() {
    const cur = A.cur;
    if (pending) flushPending();
    tallyRammed();
    cur.step++;
    const t = now();
    for (const c of g.critters) {
      instrument(c);
      if (!cur.buf.has(c)) cur.buf.set(c, []);
      // Own J / K rising edges.
      const js = c.abilityStates[0]; const ks = c.abilityStates[1];
      const pj = cur.prevAct.get(c) ?? [false, false];
      if (js.active && !pj[0]) cur.lastJ.set(c, t);
      if (ks.active && !pj[1]) cur.lastK.set(c, t);
      cur.prevAct.set(c, [js.active, ks.active]);
      if (!live(c)) continue;
      if (g.arena.isOnArena(c.x, c.z)) cur.lastOnFloor.set(c, { x: c.x, z: c.z, t });
      const ice = iceOwner(c); const sink = sinkOwner(c);
      if (ice || sink) {
        const zc = cur.zoneCtx.get(c) ?? {};
        if (ice) { zc.iceT = t; zc.iceBy = ice; }
        if (sink) { zc.sinkT = t; zc.sinkBy = sink; }
        cur.zoneCtx.set(c, zc);
      }
    }
  }

  const sim = g.simulate;
  g.simulate = function (dt) {
    const cur = A.cur;
    if (cur) {
      if (this.phase === 'playing') { cur.playing = true; preStep(); }
    }
    const wasPlaying = this.phase === 'playing';
    sim.call(this, dt);
    if (cur) {
      if (pending) flushPending();
      cur.playing = this.phase === 'playing';
      if (cur.playing) cur.steps++;
      // The outcome, frozen on the very step the match ends: the 'ended'
      // phase keeps simulating falls, so reading it later (wall-clock) made
      // a bot's last fall count or not depending on timing.
      if (wasPlaying && !cur.playing && !cur.endSnap) {
        cur.endSnap = { t: now(), critters: this.critters.map((c) => ({ c, alive: c.alive, lives: c.lives, falling: c.falling })) };
      }
    }
  };

  A.begin = (spec) => {
    A.cur = {
      spec, T0: 0, step: 0, steps: 0, playing: false,
      buf: new Map(), lastOnFloor: new Map(), zoneCtx: new Map(), stunBy: new Map(), confBy: new Map(),
      lastJ: new Map(), lastK: new Map(), prevAct: new Map(), rammedSize: new Map(),
      falls: [], hitList: [], holes: [], statusList: [], others: [], counts: {},
    };
  };
  A.armed = () => { A.cur.T0 = g.matchTimer; for (const c of g.critters) instrument(c); };
  A.end = () => {
    const cur = A.cur;
    if (pending) flushPending();
    tallyRammed();
    cur.playing = false;
    const dur = cur.T0 - g.matchTimer;
    const rec = window.__devApi.getRecording();
    const evs = (rec?.events ?? []).filter((e) => e.type !== 'match_ended' && e.actor !== 'lab');
    let h = 5381;
    const norm = evs.map((e) => `${e.type}|${e.actor ?? ''}|${e.details ?? ''}`).join('\n');
    for (let i = 0; i < norm.length; i++) h = ((h * 33) ^ norm.charCodeAt(i)) >>> 0;
    const recFalls = {};
    for (const e of evs) if (e.type === 'fall') recFalls[e.actor] = (recFalls[e.actor] ?? 0) + 1;
    // Outcome at the end step (endSnap); a critter falling with no lives left
    // counts as eliminated; the winner is the only one alive with lives left.
    const snap = cur.endSnap?.critters ?? g.critters.map((c) => ({ c, alive: c.alive, lives: c.lives, falling: c.falling }));
    const standing = snap.filter((x) => x.alive && x.lives > 0);
    const out = {
      ...cur.spec,
      durationSim: r4(dur), steps: cur.steps,
      phase: g.phase, matchTimerExpired: g.matchTimer <= 0, endSnapAt: cur.endSnap ? r4(cur.endSnap.t) : null,
      outcome: rec?.outcome ?? null, eventsHash: h.toString(16), eventCount: evs.length, recFalls,
      critters: snap.map((x, i) => ({
        name: nm(x.c), role: i === 0 ? 'P' : 'B', alive: x.alive, lives: x.lives, falling: x.falling,
        eliminated: !x.alive || x.lives <= 0,
        won: standing.length === 1 && standing[0] === x,
      })),
      falls: cur.falls,
      hits: cur.hitList.map((e) => ({
        t: r4(e.t), v: nm(e.v), by: nm(e.by), kind: e.kind, ab: e.ab, mag: r2(Math.hypot(e.dvx, e.dvz)),
        radial: r2(e.dvx * e.rx + e.dvz * e.rz), ring: r2(e.ring), vs: e.vs, parts: e.parts ?? 1,
        gap: e.gap !== undefined ? +e.gap.toExponential(2) : undefined,
      })),
      holes: cur.holes.map((h2) => ({ ...h2, t: r4(h2.t) })),
      status: cur.statusList,
      others: cur.others.slice(0, 50),
      counts: cur.counts,
    };
    A.cur = null;
    return out;
  };
  return A.installInfo;
}

// ---- runner ------------------------------------------------------------------
// Robust to a loaded machine: every page call has a deadline; a crashed or
// hung page closes the whole browser (with a deadline too) and relaunches it;
// each failed match is retried up to --retries times; results are saved after
// every match and --resume skips the specs already in --out.
const gpuArgs = opt['no-gpu'] ? [] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const cfg = { th: Number(opt.th), window: Number(opt.window), debugNudges: opt['debug-nudges'] };
const speed = Number(opt.speed);
const RETRIES = Number(opt.retries);

function withDeadline(p, ms, what) {
  let timer;
  return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`pagina colgada (${what})`)), ms); })]).finally(() => clearTimeout(timer));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null;
async function launch() {
  browser = await withDeadline(launchMutedBrowser(opt['no-gpu'] ? {} : { channel: 'chromium', args: gpuArgs }), 60000, 'launch');
}
async function closeBrowser() {
  const b = browser; browser = null;
  if (!b) return;
  try { await withDeadline(b.close(), 15000, 'close'); } catch (e) { console.error(`[${opt.shard}] browser.close: ${e.message} (node pid ${process.pid})`); }
}

async function openPage() {
  if (!browser) await launch();
  const page = await withDeadline(newMutedPage(browser, { viewport: { width: 640, height: 480 } }), 30000, 'newPage');
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
  await withDeadline(page.goto(new URL('/tools.html', opt.url).href, { waitUntil: 'domcontentloaded' }), 60000, 'goto');
  await page.waitForFunction(() => Boolean(window.__devApi) && Boolean(window.__game) && Boolean(window.__feel), null, { timeout: 60000 });
  // A lineup must exist for the identity check: start + end a throwaway match.
  await withDeadline(page.evaluate(() => { window.__devApi.startMatch('Sergei', ['Trunk'], { seed: 1 }); }), 30000, 'warmup');
  const info = await withDeadline(page.evaluate(install, cfg), 30000, 'install');
  await withDeadline(page.evaluate(() => window.__devApi.endMatch()), 30000, 'warmup-end');
  if (info.identity !== 'same-instance') throw new Error(`module identity check failed: ${info.identity}`);
  if (info.kitIdentity !== 'same-instance') throw new Error(`abilities.ts identity check failed: ${info.kitIdentity}`);
  return { page, info };
}

let kitLogged = false;
async function runMatch(page, spec) {
  const kitLog = await withDeadline(page.evaluate((kit) => window.__attr.applyKit(kit), kit), 30000, 'kit');
  if (!kitLogged && kit.length) { console.log(`[${opt.shard}] --kit: ${kitLog.join(' · ')}`); kitLogged = true; }
  await withDeadline(page.evaluate(({ spec, feel, speed }) => {
    const FEEL = window.__feel;
    for (const [p, v] of Object.entries(feel)) {
      const [s, k] = p.split('.');
      if (typeof FEEL[s]?.[k] !== 'number') throw new Error(`--feel: FEEL.${p} no existe o no es numerico`);
      FEEL[s][k] = v;
    }
    const api = window.__devApi;
    window.__attr.begin(spec);
    api.setAutopilot(true);
    api.setFixedStep(speed);
    if (api.getSpeed() === 0) api.setSpeed(1);
    api.startMatch(spec.player, spec.bots, { seed: spec.seed });
    window.__attr.armed();
  }, { spec, feel, speed }), 30000, 'start');
  const t0 = Date.now();
  let lastT = null; let lastProg = Date.now();
  for (;;) {
    const s = await withDeadline(page.evaluate(() => ({ ph: window.__game.phase, t: window.__game.matchTimer })), 30000, 'poll');
    if (s.ph === 'ended') break;
    if (s.t !== lastT) { lastT = s.t; lastProg = Date.now(); }
    if (Date.now() - lastProg > 30000) throw new Error('sin progreso 30 s');
    if (Date.now() - t0 > 600000) throw new Error('mas de 10 min');
    await sleep(200);
  }
  // Let the recording log its match_ended (dev-api closes it on its 200 ms grid).
  const t1 = Date.now();
  while (Date.now() - t1 < 5000) {
    if (await withDeadline(page.evaluate(() => window.__devApi.getRecording()?.outcome.reason != null), 30000, 'rec')) break;
    await sleep(50);
  }
  const rec = await withDeadline(page.evaluate(() => window.__attr.end()), 60000, 'end');
  rec.wallSec = +((Date.now() - t0) / 1000).toFixed(1);
  return rec;
}

let results = [];
const failures = [];
let info = { identity: '?', kitIdentity: '?' };
if (opt.resume && existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'));
  results = prev.matches ?? [];
  console.log(`[${opt.shard}] --resume: ${results.length} partidas ya hechas en ${OUT}`);
}
const done = new Set(results.map((r) => r.idx));
const todo = mine.filter((s) => !done.has(s.idx));
const save = () => {
  mkdirSync(dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, JSON.stringify({
    version: 1, generatedAtIso: new Date().toISOString(),
    config: { url: opt.url, shard: opt.shard, speed, feel, kit, kitIdentity: info.kitIdentity, th: cfg.th, window: cfg.window, gpu: !opt['no-gpu'], identity: info.identity },
    plan: mine, failures, matches: [...results].sort((a, b) => a.idx - b.idx),
  }));
  renameSync(tmp, OUT);
};
let page = null;
try {
  for (const [i, spec] of todo.entries()) {
    let ok = false;
    for (let attempt = 0; attempt <= RETRIES && !ok; attempt++) {
      try {
        if (!page) ({ page, info } = await openPage());
        const r = await runMatch(page, spec);
        if (attempt > 0) r.retries = attempt;
        results.push(r);
        ok = true;
        console.log(`[${opt.shard}] ${i + 1}/${todo.length} #${spec.idx} ${spec.player} vs ${spec.bots.join(',')} seed ${spec.seed}: ${r.durationSim.toFixed(1)} s sim, ${r.falls.length} caidas, ${r.hits.length} golpes, ${r.wallSec} s`);
      } catch (e) {
        console.error(`[${opt.shard}] #${spec.idx} FALLO (intento ${attempt + 1}): ${e.message}`);
        if (/identity check failed/.test(e.message)) throw e;
        page = null;
        await closeBrowser(); // crashed/hung renderer: start again from a fresh browser
        await sleep(2000);
      }
    }
    if (!ok) failures.push({ ...spec, error: 'agotados los reintentos' });
    save();
  }
} finally {
  save();
  await closeBrowser();
}
console.log(`→ ${OUT} (${results.length} partidas, ${failures.length} fallos)`);
