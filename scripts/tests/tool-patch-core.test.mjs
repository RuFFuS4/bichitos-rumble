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
