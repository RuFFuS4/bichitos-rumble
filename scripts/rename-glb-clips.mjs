#!/usr/bin/env node
// ---------------------------------------------------------------------------
// rename-glb-clips — canonicalise clip names inside critter GLBs
// ---------------------------------------------------------------------------
//
// Goal: erase the deuda técnica where many critter GLBs ship clip
// names that don't reflect the logical state they represent
// (Sergei's "Run" clip is actually idle, Kermit's "NlaTrack.004" is
// idle, etc.). This forces every per-critter override to carry a
// `clip` field just to remap the name. After this pass, GLBs become
// self-documenting and overrides stay only when speed/loop metadata
// is needed.
//
// The script reads `src/animation-overrides.ts` as the source of
// truth ("which clip in this GLB plays state X"), then for each
// critter:
//   1. Rewrites the GLB so the clip currently named X gets the
//      canonical state name (Idle/Run/Victory/.../Ability1/2/3).
//   2. Rewrites `animation-overrides.ts` to remove entries that
//      become redundant after renaming (clip-only entries auto-
//      resolve via tier-1 exact match) and keep only metadata-
//      bearing entries with the new clip name.
//
// Modes
// -----
//   default        — DRY RUN. Reports plan, writes nothing.
//   --apply        — actually modify GLBs + overrides.ts in place.
//
// Edge cases handled
// ------------------
//   · Circular renames (state X uses clip "Y" while state Y uses
//     clip "X"): two-phase rename via temp prefix avoids collisions.
//   · Shared clip across states (e.g. Trunk's ability_2/ability_3
//     both pointing to "Ability3GroundPound"): NOT renamed,
//     warning emitted, override entries left intact.
//   · Already-canonical clips (e.g. Cheeto's "Ability1Pounce" for
//     state ability_1 — close but not exactly "Ability1"): treated
//     as a normal rename to the canonical short form.
//   · States with no `clip` (e.g. Kermit's ability_3 procedural):
//     skipped silently.
//
// Safety
// ------
//   · Default is dry-run. Need `--apply` to write.
//   · GLBs are git-tracked so reverting is `git checkout
//     public/models/critters/`.
//   · Every modification reported in the dry-run output before
//     `--apply` runs the same plan for real.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const HELP = args.includes('--help') || args.includes('-h');

if (HELP) {
  console.log([
    'rename-glb-clips — canonicalise clip names inside critter GLBs',
    '',
    'Usage:',
    '  npm run rename-glb-clips             # DRY RUN — show plan, write nothing',
    '  npm run rename-glb-clips -- --apply  # actually rewrite GLBs + overrides.ts',
    '',
    'Reads src/animation-overrides.ts as input. Renames each critter\'s',
    'GLB clips to canonical state names (Idle/Run/Ability1/...). Removes',
    'override entries that become redundant after renaming.',
  ].join('\n'));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// State → canonical clip name mapping
// ---------------------------------------------------------------------------
//
// Mirrors the auto-resolver's exact-match expectations
// (`name.replace(/[_\s-]/g, '').toLowerCase() === state.replace(...)`).
// Using TitleCase keeps the convention shared with already-clean
// rigs like Sebastian (Ability2ClawSweep → Ability2 still matches
// state ability_2 via tier-3 contains, but tier-1 is preferred).

const STATE_TO_CANONICAL = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  victory: 'Victory',
  defeat: 'Defeat',
  fall: 'Fall',
  hit: 'Hit',
  respawn: 'Respawn',
  ability_1: 'Ability1',
  ability_2: 'Ability2',
  ability_3: 'Ability3',
  // headbutt_anticip / headbutt_lunge intentionally omitted — these
  // states are procedural in current rigs and we don't expect skeletal
  // clips for them.
};

// ---------------------------------------------------------------------------
// Read + parse animation-overrides.ts
// ---------------------------------------------------------------------------
//
// We grab the literal between `export const ANIMATION_OVERRIDES = ` and
// its matching `};`, then `Function()` it back into an in-memory JS
// object. Source is in our own repo so eval is safe; we just need a
// way to read TS object literals without bringing in tsc/tsx.

