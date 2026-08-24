// ---------------------------------------------------------------------------
// tool-patch-core tests — golden behaviour + the anim-lab merge contract
// ---------------------------------------------------------------------------
// Run: npm run test:patch   (node --test, zero extra dependencies)
//
// The calibrate/decor tests FREEZE the pre-existing mutator behaviour
// (they were correct before the H3 refactor). The anim-lab tests encode
// the NEW merge semantics that replace the destructive whole-record
// rewrite: nothing the patch doesn't mention may change, ever.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyCalibrate,
  applyAnimLab,
  applyDecorEditor,
  applyPatch,
  validateToolPatch,
  formatAnimLabValue,
  formatNumber,
  formatRotation,
  simpleDiff,
} from '../tool-patch-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Fixtures are normalized to LF at load time: git autocrlf may check
// them out as CRLF and the assertions use literal \n. CRLF handling
// has its own dedicated test with explicitly-built CRLF input.
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8').replace(/\r\n/g, '\n');

const ROSTER = fixture('roster-extract.ts.txt');
const OVERRIDES = fixture('animation-overrides-extract.ts.txt');
const DECOR = fixture('arena-decor-extract.ts.txt');

// ===========================================================================
// calibrate — golden (pre-refactor behaviour)
// ===========================================================================

test('calibrate: rewrites only the named fields of the named critter', () => {
  const out = applyCalibrate(ROSTER, { shelly: { scale: 0.9, pivotY: 0.35 } });
  assert.match(out, /id: 'shelly',[\s\S]*?scale: 0\.9, rotation: Math\.PI \/ 2/);
  assert.match(out, /physicsRadius: R, pivotY: 0\.35,/);
  // sergei and kurama untouched
  assert.match(out, /scale: 1\.09, rotation: 0,/);
  assert.match(out, /scale: 1\.2, rotation: -Math\.PI,/);
});

test('calibrate: rotation snaps to Math.PI forms', () => {
  const out = applyCalibrate(ROSTER, { sergei: { rotation: Math.PI / 2 } });
  assert.match(out, /id: 'sergei',[\s\S]*?rotation: Math\.PI \/ 2, offset/);
  const out2 = applyCalibrate(ROSTER, { sergei: { rotation: 1.2345 } });
  assert.match(out2, /rotation: 1\.2345, offset/);
});

test('calibrate: does not change line count (in-place field rewrite)', () => {
  const out = applyCalibrate(ROSTER, { kurama: { scale: 1.31 } });
  assert.equal(out.split('\n').length, ROSTER.split('\n').length);
});

test('calibrate: field-like text inside comments is never rewritten', () => {
  const out = applyCalibrate(ROSTER, { sergei: { scale: 2, pivotY: 1 } });
  // The block comment mentions "scale 0.66" (no colon) and "pivotY back
  // to 0" — plus kurama's comment has a literal "rotation: -Math.PI".
  assert.match(out, /\/\/ scale 0\.66 targets/);
  const out2 = applyCalibrate(ROSTER, { kurama: { rotation: 0 } });
  assert.match(out2, /\/\/ rotation: -Math\.PI kept from the original Tripo import\./);
  assert.match(out2, /rotation: 0, offset: \[0, 0, 0\],\n\s*physicsRadius: R, pivotY: 0,\n\s*status: 'playable',\n\s*role: 'Trickster'/);
});

test('calibrate: unknown critter throws, source untouched semantics', () => {
  assert.throws(() => applyCalibrate(ROSTER, { nonexistent: { scale: 1 } }), /entry not found/);
});

// ===========================================================================
// anim-lab — the new merge contract
// ===========================================================================

