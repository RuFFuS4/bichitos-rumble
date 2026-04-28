// ---------------------------------------------------------------------------
// Ability parity audit — client vs server
// ---------------------------------------------------------------------------
//
// One-shot guard run after tuning passes. Reads the per-character ability
// blocks from `src/abilities.ts` (client) and `server/src/sim/abilities.ts`
// (server), pulls the numeric fields that drive online/offline parity
// (radius, force, windUp, cooldown for K; cooldown / duration / windUp /
// speedMultiplier / massMultiplier for L), and asserts they match.
//
// Reports per-character OK/FAIL plus an aggregate verdict. Exit code 1 on
// any drift so CI can block the merge.
//
// Run:
//   node scripts/verify-ability-parity.mjs
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';

const cli = await readFile('src/abilities.ts', 'utf-8');
const srv = await readFile('server/src/sim/abilities.ts', 'utf-8');

// Per-character expected post-Bloque-A. K==null means K wasn't refit
// (only the L was customised); we still check the L parity.
const expected = {
  Kurama:    { K: { rad: 3.5, frc: 16, wU: 0.10, CD: 5.5 }, L: { dur: 3.5, CD: 16.0, wU: 0.30, spd: 1.50, mass: 1.20 } },
  Shelly:    { K: { rad: 4.0, frc: 32, wU: 0.45, CD: 7.5 }, L: { dur: 3.5, CD: 18.0, wU: 0.40, spd: 1.20, mass: 1.65 } },
  Kermit:    { K: { rad: 5.0, frc: 14, wU: 0.15, CD: 7.0 }, L: { dur: 4.0, CD: 18.0, wU: 0.40, spd: 1.10, mass: 1.80 } },
  Sihans:    { K: null, L: { dur: 4.5, CD: 20.0, wU: 0.40, spd: 1.15, mass: 1.50 } },
  Kowalski:  { K: null, L: { dur: 3.0, CD: 17.0, wU: 0.40, spd: 1.40, mass: 1.10 } },
  Cheeto:    { K: null, L: { dur: 2.0, CD: 14.0, wU: 0.35, spd: 1.55, mass: 1.05 } },
  Sebastian: { K: null, L: { dur: 2.5, CD: 15.0, wU: 0.40, spd: 1.20, mass: 1.20 } },
};

function findCriterBlock(text, name) {
  // Crude but works for both file shapes: locate `Name: [` and read until
  // matching `]` closing on its own line.
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
for (const [name, e] of Object.entries(expected)) {
  const cliBlock = findCriterBlock(cli, name);
  const srvBlock = findCriterBlock(srv, name);
  if (!cliBlock || !srvBlock) {
    console.log(`${name} block not found cli=${!!cliBlock} srv=${!!srvBlock}`);
    ok = false;
    continue;
  }

  if (e.K) {
    // Each block has exactly one ground_pound entry; pick the radius/force
    // that appear inside the makeGroundPound or `type: 'ground_pound'` entry.
    const cliK = cliBlock.match(/makeGroundPound\(\{[\s\S]*?radius:\s*([\d.]+),\s*force:\s*([\d.]+),\s*windUp:\s*([\d.]+),\s*cooldown:\s*([\d.]+)/);
    const srvK = srvBlock.match(/type:\s*'ground_pound'[\s\S]*?cooldown:\s*([\d.]+),\s*duration:\s*[\d.]+,\s*windUp:\s*([\d.]+)[,\s\S]*?radius:\s*([\d.]+),\s*force:\s*([\d.]+)/);
    if (!cliK || !srvK) {
      console.log(`${name} K parse fail cli=${!!cliK} srv=${!!srvK}`);
      ok = false;
      continue;
    }
    const cR = parseFloat(cliK[1]), cF = parseFloat(cliK[2]), cW = parseFloat(cliK[3]), cC = parseFloat(cliK[4]);
    const sC = parseFloat(srvK[1]), sW = parseFloat(srvK[2]), sR = parseFloat(srvK[3]), sF = parseFloat(srvK[4]);
    const same = cR === sR && cF === sF && cW === sW && cC === sC;
    const matchesExpected = cR === e.K.rad && cF === e.K.frc && cW === e.K.wU && cC === e.K.CD;
    const tag = same && matchesExpected ? 'OK' : 'FAIL';
    if (tag === 'FAIL') ok = false;
    console.log(`${name.padEnd(10)} K  rad/frc/wU/CD  cli ${cR}/${cF}/${cW}/${cC}  srv ${sR}/${sF}/${sW}/${sC}  ${tag}`);
  }

  if (e.L) {
    const cliL = cliBlock.match(/makeFrenzy\(\{[\s\S]*?duration:\s*([\d.]+),\s*cooldown:\s*([\d.]+),\s*windUp:\s*([\d.]+),\s*speedMultiplier:\s*([\d.]+),\s*massMultiplier:\s*([\d.]+)/);
    const srvL = srvBlock.match(/type:\s*'frenzy'[\s\S]*?cooldown:\s*([\d.]+),\s*duration:\s*([\d.]+),\s*windUp:\s*([\d.]+),\s*frenzySpeedMult:\s*([\d.]+),\s*frenzyMassMult:\s*([\d.]+)/);
    if (!cliL || !srvL) {
      console.log(`${name} L parse fail cli=${!!cliL} srv=${!!srvL}`);
      ok = false;
      continue;
    }
    const cD = parseFloat(cliL[1]), cC = parseFloat(cliL[2]), cW = parseFloat(cliL[3]), cS = parseFloat(cliL[4]), cM = parseFloat(cliL[5]);
    const sC = parseFloat(srvL[1]), sD = parseFloat(srvL[2]), sW = parseFloat(srvL[3]), sS = parseFloat(srvL[4]), sM = parseFloat(srvL[5]);
    const same = cD === sD && cC === sC && cW === sW && cS === sS && cM === sM;
    const matchesExpected = cD === e.L.dur && cC === e.L.CD && cW === e.L.wU && cS === e.L.spd && cM === e.L.mass;
    const tag = same && matchesExpected ? 'OK' : 'FAIL';
    if (tag === 'FAIL') ok = false;
    console.log(`${name.padEnd(10)} L  dur/CD/wU/spd/mass  cli ${cD}/${cC}/${cW}/${cS}/${cM}  srv ${sD}/${sC}/${sW}/${sS}/${sM}  ${tag}`);
  }
}

// Trunk + Sergei should still match the values we didn't touch — sanity guard
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