const OVERRIDES_PATH = 'src/animation-overrides.ts';
const tsSource = await readFile(OVERRIDES_PATH, 'utf8');

const startMarker = 'export const ANIMATION_OVERRIDES';
const startIdx = tsSource.indexOf(startMarker);
if (startIdx < 0) throw new Error(`couldn't find "${startMarker}" in ${OVERRIDES_PATH}`);
const eqIdx = tsSource.indexOf('=', startIdx);
const openBrace = tsSource.indexOf('{', eqIdx);
let depth = 0;
let close = -1;
for (let i = openBrace; i < tsSource.length; i++) {
  if (tsSource[i] === '{') depth++;
  else if (tsSource[i] === '}') {
    depth--;
    if (depth === 0) { close = i; break; }
  }
}
if (close < 0) throw new Error('ANIMATION_OVERRIDES literal never closes');
const literal = tsSource.slice(openBrace, close + 1);

// eslint-disable-next-line no-new-func
const overrides = new Function('return ' + literal)();

// ---------------------------------------------------------------------------
// Build the rename plan per critter
// ---------------------------------------------------------------------------

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function clipNameOf(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value.clip === 'string') return value.clip;
  return null;
}

const planByCritter = {};

for (const [critterId, states] of Object.entries(overrides)) {
  const usage = new Map(); // oldName → Set of states using it
  for (const [state, value] of Object.entries(states)) {
    const oldClip = clipNameOf(value);
    if (!oldClip) continue;
    if (!usage.has(oldClip)) usage.set(oldClip, new Set());
    usage.get(oldClip).add(state);
  }

  const renamePlan = new Map(); // oldName → newName
  const sharedClips = [];       // [oldName, [states]]
  for (const [oldClip, statesSet] of usage) {
    if (statesSet.size > 1) {
      sharedClips.push([oldClip, [...statesSet]]);
      continue;
    }
    const state = [...statesSet][0];
    const newName = STATE_TO_CANONICAL[state];
    if (!newName) continue;
    if (oldClip === newName) continue; // already canonical
    renamePlan.set(oldClip, newName);
  }

  planByCritter[critterId] = {
    renamePlan,
    sharedClips,
    glbPath: `public/models/critters/${critterId}.glb`,
  };
}

// ---------------------------------------------------------------------------
// Print the plan
// ---------------------------------------------------------------------------