test('anim-lab merge: critters absent from the patch stay byte-identical', () => {
  const out = applyAnimLab(OVERRIDES, { kermit: { idle: 'Idle' } });
  // trunk block (comments included) must survive verbatim
  const trunkBlock = /trunk: \{\n    ability_1: \{ clip: "Ability1", speed: 3 \},\n    \/\/ Ground pound doubles as ability_2 — GLB ships no dedicated clip\.\n    ability_2: "Ability3GroundPound",\n    fall: \{ clip: "Fall", speed: 2, loop: true \},\n  \},/;
  assert.match(OVERRIDES, trunkBlock);
  assert.match(out, trunkBlock);
  // sergei block too
  assert.match(out, /sergei: \{\n    ability_1: \{ clip: "Ability1", speed: 1\.8 \},/);
});

test('anim-lab merge: untouched states of a touched critter survive', () => {
  const out = applyAnimLab(OVERRIDES, { sergei: { ability_1: { clip: 'Ability1', speed: 2.2 } } });
  assert.match(out, /ability_1: \{ clip: "Ability1", speed: 2\.2 \},/);
  // The rest of sergei's states are untouched
  assert.match(out, /ability_2: \{ clip: "Ability2", speed: 1\.5 \},/);
  assert.match(out, /victory: \{ clip: "Victory", loop: true \},/);
});

test('anim-lab merge: trailing comments on replaced lines survive', () => {
  const out = applyAnimLab(OVERRIDES, { sergei: { run: { clip: 'Run', speed: 1.4 } } });
  assert.match(out, /run: \{ clip: "Run", speed: 1\.4 \}, \/\/ exact-match tier already picks Run/);
});

test('anim-lab merge: new state appends inside the existing block', () => {
  const out = applyAnimLab(OVERRIDES, { kermit: { idle: { clip: 'Idle', speed: 1.15 } } });
  assert.match(out, /kermit: \{\n    victory: \{ clip: "Victory", loop: true \},\n    fall: \{ clip: "Fall", loop: true \},\n    idle: \{ clip: "Idle", speed: 1\.15 \},\n  \},/);
});

test('anim-lab merge: new critter appends a block before the record close', () => {
  const out = applyAnimLab(OVERRIDES, { shelly: { ability_3: { clip: 'Ability3', speed: 10, loop: true }, fall: 'Fall' } });
  assert.match(out, /shelly: \{\n    ability_3: \{ clip: "Ability3", speed: 10, loop: true \},\n    fall: "Fall",\n  \},\n\};/);
  // Helper below the record untouched
  assert.match(out, /export function getClipOverride\(id: string\): string \| null \{/);
});

test('anim-lab merge: header prose and helper stay byte-identical', () => {
  const out = applyAnimLab(OVERRIDES, { sergei: { fall: 'Fall' } });
  const headerEnd = OVERRIDES.indexOf('export const ANIMATION_OVERRIDES');
  assert.equal(out.slice(0, headerEnd), OVERRIDES.slice(0, headerEnd));
  const helperStartIn = OVERRIDES.indexOf('/** Helper kept below');
  const helperStartOut = out.indexOf('/** Helper kept below');
  assert.equal(out.slice(helperStartOut), OVERRIDES.slice(helperStartIn));
});

test('anim-lab merge: applying the same patch twice is a no-op the second time', () => {
  const patchData = { sergei: { run: { clip: 'Run', speed: 1.4 } }, kermit: { idle: 'Idle' } };
  const once = applyAnimLab(OVERRIDES, patchData);
  const twice = applyAnimLab(once, patchData);
  assert.equal(twice, once);
});

test('anim-lab merge: object with default speed collapses to string shorthand', () => {
  assert.equal(formatAnimLabValue({ clip: 'Idle' }), '"Idle"');
  assert.equal(formatAnimLabValue({ clip: 'Idle', speed: 1 }), '"Idle"');
  assert.equal(formatAnimLabValue({ clip: 'Idle', speed: 1.15 }), '{ clip: "Idle", speed: 1.15 }');
  assert.equal(formatAnimLabValue({ clip: 'Idle', loop: false }), '{ clip: "Idle", loop: false }');
  assert.equal(formatAnimLabValue('Idle'), '"Idle"');
});

test('anim-lab merge: v1 string-only patch round-trips', () => {
  const out = applyAnimLab(OVERRIDES, { trunk: { ability_2: 'GroundPoundV2' } });
  assert.match(out, /ability_2: "GroundPoundV2",/);
  // Comment line above it survives
  assert.match(out, /\/\/ Ground pound doubles as ability_2 — GLB ships no dedicated clip\.\n    ability_2: "GroundPoundV2",/);
});

test('anim-lab merge: missing record throws', () => {
  assert.throws(() => applyAnimLab('const nope = 1;', { a: { idle: 'X' } }), /export not found/);
});

// ===========================================================================
// decor-editor — golden (pre-refactor behaviour)
// ===========================================================================

test('decor-editor: replaces the named pack wholesale, others untouched', () => {
  const out = applyDecorEditor(DECOR, {
    jungle: [
      { r: 10, angle: 0.5, rotY: 0.25, scale: 1, type: 'palmtall_jungle' },
    ],
  });
  assert.match(out, /jungle: \[\n    \{ r: 10, angle: 0\.5, rotY: 0\.25, scale: 1, type: "palmtall_jungle" \},\n  \]/);
  // desert pack byte-identical
  assert.match(out, /desert: \[\n    \{ r: 9\.50, angle: 2\.10, rotY: 0\.00, scale: 1\.10, type: 'cactus_desert' \},/);
});

test('decor-editor: empty array empties the pack body', () => {
  const out = applyDecorEditor(DECOR, { desert: [] });
  assert.match(out, /desert: \[\n  \]/);
});

test('decor-editor: unknown pack throws', () => {
  assert.throws(() => applyDecorEditor(DECOR, { volcano: [] }), /pack 'volcano' not found/);
});

// ===========================================================================
// validateToolPatch
// ===========================================================================

test('validate: accepts well-formed patches for the three tools', () => {
  assert.deepEqual(validateToolPatch({ tool: 'calibrate', version: 1, data: { sergei: { scale: 1.1 } } }), []);
  assert.deepEqual(validateToolPatch({ tool: 'anim-lab', version: 2, data: { sergei: { run: { clip: 'Run', speed: 1.3 } } } }), []);
  assert.deepEqual(validateToolPatch({ tool: 'anim-lab', version: 1, data: { sergei: { run: 'Run' } } }), []);
  assert.deepEqual(validateToolPatch({ tool: 'decor-editor', version: 1, data: { jungle: [{ r: 1, angle: 2, rotY: 0, scale: 1, type: 'rock' }] } }), []);
});

test('validate: rejects bad envelopes and payload shapes', () => {
  assert.ok(validateToolPatch(null).length > 0);
  assert.ok(validateToolPatch({ tool: 'nope', version: 1, data: {} }).length > 0);
  assert.ok(validateToolPatch({ tool: 'calibrate', version: 9, data: {} }).length > 0);
  assert.ok(validateToolPatch({ tool: 'calibrate', version: 1, data: { x: { bogus: 1 } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'calibrate', version: 1, data: { x: { scale: 'big' } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'anim-lab', version: 2, data: { x: { idle: { speed: 2 } } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'anim-lab', version: 2, data: { x: { idle: { clip: 'A', extra: 1 } } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'decor-editor', version: 1, data: { jungle: [{ r: 1 }] } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'decor-editor', version: 1, data: { jungle: {} } }).length > 0);
});

// ===========================================================================
// applyPatch dispatch + formatting + diff
// ===========================================================================

test('applyPatch: routes by tool and matches direct calls', () => {
  const patch = { tool: 'calibrate', version: 1, data: { sergei: { scale: 1.5 } } };
  assert.equal(applyPatch(ROSTER, patch), applyCalibrate(ROSTER, patch.data));
});

test('formatNumber / formatRotation conventions', () => {
  assert.equal(formatNumber(1), '1');
  assert.equal(formatNumber(1.5), '1.5');
  assert.equal(formatNumber(1.23456), '1.235');
  assert.equal(formatNumber(1.1), '1.1');
  assert.equal(formatRotation(0.001), '0');
  assert.equal(formatRotation(Math.PI), 'Math.PI');
  assert.equal(formatRotation(-Math.PI / 2), '-Math.PI / 2');
  assert.equal(formatRotation(0.7854), '0.7854');
});

test('simpleDiff: same-line-count zip with context and separators', () => {
  const mk = (mid1, mid2) => ['l1', 'l2', 'l3', mid1, 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', mid2, 'l12', 'l13'].join('\n');
  const d = simpleDiff(mk('l4', 'l11'), mk('CHANGED-A', 'CHANGED-B'));
  assert.ok(d.some((l) => l.kind === 'del' && l.text === 'l4'));
  assert.ok(d.some((l) => l.kind === 'add' && l.text === 'CHANGED-A'));
  assert.ok(d.some((l) => l.kind === 'add' && l.text === 'CHANGED-B'));
  // Two hunks far apart → an interior separator between them.
  assert.ok(d.some((l) => l.kind === 'sep'));
  // Edge lines outside context are simply dropped (no edge separators).
  assert.ok(!d.some((l) => l.text === 'l1'));
});

test('simpleDiff: different-line-count trims common prefix/suffix', () => {
  const a = ['a', 'b', 'c', 'd'].join('\n');
  const b = ['a', 'b', 'X', 'Y', 'c', 'd'].join('\n');
  const d = simpleDiff(a, b);
  assert.ok(d.some((l) => l.kind === 'add' && l.text === 'X'));
  assert.ok(!d.some((l) => l.kind === 'del' && l.text === 'a'));
});

// ===========================================================================
// Regression suite — adversarial review findings (H3 slice 1 hardening)
// ===========================================================================

import { applyAnimLab as _mergeApply, codeMask } from '../tool-patch-core.mjs';

const OVR = (blocks) => `// header comment — must survive
export const ANIMATION_OVERRIDES: Record<string, ClipOverrideMap> = {
${blocks}
};

export function tail(): number { return 1; }
`;

test('hardening: unbalanced } inside a // comment cannot corrupt the block', () => {
  const src = OVR(`  sergei: {
    // TODO: revisit } speed once GLB re-exported
    fall: "Fall",
    victory: "Victory",
  },`);
  const out = applyAnimLab(src, { sergei: { victory: 'Win' } });
  assert.match(out, /\/\/ TODO: revisit \} speed once GLB re-exported/);
  assert.match(out, /victory: "Win",/);
  assert.match(out, /fall: "Fall",/);
  // No duplicated states, record still closes once, tail intact.
  assert.equal((out.match(/victory:/g) ?? []).length, 1);
  assert.match(out, /export function tail\(\): number \{ return 1; \}/);
});

test('hardening: stray } in a comment BETWEEN blocks does not truncate the record scope', () => {
  const src = OVR(`  sergei: {
    fall: "Fall",
  },
  // note: brace soup } here between blocks
  kermit: {
    idle: "Idle",
  },`);
  const out = applyAnimLab(src, { zeta: { run: 'Run' } });
  // New block lands before the record's REAL close, after kermit.
  assert.match(out, /kermit: \{\n    idle: "Idle",\n  \},\n\n  zeta: \{\n    run: "Run",\n  \},\n\};/);
  assert.match(out, /\/\/ note: brace soup \} here between blocks/);
});

test('hardening: validate rejects non-identifier critter/state keys', () => {
  assert.ok(validateToolPatch({ tool: 'anim-lab', version: 1, data: { 'sergei ': { idle: 'Idle' } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'anim-lab', version: 1, data: { sergei: { 'fall-fast': 'X' } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'calibrate', version: 1, data: { 'ser gei': { scale: 1 } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'decor-editor', version: 1, data: { 'jun gle': [] } }).length > 0);
  // The mutator itself also refuses, defense in depth:
  assert.throws(() => applyAnimLab(OVR('  a: {\n    idle: "I",\n  },'), { 'sergei ': { idle: 'Idle' } }), /not a valid identifier/);
  assert.throws(() => applyAnimLab(OVR('  a: {\n    idle: "I",\n  },'), { a: { 'fall-fast': 'X' } }), /not a valid identifier/);
});

test('hardening: a critter named like a state cannot match state lines of other blocks', () => {
  const src = OVR(`  sergei: {
    fall: "Fall",
    run: "Run",
  },`);
  // Adding a critter literally named "fall": must become a NEW block at
  // entry indent, not a rewrite of sergei's fall state line.
  const out = applyAnimLab(src, { fall: { idle: 'Idle' } });
  assert.match(out, /  fall: \{\n    idle: "Idle",\n  \},\n\};/);
  assert.match(out, /sergei: \{\n    fall: "Fall",\n    run: "Run",\n  \},/);
});

test('hardening: CRLF sources keep CRLF on replaced and appended lines', () => {
  const lf = OVR(`  sergei: {
    fall: "Fall",
  },`);
  const crlf = lf.replace(/\n/g, '\r\n');
  const out = applyAnimLab(crlf, { sergei: { fall: 'Fall2', idle: 'Idle' }, nuevo: { run: 'Run' } });
  assert.ok(!/(^|[^\r])\n/.test(out), 'no bare LF anywhere in a CRLF file');
  assert.match(out, /fall: "Fall2",\r\n/);
  assert.match(out, /idle: "Idle",\r\n/);
  assert.match(out, /nuevo: \{\r\n    run: "Run",\r\n  \},\r\n\};/);
});

test('hardening: append adds a comma to a last line that lacks one', () => {
  const src = OVR(`  sergei: {
    fall: "Fall",
    victory: "Victory"
  },`);
  const out = applyAnimLab(src, { sergei: { idle: 'Idle' } });
  assert.match(out, /victory: "Victory",\n    idle: "Idle",\n  \},/);
});

test('hardening: a state parked inside /* */ is treated as absent; real value appended', () => {
  const src = OVR(`  sergei: {
    fall: "Fall",
    /* parked:
    victory: "OldWin",
    */
  },`);
  const out = applyAnimLab(src, { sergei: { victory: 'Win' } });
  // The parked text survives verbatim; the live value is a new line.
  assert.match(out, /\/\* parked:\n    victory: "OldWin",\n    \*\//);
  assert.match(out, /victory: "Win",/);
  const mask = codeMask(out);
  const parkedIdx = out.indexOf('victory: "OldWin"');
  assert.equal(mask[parkedIdx], 0, 'parked copy stays inside the comment');
});

test('hardening: value containing // inside quotes is not treated as a comment', () => {
  const src = OVR(`  sergei: {
    fall: "anims//Fall",
    run: "Run",
  },`);
  const out = applyAnimLab(src, { sergei: { fall: 'Fall2' } });
  assert.match(out, /fall: "Fall2",\n    run: "Run",/);
  assert.ok(!out.includes('anims//Fall'), 'old value fully replaced');
});

test('hardening: inline comment mixed into a value refuses to guess', () => {
  const src = OVR(`  sergei: {
    fall: /* legacy */ "Fall",
  },`);
  assert.throws(() => applyAnimLab(src, { sergei: { fall: 'X' } }), /mixes a comment/);
});

test('hardening: simpleDiff of a sparse merge shows only the touched lines', () => {
  const out = applyAnimLab(OVERRIDES, { sergei: { run: { clip: 'Run', speed: 1.4 } } });
  const d = simpleDiff(OVERRIDES, out);
  const adds = d.filter((l) => l.kind === 'add');
  const dels = d.filter((l) => l.kind === 'del');
  assert.equal(adds.length, 1, 'one line added');
  assert.equal(dels.length, 1, 'one line removed');
  assert.match(adds[0].text, /speed: 1\.4/);
});

test('hardening: merge against the REAL animation-overrides.ts anchors and round-trips', () => {
  // The working tree may be CRLF (autocrlf) — the merge must cope with
  // whatever EOL the real file uses, so DON'T normalize the input.
  const real = readFileSync(path.join(here, '../../src/animation-overrides.ts'), 'utf8');
  const patchData = { sergei: { run: { clip: 'Run', speed: 1.35 } }, shelly: { idle: 'Idle' } };
  const once = applyAnimLab(real, patchData);
  const onceLf = once.replace(/\r\n/g, '\n');
  assert.match(onceLf, /run: \{ clip: "Run", speed: 1\.35 \},/);
  assert.match(onceLf, /shelly: \{[\s\S]*?idle: "Idle",\n  \},/);
  // kermit (untouched) byte-identical, helpers intact, idempotent.
  const kermitBlock = real.slice(real.indexOf('kermit: {'), real.indexOf('};'));
  assert.ok(once.includes(kermitBlock));
  assert.match(once, /export function getClipOverrideMeta\(/);
  assert.equal(applyAnimLab(once, patchData), once);
});

test('decor-editor: wholesale apply against the REAL arena-decor-layouts.ts keeps pack headers', () => {
  const real = readFileSync(path.join(here, '../../src/arena-decor-layouts.ts'), 'utf8');
  const out = applyDecorEditor(real, { jungle: [
    { r: 10.8, angle: 0.55, rotY: 0.3, scale: 1, type: 'palmtall_jungle' },
  ] });
  // Design-note headers (outside the arrays since H3 slice 3) survive.
  assert.ok(out.includes('Templo perdido devorado por la selva'));
  assert.ok(out.includes('Composición (orden de placements'));
  // Other packs byte-identical.
  const tundraBlock = real.slice(real.indexOf('frozen_tundra: ['), real.indexOf('desert_dunes:'));
  assert.ok(out.includes(tundraBlock));
  // The replaced pack has exactly the new single placement.
  assert.match(out.replace(/\r\n/g, '\n'), /jungle: \[\n    \{ r: 10\.8, angle: 0\.55, rotY: 0\.3, scale: 1, type: "palmtall_jungle" \},\n  \]/);
});

// ===========================================================================
// feel-patch — numeric token rewrite (afilado slice B)
// ===========================================================================

import { applyFeelPatch } from '../tool-patch-core.mjs';

const GAMEFEEL = fixture('gamefeel-extract.ts.txt');

test('feel-patch: replaces the numeric token, comment and comma survive', () => {
  const out = applyFeelPatch(GAMEFEEL, { 'shake.headbutt': 0.35 });
  assert.match(out, /headbutt: 0\.35,           \/\/ amplitude when a headbutt connects/);
  // Everything else byte-identical
  assert.match(out, /decay: 0\.18,              \/\/ how fast the shake fades/);
  assert.match(out, /frictionHalfLife: 0\.08,/);
  assert.ok(out.includes('export function triggerHitStop'));
});

test('feel-patch: integers and multiple paths in one apply', () => {
  const out = applyFeelPatch(GAMEFEEL, { 'movement.maxSpeed': 24, 'collision.stunnedVulnerability': 3.5 });
  assert.match(out, /maxSpeed: 24,             \/\/ raised/);
  assert.match(out, /stunnedVulnerability: 3\.5,  \/\/ knockback/);
});

test('feel-patch: idempotent on second apply', () => {
  const data = { 'shake.headbutt': 0.35, 'movement.maxSpeed': 24 };
  const once = applyFeelPatch(GAMEFEEL, data);
  assert.equal(applyFeelPatch(once, data), once);
});

test('feel-patch: unknown section or key throws, never creates', () => {
  assert.throws(() => applyFeelPatch(GAMEFEEL, { 'nope.headbutt': 1 }), /section 'nope' not found/);
  assert.throws(() => applyFeelPatch(GAMEFEEL, { 'shake.nope': 1 }), /'shake\.nope' not found/);
});

test('feel-patch: validate accepts dot-paths and rejects junk', () => {
  assert.deepEqual(validateToolPatch({ tool: 'feel-patch', version: 1, data: { 'shake.headbutt': 0.3 } }), []);
  assert.ok(validateToolPatch({ tool: 'feel-patch', version: 1, data: { 'shake': 0.3 } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'feel-patch', version: 1, data: { 'a.b.c': 0.3 } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'feel-patch', version: 1, data: { 'shake.headbutt': 'x' } }).length > 0);
});

test('feel-patch: merge against the REAL gamefeel.ts anchors and round-trips', () => {
  const real = readFileSync(path.join(here, '../../src/gamefeel.ts'), 'utf8');
  const out = applyFeelPatch(real, { 'shake.headbutt': 0.25, 'hitStop.groundPound': 0.12 });
  const lf = out.replace(/\r\n/g, '\n');
  assert.match(lf, /headbutt: 0\.25,/);
  assert.match(lf, /groundPound: 0\.12,\s+\/\/ heavy slam/);
  assert.ok(out.includes('export function updateCameraShake'));
  assert.equal(applyFeelPatch(out, { 'shake.headbutt': 0.25, 'hitStop.groundPound': 0.12 }), out);
});

// ===========================================================================
// calibrate physicsRadius (afilado slice C)
// ===========================================================================

test('calibrate: physicsRadius replaces the shared R reference with a literal', () => {
  const out = applyCalibrate(ROSTER, { shelly: { physicsRadius: 0.68 } });
  assert.match(out, /id: 'shelly',[\s\S]*?physicsRadius: 0\.68, pivotY: 0\.4,/);
  // Other critters keep the shared const
  assert.match(out, /id: 'sergei',[\s\S]*?physicsRadius: R, pivotY: 0,/);
  assert.deepEqual(validateToolPatch({ tool: 'calibrate', version: 1, data: { x: { physicsRadius: 0.6 } } }), []);
});

// ===========================================================================
// anim-personality — sparse numeric merge (afilado slice E)
// ===========================================================================

import { applyAnimPersonality } from '../tool-patch-core.mjs';

// Inline fixtures (the real target file ships empty, so goldens for
// populated records are built here, same pattern as the OVR builder).
const PERSONA = (blocks) => `// header prose — must survive
import type { AnimationPersonality } from './critter-animation';

export const PERSONALITY_OVERRIDES: Record<string, Partial<AnimationPersonality>> = {
${blocks}
};

export const tailMarker = 1;
`;

const PERSONA_EMPTY = `// header prose — must survive
import type { AnimationPersonality } from './critter-animation';

export const PERSONALITY_OVERRIDES: Record<string, Partial<AnimationPersonality>> = {
};

export const tailMarker = 1;
`;

test('anim-personality: new critter block in an empty record, canonical field order', () => {
  const out = applyAnimPersonality(PERSONA_EMPTY, { Sergei: { chargeStretchMult: 1.2, idleBobHz: 1.05 } });
  // No leading blank line after '{'; fields in AnimationPersonality
  // interface order (idleBobHz first, despite alphabetical order).
  assert.match(out, /= \{\n  Sergei: \{\n    idleBobHz: 1\.05,\n    chargeStretchMult: 1\.2,\n  \},\n\};/);
  assert.match(out, /export const tailMarker = 1;/);
  // CRLF source keeps CRLF on every appended line.
  const crlfOut = applyAnimPersonality(PERSONA_EMPTY.replace(/\n/g, '\r\n'), { Sergei: { idleBobHz: 1.05 } });
  assert.ok(!/(^|[^\r])\n/.test(crlfOut), 'no bare LF anywhere in a CRLF file');
  assert.match(crlfOut, /Sergei: \{\r\n    idleBobHz: 1\.05,\r\n  \},\r\n\};/);
});

test('anim-personality: appends missing fields inside an existing block', () => {
  const src = PERSONA(`  Sergei: {
    idleBobHz: 1.1,
  },`);
  const out = applyAnimPersonality(src, { Sergei: { runSwayRadians: 0.12 } });
  assert.match(out, /Sergei: \{\n    idleBobHz: 1\.1,\n    runSwayRadians: 0\.12,\n  \},/);
});

test('anim-personality: numeric token rewrite keeps the same-line comment byte-identical', () => {
  const src = PERSONA(`  Shelly: {
    idleBobHz: 0.9,        // deep slow breath — tanque
    leanRadians: 0.08,
  },`);
  const out = applyAnimPersonality(src, { Shelly: { idleBobHz: 1.4 } });
  // Alignment spaces before the comment survive too (token-only rewrite).
  assert.match(out, /idleBobHz: 1\.4,        \/\/ deep slow breath — tanque/);
  assert.match(out, /leanRadians: 0\.08,/);
});

test('anim-personality: entries and fields absent from the patch stay byte-identical', () => {
  const src = PERSONA(`  Sergei: {
    idleBobHz: 1.1, // nervous idle
    runBounceAmp: 0.12,
  },

  Kurama: {
    // parked: chargeStretchMult: 9,
    leanRadians: 0.21,
  },`);
  const out = applyAnimPersonality(src, { Sergei: { runBounceAmp: 0.2 } });
  // Kurama block (comment included) survives verbatim.
  assert.match(out, /Kurama: \{\n    \/\/ parked: chargeStretchMult: 9,\n    leanRadians: 0\.21,\n  \},/);
  // Sergei's untouched field keeps its comment; the patched one changed.
  assert.match(out, /idleBobHz: 1\.1, \/\/ nervous idle/);
  assert.match(out, /runBounceAmp: 0\.2,/);
  // Header prose and tail identical.
  const headEnd = src.indexOf('export const PERSONALITY_OVERRIDES');
  assert.equal(out.slice(0, headEnd), src.slice(0, headEnd));
  assert.ok(out.includes('export const tailMarker = 1;'));
});

test('anim-personality: validate accepts good patches and rejects junk', () => {
  assert.deepEqual(validateToolPatch({ tool: 'anim-personality', version: 1, data: { Sergei: { idleBobHz: 1.2 } } }), []);
  // Unknown version.
  assert.ok(validateToolPatch({ tool: 'anim-personality', version: 9, data: {} }).length > 0);
  // Unknown field — the message names the valid closed set.
  const unknown = validateToolPatch({ tool: 'anim-personality', version: 1, data: { Sergei: { bobHz: 1 } } });
  assert.ok(unknown.some((e) => /unknown field "bobHz"/.test(e) && /idleBobHz/.test(e)));
  // Non-finite / non-number values.
  assert.ok(validateToolPatch({ tool: 'anim-personality', version: 1, data: { Sergei: { idleBobHz: Infinity } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'anim-personality', version: 1, data: { Sergei: { idleBobHz: 'fast' } } }).length > 0);
  // Non-identifier critter name.
  assert.ok(validateToolPatch({ tool: 'anim-personality', version: 1, data: { 'Ser gei': { idleBobHz: 1 } } }).length > 0);
});

test('anim-personality: mutator refuses instead of guessing', () => {
  // Missing record.
  assert.throws(() => applyAnimPersonality('const nope = 1;', { Sergei: { idleBobHz: 1 } }), /export not found/);
  // Unknown field / non-finite value — defense in depth below validate.
  assert.throws(() => applyAnimPersonality(PERSONA_EMPTY, { Sergei: { bobHz: 1 } }), /not an AnimationPersonality field/);
  assert.throws(() => applyAnimPersonality(PERSONA_EMPTY, { Sergei: { idleBobHz: NaN } }), /not a finite number/);
  // Existing value that is not a plain numeric literal: rewriting could
  // corrupt it and appending would silently shadow it — hard error.
  const src = PERSONA(`  Sergei: {
    idleBobHz: BASE * 2,
  },`);
  assert.throws(() => applyAnimPersonality(src, { Sergei: { idleBobHz: 1.2 } }), /not a plain number/);
});

test('anim-personality: merge against the REAL animation-personality-overrides.ts round-trips', () => {
  // Whatever EOL the working tree uses (autocrlf) — don't normalize.
  const real = readFileSync(path.join(here, '../../src/animation-personality-overrides.ts'), 'utf8');
  const patch = { tool: 'anim-personality', version: 1, data: { Sergei: { idleBobHz: 1.15, chargeStretchMult: 1.3 }, Shelly: { runBounceAmp: 0.05 } } };
  assert.deepEqual(validateToolPatch(patch), []);
  const once = applyPatch(real, patch);
  const lf = once.replace(/\r\n/g, '\n');
  assert.match(lf, /Sergei: \{\n    idleBobHz: 1\.15,\n    chargeStretchMult: 1\.3,\n  \},/);
  assert.match(lf, /Shelly: \{\n    runBounceAmp: 0\.05,\n  \},/);
  // The file's doc header (the never-delete contract prose) survives.
  assert.ok(once.includes('This file is a ToolPatch TARGET'));
  // applyPatch dispatch === direct mutator call.
  assert.equal(once, applyAnimPersonality(real, patch.data));
});

test('anim-personality: applying the same patch twice is a no-op the second time', () => {
  const src = PERSONA(`  Sergei: {
    idleBobHz: 1.1, // keep
  },`);
  const data = { Sergei: { idleBobHz: 1.4, leanRadians: 0.2 }, Kurama: { runBounceHz: 2.4 } };
  const once = applyAnimPersonality(src, data);
  assert.equal(applyAnimPersonality(once, data), once);
});

// ===========================================================================
// ability-patch — slot-indexed merge into CRITTER_ABILITIES (6th tool)
// ===========================================================================

import { applyAbilityPatch } from '../tool-patch-core.mjs';

// Inline fixture builder (same pattern as OVR/PERSONA): a miniature
// CRITTER_ABILITIES shaped exactly like src/abilities.ts — arrays of
// factory calls with literal override objects, mid-line field packing,
// nested `zone` objects, tuning comments, non-literal values.
const ABIL = (blocks) => `// header prose — must survive
import { FEEL } from './gamefeel';

export const CRITTER_ABILITIES: Record<string, AbilityDef[]> = {
${blocks}
};

export function abilitiesTail(): number { return 1; }
`;

const ABIL_FIX = ABIL(`  // Rojo — balanced brawler (uses FEEL defaults, no overrides object)
  Rojo: [
    makeChargeRush(),
    makeGroundPound(),
  ],

  Sergei: [
    makeChargeRush({
      name: 'Gorilla Rush',
      impulse: 25,
      cooldown: 4.0,        // feel pass — snappy
      speedMultiplier: 2.6,
    }),
    makeGroundPound({
      name: 'Shockwave',
      radius: 3.5, force: 68,
      windUp: 0.30,
      slowDuringActive: 0, cancelAnimOnEnd: true,
    }),
    makeFrenzy({
      duration: 2.5,
      massMultiplier: 5.50,
    }),
  ],

  Kermit: [
    makeChargeRush({
      impulse: 20, duration: 0.30,
    }),
    makeGroundPound({
      name: 'Poison Cloud',
      radius: 5.0, force: 14, windUp: 0.15, cooldown: 16.0,
      zone: {
        radius: 5.0,
        duration: 10.0,
      },
    }),
  ],

  Weird: [
    makeChargeRush({
      impulse: FEEL.chargeRush.impulse,
      selfTintHex: 0xa8c0d0,
    }),
  ],`);

test('ability-patch: rewrites an existing field, trailing comment survives byte-identical', () => {
  const out = applyAbilityPatch(ABIL_FIX, { Sergei: { 'J.cooldown': 3.4 } });
  assert.match(out, /cooldown: 3\.4,        \/\/ feel pass — snappy/);
  // Neighbouring fields of the same object untouched.
  assert.match(out, /impulse: 25,\n      cooldown: 3\.4,/);
  assert.match(out, /speedMultiplier: 2\.6,/);
});

test('ability-patch: missing field appends at the end of the correct slot object', () => {
  const out = applyAbilityPatch(ABIL_FIX, { Sergei: { 'K.cooldown': 7.5 } });
  // Lands in the K (2nd call) object, right before its close, house indent.
  assert.match(out, /slowDuringActive: 0, cancelAnimOnEnd: true,\n      cooldown: 7\.5,\n    \}\),/);
  // The J object's cooldown (comment included) is untouched.
  assert.match(out, /cooldown: 4\.0,        \/\/ feel pass — snappy/);
});

test('ability-patch: two critters and two slots in a single apply', () => {
  const out = applyAbilityPatch(ABIL_FIX, {
    Sergei: { 'L.duration': 3 },
    Kermit: { 'J.impulse': 22 },
  });
  assert.match(out, /makeFrenzy\(\{\n      duration: 3,\n      massMultiplier: 5\.50,/);
  assert.match(out, /impulse: 22, duration: 0\.30,/);
});

test('ability-patch: mid-line fields rewrite in place; nested zone objects are shielded', () => {
  const out = applyAbilityPatch(ABIL_FIX, { Kermit: { 'K.force': 20, 'K.radius': 6 } });
  // Both fields live mid-line in the same source line.
  assert.match(out, /radius: 6, force: 20, windUp: 0\.15, cooldown: 16\.0,/);
  // zone.radius / zone.duration (nested) stay byte-identical.
  assert.match(out, /zone: \{\n        radius: 5\.0,\n        duration: 10\.0,\n      \},/);
  // A field that only exists NESTED appends at top level instead of
  // rewriting the nested copy.
  const out2 = applyAbilityPatch(ABIL_FIX, { Kermit: { 'K.duration': 0.5 } });
  assert.match(out2, /zone: \{\n        radius: 5\.0,\n        duration: 10\.0,\n      \},\n      duration: 0\.5,\n    \}\),/);
});

test('ability-patch: everything the patch does not mention stays byte-identical', () => {
  const out = applyAbilityPatch(ABIL_FIX, { Sergei: { 'J.cooldown': 3.4 } });
  // Header and tail identical.
  const headEnd = ABIL_FIX.indexOf('export const CRITTER_ABILITIES');
  assert.equal(out.slice(0, headEnd), ABIL_FIX.slice(0, headEnd));
  assert.ok(out.includes('export function abilitiesTail(): number { return 1; }'));
  // Kermit + Weird entries byte-identical.
  const kermitBlock = ABIL_FIX.slice(ABIL_FIX.indexOf('Kermit: ['), ABIL_FIX.indexOf('Weird: ['));
  assert.ok(out.includes(kermitBlock));
  const weirdBlock = ABIL_FIX.slice(ABIL_FIX.indexOf('Weird: ['), ABIL_FIX.indexOf('};'));
  assert.ok(out.includes(weirdBlock));
  // The whole diff is exactly one line swapped.
  const d = simpleDiff(ABIL_FIX, out);
  assert.equal(d.filter((l) => l.kind === 'add').length, 1);
  assert.equal(d.filter((l) => l.kind === 'del').length, 1);
});

test('ability-patch: applying the same patch twice is a no-op the second time', () => {
  const data = { Sergei: { 'J.cooldown': 3.4, 'K.cooldown': 7.5 }, Kermit: { 'K.force': 20 } };
  const once = applyAbilityPatch(ABIL_FIX, data);
  assert.equal(applyAbilityPatch(once, data), once);
});

test('ability-patch: unknown critter and out-of-range slot refuse', () => {
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Nadie: { 'J.cooldown': 1 } }), /critter 'Nadie' not found/);
  // Kermit's kit has 2 factory calls — L (3rd) is out of range.
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Kermit: { 'L.cooldown': 1 } }), /slot L of 'Kermit' is out of range — the kit has 2 factory calls/);
  // Missing record entirely.
  assert.throws(() => applyAbilityPatch('const nope = 1;', { Sergei: { 'J.cooldown': 1 } }), /export not found/);
});

