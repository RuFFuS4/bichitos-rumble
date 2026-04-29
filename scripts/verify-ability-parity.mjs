// ---------------------------------------------------------------------------
// Ability parity audit — client vs server (post-Candidate-Final v0.10)
// ---------------------------------------------------------------------------
//
// Reads `src/abilities.ts` (client) and `server/src/sim/abilities.ts`
// (server), pulls the gameplay-driving fields per critter, and asserts
// they match bit-for-bit between the two files. Covers:
//
//   · K parity (ground_pound):  radius / force / windUp / cooldown
//   · K parity (Kermit / Kowalski lingering zone): radius / duration / slowMultiplier
//   · K parity (Cheeto blink):  blinkDistance / cooldown / windUp
//   · L parity (frenzy):        cooldown / duration / windUp / spd× / mass×
//   · Trunk + Sergei sentinels stay at known-good values
//
// Hardcoded against the v0.10 Candidate Final tuning. Re-run by hand
// after any tuning pass; if intentional drift, update the `expected`
// table here in the SAME commit.
//
// Run:
//   node scripts/verify-ability-parity.mjs
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';

const cli = await readFile('src/abilities.ts', 'utf-8');
const srv = await readFile('server/src/sim/abilities.ts', 'utf-8');

// Per-character expected post-v0.10 Candidate Final.
//   K can be either a 'pound' (radius/force/wU/CD, optional zone) or a
//   'blink' (blinkDistance/wU/CD).
const expected = {
  Kurama:    {
    // 2026-04-29 final-K: same durations, decoy-first + retreat
    // backward (logic change, no numeric drift).
    K: { kind: 'pound', rad: 0, frc: 0, wU: 0.10, CD: 9.0,
         selfBuff: { immunity: 2.8 } },
    L: { dur: 3.5, CD: 16.0, wU: 0.30, spd: 1.50, mass: 1.20 },
  },
  Shelly:    {
    // 2026-04-29 K-refinement: Steel Shell duration 5 → 4 + anchored.
    K: { kind: 'pound', rad: 0, frc: 0, wU: 0.20, CD: 12.0,
         selfBuff: { immunity: 4.0 } },
    L: { dur: 3.5, CD: 18.0, wU: 0.40, spd: 1.20, mass: 1.65 },
  },
  Kermit:    {
    // 2026-04-29 K-refinement: zone duration 2.0 → 10.0, cooldown 7 → 16.
    K: { kind: 'pound', rad: 5.0, frc: 14, wU: 0.15, CD: 16.0,
         zone: { rad: 5.0, dur: 10.0, slow: 0.60 } },
    L: { dur: 4.0, CD: 18.0, wU: 0.40, spd: 1.10, mass: 1.80 },
  },
  Sihans:    {
    // 2026-04-29 K-refinement: blinkDistance 3.5 → 6.5.
    K: { kind: 'blink', blinkDistance: 6.5, wU: 0.20, CD: 7.0,
         zone: { rad: 3.5, dur: 2.5, slow: 0.50 } },
    L: { dur: 4.5, CD: 20.0, wU: 0.40, spd: 1.15, mass: 1.50 },
  },
  Kowalski:  {
    // 2026-04-29 final-K: windUp 1.10 → 0.50, cooldown 6.5 → 6.0,
    // slowDur 2.0 → 5.0.
    K: { kind: 'projectile', wU: 0.50, CD: 6.0,
         projectile: { speed: 18, ttl: 1.2, radius: 0.55, impulse: 22, slowDur: 5.0 } },
    L: { dur: 3.0, CD: 17.0, wU: 0.40, spd: 1.40, mass: 1.10 },
  },
  Cheeto:    {
    // 2026-04-29 K-refinement: seek-nearest. Impact rad 2.6→3.2,
    // force 36→48.
    K: { kind: 'blink', blinkDistance: 4.5, wU: 0.06, CD: 5.5,
         impact: { rad: 3.2, frc: 48 } },
    L: { dur: 2.0, CD: 14.0, wU: 0.35, spd: 1.55, mass: 1.05 },
  },
  Sebastian: {
    // 2026-04-29 final-K: force 38 → 76 (Rafa: "duplicar potencia").
    K: { kind: 'pound', rad: 3.5, frc: 76, wU: 0.30, CD: 6.5 },
    L: { dur: 2.5, CD: 15.0, wU: 0.40, spd: 1.20, mass: 1.20 },
  },
};