console.log(`rename-glb-clips — mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
console.log(`source: ${OVERRIDES_PATH}`);
console.log(`critters with overrides: ${Object.keys(overrides).length}`);
console.log('');

let totalRenames = 0;
let totalShared = 0;
for (const [critterId, plan] of Object.entries(planByCritter)) {
  if (plan.renamePlan.size === 0 && plan.sharedClips.length === 0) {
    console.log(`· ${critterId} — no renames needed`);
    continue;
  }
  console.log(`· ${critterId}`);
  if (plan.renamePlan.size > 0) {
    for (const [from, to] of plan.renamePlan) {
      console.log(`    rename  ${from}  →  ${to}`);
    }
    totalRenames += plan.renamePlan.size;
  }
  if (plan.sharedClips.length > 0) {
    for (const [name, states] of plan.sharedClips) {
      console.log(`    SKIP    "${name}" used by ${states.join(' + ')} (shared)`);
    }
    totalShared += plan.sharedClips.length;
  }
}

console.log('');
console.log(`Plan: ${totalRenames} clips to rename across ${Object.keys(planByCritter).length} GLBs`);
console.log(`      ${totalShared} shared clips left untouched`);
console.log('');

if (!APPLY) {
  console.log('(dry-run — pass --apply to execute)');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// APPLY: rewrite GLBs + animation-overrides.ts
// ---------------------------------------------------------------------------

const TEMP_PREFIX = '__tmp_rename__';

console.log('=== Rewriting GLB files ===');
for (const [critterId, plan] of Object.entries(planByCritter)) {
  if (plan.renamePlan.size === 0) {
    console.log(`  ${critterId}: nothing to rename`);
    continue;
  }
  const doc = await io.read(plan.glbPath);
  const animations = doc.getRoot().listAnimations();
  // Phase 1: clips slated for rename get a temp prefix so the
  // namespace is collision-free during phase 2 (handles the case
  // where state X claims clip "Y" while state Y claims clip "X").
  for (const anim of animations) {
    const name = anim.getName();
    if (plan.renamePlan.has(name)) {
      anim.setName(TEMP_PREFIX + name);
    }
  }
  // Phase 2: temp prefix → final canonical name.
  for (const anim of animations) {
    const name = anim.getName();
    if (name.startsWith(TEMP_PREFIX)) {
      const original = name.slice(TEMP_PREFIX.length);
      const finalName = plan.renamePlan.get(original);
      if (finalName) anim.setName(finalName);
    }
  }
  await io.write(plan.glbPath, doc);
  console.log(`  ${critterId}: ${plan.glbPath} (${plan.renamePlan.size} clips renamed)`);
}

// ---------------------------------------------------------------------------
// Rewrite animation-overrides.ts
// ---------------------------------------------------------------------------
//
// For each entry, decide:
//   · If the clip is in renamePlan AND the new name === canonical
//     state name AND the entry has no speed/loop metadata: DROP the
//     entry (auto-resolver will match by exact name now).
//   · If the clip is in renamePlan AND the entry has speed/loop:
//     KEEP the entry, update `clip` to the new canonical name.
//   · If the clip is in sharedClips: KEEP entry as-is (we didn't
//     rename it).
//   · Otherwise (no clip in entry, or unrecognised state): KEEP
//     entry as-is.

console.log('');
console.log('=== Rewriting animation-overrides.ts ===');

function renderValue(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  // Object form — only emit fields that are explicitly set.
  const parts = [`clip: ${JSON.stringify(v.clip)}`];
  if (typeof v.speed === 'number' && v.speed !== 1) parts.push(`speed: ${v.speed}`);
  if (typeof v.loop === 'boolean') parts.push(`loop: ${v.loop}`);
  return `{ ${parts.join(', ')} }`;
}

const newOverrides = {};
let droppedEntries = 0;
for (const [critterId, states] of Object.entries(overrides)) {
  const plan = planByCritter[critterId];
  const newStates = {};
  for (const [state, value] of Object.entries(states)) {
    const oldClip = clipNameOf(value);
    if (!oldClip) {
      newStates[state] = value;
      continue;
    }
    const isShared = plan.sharedClips.some(([n]) => n === oldClip);
    if (isShared) {
      newStates[state] = value;
      continue;
    }
    const newClip = plan.renamePlan.get(oldClip) ?? oldClip;
    const canonical = STATE_TO_CANONICAL[state];
    const isCanonical = newClip === canonical;
    const hasMetadata = typeof value === 'object'
      && ((typeof value.speed === 'number' && value.speed !== 1) || typeof value.loop === 'boolean');

    if (isCanonical && !hasMetadata) {
      // Auto-resolver tier 1 will match. Drop the entry.
      droppedEntries++;
      continue;
    }

    if (typeof value === 'string') {
      newStates[state] = newClip;
    } else {
      newStates[state] = { ...value, clip: newClip };
    }
  }
  if (Object.keys(newStates).length > 0) {
    newOverrides[critterId] = newStates;
  }
}

const renderedLines = ['{'];
const ids = Object.keys(newOverrides);
ids.forEach((id, ix) => {
  renderedLines.push(`  ${id}: {`);
  for (const [state, value] of Object.entries(newOverrides[id])) {
    renderedLines.push(`    ${state}: ${renderValue(value)},`);
  }
  renderedLines.push('  },');
  // Blank line between critters for readability — except after the last one
  if (ix < ids.length - 1) renderedLines.push('');
});
renderedLines.push('}');
const newLiteral = renderedLines.join('\n');

const newSource = tsSource.slice(0, openBrace) + newLiteral + tsSource.slice(close + 1);
await writeFile(OVERRIDES_PATH, newSource, 'utf8');
console.log(`  Wrote ${OVERRIDES_PATH} (dropped ${droppedEntries} now-redundant entries)`);

console.log('');
console.log('✓ Done. Run `npm run check` to validate.');
console.log('  Then test each critter in /anim-lab — exact-match tier should');
console.log('  resolve every state without an override entry now.');