test('ability-patch: non-literal existing values refuse instead of corrupting', () => {
  // FEEL reference.
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Weird: { 'J.impulse': 3 } }), /not a plain numeric literal/);
  // Hex colour literal.
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Weird: { 'J.selfTintHex': 5 } }), /not a plain numeric literal/);
  // Boolean value.
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Sergei: { 'K.cancelAnimOnEnd': 1 } }), /not a plain numeric literal/);
  // A call with no overrides object at all (Rojo uses factory defaults).
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Rojo: { 'J.cooldown': 3 } }), /no overrides object literal/);
});

test('ability-patch: malformed keys and non-finite values refuse', () => {
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Sergei: { 'J.foo-bar': 1 } }), /not "<J\|K\|L>\.<field>"/);
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Sergei: { 'X.cooldown': 1 } }), /not "<J\|K\|L>\.<field>"/);
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Sergei: { cooldown: 1 } }), /not "<J\|K\|L>\.<field>"/);
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { Sergei: { 'J.cooldown': NaN } }), /not a finite number/);
  assert.throws(() => applyAbilityPatch(ABIL_FIX, { 'Ser gei': { 'J.cooldown': 1 } }), /not a valid identifier/);
});

test('ability-patch: validate accepts good patches and rejects junk', () => {
  assert.deepEqual(validateToolPatch({ tool: 'ability-patch', version: 1, data: { Sergei: { 'J.cooldown': 3.5, 'L.duration': 3 } } }), []);
  assert.ok(validateToolPatch({ tool: 'ability-patch', version: 9, data: {} }).length > 0);
  assert.ok(validateToolPatch({ tool: 'ability-patch', version: 1, data: { Sergei: { 'M.cooldown': 1 } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'ability-patch', version: 1, data: { Sergei: { 'J.foo-bar': 1 } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'ability-patch', version: 1, data: { Sergei: { 'J.cooldown': 'slow' } } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'ability-patch', version: 1, data: { Sergei: ['J.cooldown'] } }).length > 0);
  assert.ok(validateToolPatch({ tool: 'ability-patch', version: 1, data: { 'Ser gei': { 'J.cooldown': 1 } } }).length > 0);
});

test('ability-patch: applies against the REAL src/abilities.ts and round-trips', () => {
  // Whatever EOL the working tree uses (autocrlf) — don't normalize.
  const real = readFileSync(path.join(here, '../../src/abilities.ts'), 'utf8');
  const patch = {
    tool: 'ability-patch', version: 1, generated: 'test',
    data: { Sergei: { 'J.cooldown': 3.7 }, Trunk: { 'L.gripStunDuration': 3.5 } },
  };
  assert.deepEqual(validateToolPatch(patch), []);
  const once = applyPatch(real, patch);
  const lf = once.replace(/\r\n/g, '\n');
  // Sergei J (Gorilla Rush): cooldown 4.0 → 3.7, neighbours intact.
  assert.match(lf, /cooldown: 3\.7,\n      windUp: 0\.04,\n      speedMultiplier: 2\.6,/);
  // Trunk L (Trunk Grip, 3rd call): gripStunDuration 3.80 → 3.5 with
  // the BLOQUE FINAL micropass comment above it intact.
  assert.match(lf, /gripStunDuration: 3\.5,\n    \}\),/);
  assert.ok(lf.includes('//   4.25 → 3.80 (-11 %, micropass 2)'));
  // Kowalski (untouched) byte-identical.
  const kowalskiBlock = real.slice(real.indexOf('Kowalski: ['), real.indexOf('// Cheeto'));
  assert.ok(once.includes(kowalskiBlock));
  // Dispatch === direct call; idempotent on second apply.
  assert.equal(once, applyAbilityPatch(real, patch.data));
  assert.equal(applyPatch(once, patch), once);
});