function findCriterBlock(text, name) {
  const idx = text.indexOf(name + ': [');
  if (idx < 0) return null;
  let depth = 0;
  let i = idx + name.length + 3;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '[') depth++;
    if (ch === ']') {
      if (depth === 0) return text.slice(idx, i + 1);
      depth--;
    }
  }
  return null;
}

function pickFirst(block, regex) {
  const m = block.match(regex);
  return m ? parseFloat(m[1]) : null;
}

let ok = true;
function fail(msg) { ok = false; console.log('  FAIL ' + msg); }

for (const [name, e] of Object.entries(expected)) {
  const cliBlock = findCriterBlock(cli, name);
  const srvBlock = findCriterBlock(srv, name);
  if (!cliBlock || !srvBlock) {
    fail(`${name} block not found cli=${!!cliBlock} srv=${!!srvBlock}`);
    continue;
  }

  // K — depends on kind
  if (e.K.kind === 'pound') {
    const cliK = cliBlock.match(/makeGroundPound\(\{[\s\S]*?radius:\s*([\d.]+),\s*force:\s*([\d.]+),\s*windUp:\s*([\d.]+),\s*cooldown:\s*([\d.]+)/);
    const srvK = srvBlock.match(/type:\s*'ground_pound'[\s\S]*?cooldown:\s*([\d.]+),\s*duration:\s*[\d.]+,\s*windUp:\s*([\d.]+)[,\s\S]*?radius:\s*([\d.]+),\s*force:\s*([\d.]+)/);
    if (!cliK || !srvK) {
      fail(`${name} K (pound) parse fail cli=${!!cliK} srv=${!!srvK}`);
      continue;
    }
    const cR = parseFloat(cliK[1]), cF = parseFloat(cliK[2]), cW = parseFloat(cliK[3]), cC = parseFloat(cliK[4]);
    const sC = parseFloat(srvK[1]), sW = parseFloat(srvK[2]), sR = parseFloat(srvK[3]), sF = parseFloat(srvK[4]);
    const same = cR === sR && cF === sF && cW === sW && cC === sC;
    const matchesExpected = cR === e.K.rad && cF === e.K.frc && cW === e.K.wU && cC === e.K.CD;
    const tag = same && matchesExpected ? 'OK' : 'FAIL';
    if (tag === 'FAIL') ok = false;
    console.log(`${name.padEnd(10)} K  pound rad/frc/wU/CD  cli ${cR}/${cF}/${cW}/${cC}  srv ${sR}/${sF}/${sW}/${sC}  ${tag}`);
    if (e.K.zone) {
      const cliZ = cliBlock.match(/zone:\s*\{[\s\S]*?radius:\s*([\d.]+),\s*duration:\s*([\d.]+),\s*slowMultiplier:\s*([\d.]+)/);
      const srvZ = srvBlock.match(/zone:\s*\{\s*radius:\s*([\d.]+),\s*duration:\s*([\d.]+),\s*slowMultiplier:\s*([\d.]+)/);
      if (!cliZ || !srvZ) {
        fail(`${name} zone parse fail cli=${!!cliZ} srv=${!!srvZ}`);
        continue;
      }
      const cZr = parseFloat(cliZ[1]), cZd = parseFloat(cliZ[2]), cZs = parseFloat(cliZ[3]);
      const sZr = parseFloat(srvZ[1]), sZd = parseFloat(srvZ[2]), sZs = parseFloat(srvZ[3]);
      const zSame = cZr === sZr && cZd === sZd && cZs === sZs;
      const zMatches = cZr === e.K.zone.rad && cZd === e.K.zone.dur && cZs === e.K.zone.slow;
      const zTag = zSame && zMatches ? 'OK' : 'FAIL';
      if (zTag === 'FAIL') ok = false;
      console.log(`${name.padEnd(10)} K  zone  rad/dur/slow      cli ${cZr}/${cZd}/${cZs}  srv ${sZr}/${sZd}/${sZs}  ${zTag}`);
    }
    // v0.11 — selfBuff (Shelly Steel Shell, Kurama Mirror Trick).
    // Cliente uses `selfImmunityDuration: <num>`, server mirrors it.
    if (e.K.selfBuff) {
      const cliImm = pickFirst(cliBlock, /selfImmunityDuration:\s*([\d.]+)/);
      const srvImm = pickFirst(srvBlock, /selfImmunityDuration:\s*([\d.]+)/);
      const same = cliImm === srvImm && cliImm === e.K.selfBuff.immunity;
      const tag = same ? 'OK' : 'FAIL';
      if (tag === 'FAIL') ok = false;
      console.log(`${name.padEnd(10)} K  selfBuff immunity      cli ${cliImm}  srv ${srvImm}  ${tag}`);
    }
  } else if (e.K.kind === 'projectile') {
    // 2026-04-29 — Kowalski Snowball. Cliente uses makeProjectile,
    // server uses type: 'projectile'. Compare per-field.
    const cliPS = pickFirst(cliBlock, /makeProjectile\(\{[\s\S]*?projectileSpeed:\s*([\d.]+)/);
    const cliPT = pickFirst(cliBlock, /makeProjectile\(\{[\s\S]*?projectileTtl:\s*([\d.]+)/);
    const cliPR = pickFirst(cliBlock, /makeProjectile\(\{[\s\S]*?projectileRadius:\s*([\d.]+)/);
    const cliPI = pickFirst(cliBlock, /makeProjectile\(\{[\s\S]*?projectileImpulse:\s*([\d.]+)/);
    const cliPSlow = pickFirst(cliBlock, /makeProjectile\(\{[\s\S]*?projectileSlowDuration:\s*([\d.]+)/);
    const cliWU = pickFirst(cliBlock, /makeProjectile\(\{[\s\S]*?windUp:\s*([\d.]+)/);
    const cliCD = pickFirst(cliBlock, /makeProjectile\(\{[\s\S]*?cooldown:\s*([\d.]+)/);
    const srvPS = pickFirst(srvBlock, /type:\s*'projectile'[\s\S]*?projectileSpeed:\s*([\d.]+)/);
    const srvPT = pickFirst(srvBlock, /type:\s*'projectile'[\s\S]*?projectileTtl:\s*([\d.]+)/);
    const srvPR = pickFirst(srvBlock, /type:\s*'projectile'[\s\S]*?projectileRadius:\s*([\d.]+)/);
    const srvPI = pickFirst(srvBlock, /type:\s*'projectile'[\s\S]*?projectileImpulse:\s*([\d.]+)/);
    const srvPSlow = pickFirst(srvBlock, /type:\s*'projectile'[\s\S]*?projectileSlowDuration:\s*([\d.]+)/);
    const srvWU = pickFirst(srvBlock, /type:\s*'projectile'[\s\S]*?windUp:\s*([\d.]+)/);
    const srvCD = pickFirst(srvBlock, /type:\s*'projectile',\s*cooldown:\s*([\d.]+)/);
    const same =
      cliPS === srvPS && cliPT === srvPT && cliPR === srvPR &&
      cliPI === srvPI && cliPSlow === srvPSlow &&
      cliWU === srvWU && cliCD === srvCD;
    const matches =
      cliPS === e.K.projectile.speed && cliPT === e.K.projectile.ttl &&
      cliPR === e.K.projectile.radius && cliPI === e.K.projectile.impulse &&
      cliPSlow === e.K.projectile.slowDur &&
      cliWU === e.K.wU && cliCD === e.K.CD;
    const tag = same && matches ? 'OK' : 'FAIL';
    if (tag === 'FAIL') ok = false;
    console.log(`${name.padEnd(10)} K  proj spd/ttl/rad/imp/slow/wU/CD  cli ${cliPS}/${cliPT}/${cliPR}/${cliPI}/${cliPSlow}/${cliWU}/${cliCD}  srv ${srvPS}/${srvPT}/${srvPR}/${srvPI}/${srvPSlow}/${srvWU}/${srvCD}  ${tag}`);
  } else if (e.K.kind === 'blink') {
    // Cliente: blinkDistance can appear before or after cooldown — match field-by-field.
    const cliBlinkDist = pickFirst(cliBlock, /makeBlink\(\{[\s\S]*?blinkDistance:\s*([\d.]+)/);
    const cliBlinkCD = pickFirst(cliBlock, /makeBlink\(\{[\s\S]*?cooldown:\s*([\d.]+)/);
    const cliBlinkWU = pickFirst(cliBlock, /makeBlink\(\{[\s\S]*?windUp:\s*([\d.]+)/);
    const srvBlinkCD = pickFirst(srvBlock, /type:\s*'blink',\s*cooldown:\s*([\d.]+)/);
    const srvBlinkWU = pickFirst(srvBlock, /type:\s*'blink'[\s\S]*?windUp:\s*([\d.]+)/);
    const srvBlinkDist = pickFirst(srvBlock, /type:\s*'blink'[\s\S]*?blinkDistance:\s*([\d.]+)/);
    if (cliBlinkDist == null || srvBlinkDist == null) {
      fail(`${name} K (blink) parse fail cli=${cliBlinkDist != null} srv=${srvBlinkDist != null}`);
      continue;
    }
    const same = cliBlinkDist === srvBlinkDist && cliBlinkCD === srvBlinkCD && cliBlinkWU === srvBlinkWU;
    const matches = cliBlinkDist === e.K.blinkDistance && cliBlinkCD === e.K.CD && cliBlinkWU === e.K.wU;
    const tag = same && matches ? 'OK' : 'FAIL';
    if (tag === 'FAIL') ok = false;
    console.log(`${name.padEnd(10)} K  blink dist/wU/CD       cli ${cliBlinkDist}/${cliBlinkWU}/${cliBlinkCD}  srv ${srvBlinkDist}/${srvBlinkWU}/${srvBlinkCD}  ${tag}`);
    // Optional zone (Sihans Sand Trap)
    if (e.K.zone) {
      const cliZ = cliBlock.match(/makeBlink\(\{[\s\S]*?zone:\s*\{[\s\S]*?radius:\s*([\d.]+),\s*duration:\s*([\d.]+),\s*slowMultiplier:\s*([\d.]+)/);
      const srvZ = srvBlock.match(/type:\s*'blink'[\s\S]*?zone:\s*\{\s*radius:\s*([\d.]+),\s*duration:\s*([\d.]+),\s*slowMultiplier:\s*([\d.]+)/);
      if (!cliZ || !srvZ) {
        fail(`${name} blink-zone parse fail cli=${!!cliZ} srv=${!!srvZ}`);
        continue;
      }
      const cZr = parseFloat(cliZ[1]), cZd = parseFloat(cliZ[2]), cZs = parseFloat(cliZ[3]);
      const sZr = parseFloat(srvZ[1]), sZd = parseFloat(srvZ[2]), sZs = parseFloat(srvZ[3]);
      const zSame = cZr === sZr && cZd === sZd && cZs === sZs;
      const zMatches = cZr === e.K.zone.rad && cZd === e.K.zone.dur && cZs === e.K.zone.slow;
      const zTag = zSame && zMatches ? 'OK' : 'FAIL';
      if (zTag === 'FAIL') ok = false;
      console.log(`${name.padEnd(10)} K  blink-zone rad/dur/slow cli ${cZr}/${cZd}/${cZs}  srv ${sZr}/${sZd}/${sZs}  ${zTag}`);
    }
    // Optional impact (Cheeto Shadow Step)
    if (e.K.impact) {
      const cliR = pickFirst(cliBlock, /makeBlink\(\{[\s\S]*?blinkImpactRadius:\s*([\d.]+)/);
      const cliF = pickFirst(cliBlock, /makeBlink\(\{[\s\S]*?blinkImpactForce:\s*([\d.]+)/);
      const srvR = pickFirst(srvBlock, /type:\s*'blink'[\s\S]*?blinkImpactRadius:\s*([\d.]+)/);
      const srvF = pickFirst(srvBlock, /type:\s*'blink'[\s\S]*?blinkImpactForce:\s*([\d.]+)/);
      const same2 = cliR === srvR && cliF === srvF;
      const matches2 = cliR === e.K.impact.rad && cliF === e.K.impact.frc;
      const tag2 = same2 && matches2 ? 'OK' : 'FAIL';
      if (tag2 === 'FAIL') ok = false;
      console.log(`${name.padEnd(10)} K  blink-impact rad/frc   cli ${cliR}/${cliF}  srv ${srvR}/${srvF}  ${tag2}`);
    }
  }

  // L (always frenzy)
  if (e.L) {
    const cliL = cliBlock.match(/makeFrenzy\(\{[\s\S]*?duration:\s*([\d.]+),\s*cooldown:\s*([\d.]+),\s*windUp:\s*([\d.]+),\s*speedMultiplier:\s*([\d.]+),\s*massMultiplier:\s*([\d.]+)/);
    const srvL = srvBlock.match(/type:\s*'frenzy'[\s\S]*?cooldown:\s*([\d.]+),\s*duration:\s*([\d.]+),\s*windUp:\s*([\d.]+),\s*frenzySpeedMult:\s*([\d.]+),\s*frenzyMassMult:\s*([\d.]+)/);
    if (!cliL || !srvL) {
      fail(`${name} L parse fail cli=${!!cliL} srv=${!!srvL}`);
      continue;
    }
    const cD = parseFloat(cliL[1]), cC = parseFloat(cliL[2]), cW = parseFloat(cliL[3]), cS = parseFloat(cliL[4]), cM = parseFloat(cliL[5]);
    const sC = parseFloat(srvL[1]), sD = parseFloat(srvL[2]), sW = parseFloat(srvL[3]), sS = parseFloat(srvL[4]), sM = parseFloat(srvL[5]);
    const same = cD === sD && cC === sC && cW === sW && cS === sS && cM === sM;
    const matches = cD === e.L.dur && cC === e.L.CD && cW === e.L.wU && cS === e.L.spd && cM === e.L.mass;
    const tag = same && matches ? 'OK' : 'FAIL';
    if (tag === 'FAIL') ok = false;
    console.log(`${name.padEnd(10)} L  dur/CD/wU/spd/mass      cli ${cD}/${cC}/${cW}/${cS}/${cM}  srv ${sD}/${sC}/${sW}/${sS}/${sM}  ${tag}`);
  }
}

// Sentinels — 2026-04-29 final-K retuned values for Trunk + Sergei.
// Trunk K is now Grip (radius 0, gripK: true) so the sentinel checks
// the gripStunDuration mirrored value instead. Sergei K force 34 → 68.
const sentinels = {
  Trunk:  { gripStun: 2.0, L: { spd: 1.35, mass: 2.10 } },
  Sergei: { K: { rad: 3.5, frc: 68 }, L: { spd: 1.55, mass: 1.75 } },
};
for (const [name, e] of Object.entries(sentinels)) {
  const cliBlock = findCriterBlock(cli, name);
  const srvBlock = findCriterBlock(srv, name);
  if (e.gripStun !== undefined) {
    const cliG = pickFirst(cliBlock, /gripStunDuration:\s*([\d.]+)/);
    const srvG = pickFirst(srvBlock, /gripStunDuration:\s*([\d.]+)/);
    const cliS = pickFirst(cliBlock, /makeFrenzy\(\{[\s\S]*?speedMultiplier:\s*([\d.]+)/);
    const srvS = pickFirst(srvBlock, /type:\s*'frenzy'[\s\S]*?frenzySpeedMult:\s*([\d.]+)/);
    const matches = cliG === e.gripStun && srvG === e.gripStun && cliS === e.L.spd && srvS === e.L.spd;
    console.log(`${name.padEnd(10)} sentinel  gripStun cli/srv ${cliG}/${srvG}  L spd cli/srv ${cliS}/${srvS}  ${matches ? 'OK' : 'FAIL'}`);
    if (!matches) ok = false;
    continue;
  }
  const cliR = pickFirst(cliBlock, /makeGroundPound\(\{[\s\S]*?radius:\s*([\d.]+)/);
  const srvR = pickFirst(srvBlock, /type:\s*'ground_pound'[\s\S]*?radius:\s*([\d.]+)/);
  const cliF = pickFirst(cliBlock, /makeGroundPound\(\{[\s\S]*?force:\s*([\d.]+)/);
  const srvF = pickFirst(srvBlock, /type:\s*'ground_pound'[\s\S]*?force:\s*([\d.]+)/);
  const cliS = pickFirst(cliBlock, /makeFrenzy\(\{[\s\S]*?speedMultiplier:\s*([\d.]+)/);
  const srvS = pickFirst(srvBlock, /type:\s*'frenzy'[\s\S]*?frenzySpeedMult:\s*([\d.]+)/);
  const matches = cliR === e.K.rad && srvR === e.K.rad &&
    cliF === e.K.frc && srvF === e.K.frc &&
    cliS === e.L.spd && srvS === e.L.spd;
  console.log(`${name.padEnd(10)} sentinel  K rad/frc cli/srv ${cliR}/${srvR}/${cliF}/${srvF}  L spd cli/srv ${cliS}/${srvS}  ${matches ? 'OK' : 'FAIL'}`);
  if (!matches) ok = false;
}

console.log(ok ? '\nALL PARITY CHECKS PASSED' : '\nPARITY DRIFT DETECTED');
process.exit(ok ? 0 : 1);
