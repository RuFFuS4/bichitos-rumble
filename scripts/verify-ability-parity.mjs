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
    K: { kind: 'pound', rad: 3.5, frc: 16, wU: 0.10, CD: 5.5 },
    L: { dur: 3.5, CD: 16.0, wU: 0.30, spd: 1.50, mass: 1.20 },
  },
  Shelly:    {
    K: { kind: 'pound', rad: 4.0, frc: 32, wU: 0.45, CD: 7.5 },
    L: { dur: 3.5, CD: 18.0, wU: 0.40, spd: 1.20, mass: 1.65 },
  },
  Kermit:    {
    K: { kind: 'pound', rad: 5.0, frc: 14, wU: 0.15, CD: 7.0,
         zone: { rad: 5.0, dur: 2.0, slow: 0.60 } },
    L: { dur: 4.0, CD: 18.0, wU: 0.40, spd: 1.10, mass: 1.80 },
  },
  Sihans:    {
    K: { kind: 'pound', rad: 3.5, frc: 38, wU: 0.6, CD: 7.5 },
    L: { dur: 4.5, CD: 20.0, wU: 0.40, spd: 1.15, mass: 1.50 },
  },
  Kowalski:  {
    K: { kind: 'pound', rad: 5.0, frc: 20, wU: 0.4, CD: 7.0,
         zone: { rad: 5.0, dur: 1.6, slow: 0.55 } },
    L: { dur: 3.0, CD: 17.0, wU: 0.40, spd: 1.40, mass: 1.10 },
  },
  Cheeto:    {
    K: { kind: 'blink', blinkDistance: 4.5, wU: 0.06, CD: 5.5 },
    L: { dur: 2.0, CD: 14.0, wU: 0.35, spd: 1.55, mass: 1.05 },
  },
  Sebastian: {
    K: { kind: 'pound', rad: 2.8, frc: 40, wU: 0.3, CD: 6.5 },
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
  } else if (e.K.kind === 'blink') {
    const cliK = cliBlock.match(/makeBlink\(\{[\s\S]*?blinkDistance:\s*([\d.]+),\s*cooldown:\s*([\d.]+),\s*windUp:\s*([\d.]+)/);
    const srvK = srvBlock.match(/type:\s*'blink',\s*cooldown:\s*([\d.]+),\s*duration:\s*[\d.]+,\s*windUp:\s*([\d.]+),\s*blinkDistance:\s*([\d.]+)/);
    if (!cliK || !srvK) {
      fail(`${name} K (blink) parse fail cli=${!!cliK} srv=${!!srvK}`);
      continue;
    }
    const cD = parseFloat(cliK[1]), cC = parseFloat(cliK[2]), cW = parseFloat(cliK[3]);
    const sC = parseFloat(srvK[1]), sW = parseFloat(srvK[2]), sD = parseFloat(srvK[3]);
    const same = cD === sD && cC === sC && cW === sW;
    const matches = cD === e.K.blinkDistance && cC === e.K.CD && cW === e.K.wU;
    const tag = same && matches ? 'OK' : 'FAIL';
    if (tag === 'FAIL') ok = false;
    console.log(`${name.padEnd(10)} K  blink dist/wU/CD       cli ${cD}/${cW}/${cC}  srv ${sD}/${sW}/${sC}  ${tag}`);
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

// Sentinels — Trunk + Sergei stay at known-good v0.9 values
const sentinels = {
  Trunk:  { K: { rad: 4.5, frc: 40 }, L: { spd: 1.25, mass: 1.80 } },
  Sergei: { K: { rad: 3.5, frc: 34 }, L: { spd: 1.45, mass: 1.50 } },
};
for (const [name, e] of Object.entries(sentinels)) {
  const cliBlock = findCriterBlock(cli, name);
  const srvBlock = findCriterBlock(srv, name);
  const cliR = pickFirst(cliBlock, /makeGroundPound\(\{[\s\S]*?radius:\s*([\d.]+)/);
  const srvR = pickFirst(srvBlock, /type:\s*'ground_pound'[\s\S]*?radius:\s*([\d.]+)/);
  const cliS = pickFirst(cliBlock, /makeFrenzy\(\{[\s\S]*?speedMultiplier:\s*([\d.]+)/);
  const srvS = pickFirst(srvBlock, /type:\s*'frenzy'[\s\S]*?frenzySpeedMult:\s*([\d.]+)/);
  const matches = cliR === e.K.rad && srvR === e.K.rad && cliS === e.L.spd && srvS === e.L.spd;
  console.log(`${name.padEnd(10)} sentinel  K rad cli/srv ${cliR}/${srvR}  L spd cli/srv ${cliS}/${srvS}  ${matches ? 'OK' : 'FAIL'}`);
  if (!matches) ok = false;
}

console.log(ok ? '\nALL PARITY CHECKS PASSED' : '\nPARITY DRIFT DETECTED');
process.exit(ok ? 0 : 1);
