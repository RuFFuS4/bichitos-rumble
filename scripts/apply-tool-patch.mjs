#!/usr/bin/env node
// ---------------------------------------------------------------------------
// apply-tool-patch — apply a ToolPatch JSON to its target source file
// ---------------------------------------------------------------------------
//
// Reads `tool-patch.json` (default) and routes the payload to one of:
//   · src/roster.ts                — calibrate
//   · src/animation-overrides.ts   — anim-lab
//   · src/arena-decor-layouts.ts   — decor-editor
//
// Why a single script + dispatcher: every internal lab emits the same
// `{ tool, version, generated, data }` envelope (see
// src/tools/tool-storage.ts → ToolPatch), so we can keep one CLI entry
// point and grow the per-tool mutation logic in isolated functions.
//
// Safety
// ------
// · Always prints a coloured diff BEFORE writing.
// · `--dry-run` prints the diff and exits without writing.
// · Per-tool regex is acutely scoped (matches the entry block by `id:
//   '<critterId>'` or `<packId>:` so the rewrite never bleeds outside
//   the intended block).
// · Bails out hard with non-zero exit on:
//     - unknown tool name
//     - version mismatch
//     - target file not found
//     - block not found for an entry referenced in the patch
// · Never escalates a partial failure into a write — either every entry
//   in the patch is applied or none of them are (read-then-write
//   semantics, no streaming mutation).
//
// Usage
// -----
//   npm run apply-tool-patch                            # uses tool-patch.json
//   npm run apply-tool-patch -- --patch=path/to.json    # alt input
//   npm run apply-tool-patch -- --dry-run               # preview only
//   npm run apply-tool-patch -- --help
// ---------------------------------------------------------------------------

import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = {
  patch: 'tool-patch.json',
  dryRun: false,
  help: false,
};
for (const a of args) {
  if (a === '--dry-run') flags.dryRun = true;
  else if (a === '--help' || a === '-h') flags.help = true;
  else if (a.startsWith('--patch=')) flags.patch = a.slice('--patch='.length);
  else {
    console.error(`Unknown arg: ${a}`);
    process.exit(2);
  }
}

if (flags.help) {
  console.log(`apply-tool-patch — apply a ToolPatch JSON to its target source file

Usage:
  npm run apply-tool-patch                       # reads ./tool-patch.json
  npm run apply-tool-patch -- --patch=foo.json   # alt input
  npm run apply-tool-patch -- --dry-run          # show diff, do not write

Patch shape (see src/tools/tool-storage.ts ToolPatch):
  { "tool": "calibrate" | "anim-lab" | "decor-editor",
    "version": 1, "generated": "...", "data": { ... } }
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Console colour helpers (no deps; if NO_COLOR env or non-TTY → plain)
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  red:   (s) => useColor ? `\x1b[31m${s}\x1b[0m` : s,
  green: (s) => useColor ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:  (s) => useColor ? `\x1b[36m${s}\x1b[0m` : s,
  dim:   (s) => useColor ? `\x1b[2m${s}\x1b[0m` : s,
  bold:  (s) => useColor ? `\x1b[1m${s}\x1b[0m` : s,
};

// ---------------------------------------------------------------------------
// Load + validate patch
// ---------------------------------------------------------------------------

const patchPath = path.resolve(process.cwd(), flags.patch);
let patchRaw;
try {
  patchRaw = await readFile(patchPath, 'utf8');
} catch {
  console.error(c.red(`✗ Cannot read patch file: ${patchPath}`));
  console.error(c.dim('  Did you save the JSON from /calibrate or /anim-lab to that location?'));
  process.exit(1);
}

let patch;
try {
  patch = JSON.parse(patchRaw);
} catch (err) {
  console.error(c.red(`✗ Patch is not valid JSON: ${err.message}`));
  process.exit(1);
}

if (!patch || typeof patch !== 'object' || !patch.tool || patch.version == null || !patch.data) {
  console.error(c.red('✗ Patch is missing required fields (tool / version / data).'));
  process.exit(1);
}

// Version policy:
//   · calibrate / decor-editor — only version 1.
//   · anim-lab — versions 1 (string-only values) and 2 (string OR
//     object form { clip, speed?, loop? }). v2 patches with
//     speed/loop are accepted by the script and written to source as
//     object literals; the runtime resolver currently ignores
//     speed/loop (tooling metadata).
const SUPPORTED_VERSIONS = {
  'calibrate':    [1],
  'anim-lab':     [1, 2],
  'decor-editor': [1],
};
const versionsForTool = SUPPORTED_VERSIONS[patch.tool] ?? [1];
if (!versionsForTool.includes(patch.version)) {
  console.error(c.red(
    `✗ Unsupported patch version: ${patch.version} for tool "${patch.tool}". `
    + `This script handles version${versionsForTool.length > 1 ? 's' : ''} ${versionsForTool.join(', ')}.`,
  ));
  process.exit(1);
}

console.log(c.bold(`apply-tool-patch — tool: ${c.cyan(patch.tool)}`));
console.log(c.dim(`  generated: ${patch.generated ?? '(unknown)'}`));
console.log(c.dim(`  patch:     ${path.relative(process.cwd(), patchPath)}`));
console.log(c.dim(`  mode:      ${flags.dryRun ? 'DRY RUN (no write)' : 'apply'}`));

// ---------------------------------------------------------------------------
// Per-tool dispatch
// ---------------------------------------------------------------------------

const targetByTool = {
  'calibrate':     'src/roster.ts',
  'anim-lab':      'src/animation-overrides.ts',
  'decor-editor':  'src/arena-decor-layouts.ts',
};

const target = targetByTool[patch.tool];
if (!target) {
  console.error(c.red(`✗ Unknown tool: ${patch.tool}`));
  process.exit(1);
}

const targetPath = path.resolve(process.cwd(), target);
try { await access(targetPath); }
catch {
  console.error(c.red(`✗ Target file not found: ${targetPath}`));
  process.exit(1);
}

const original = await readFile(targetPath, 'utf8');
let updated;

try {
  if (patch.tool === 'calibrate')         updated = applyCalibrate(original, patch.data);
  else if (patch.tool === 'anim-lab')     updated = applyAnimLab(original, patch.data);
  else if (patch.tool === 'decor-editor') updated = applyDecorEditor(original, patch.data);
  else throw new Error('unreachable — tool guarded above');
} catch (err) {
  console.error(c.red(`✗ Patch could not be applied: ${err.message}`));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Diff print + write
// ---------------------------------------------------------------------------

if (updated === original) {
  console.log(c.dim('  (no effective change — patch values match the source)'));
  process.exit(0);
}

const diff = simpleDiff(original, updated);
console.log('');
console.log(c.bold(`Diff for ${target}:`));
for (const line of diff) {
  if (line.kind === 'add')      console.log(c.green('+ ') + line.text);
  else if (line.kind === 'del') console.log(c.red('- ') + line.text);
  else if (line.kind === 'sep') console.log(c.dim('    ' + line.text));
  else                          console.log(c.dim('  ' + line.text));
}

if (flags.dryRun) {
  console.log('');
  console.log(c.dim('(dry-run — no file written)'));
  process.exit(0);
}

await writeFile(targetPath, updated, 'utf8');
console.log('');
console.log(c.green(`✓ Wrote ${target}`));
console.log(c.dim('  Review with `git diff ' + target + '` and commit when ready.'));

// ===========================================================================
// Per-tool mutation
// ===========================================================================

/**
 * Apply a CalibratePatch to roster.ts.
 *
 * Each entry is located by `id: 'critterId'`. The rewrite is scoped to
 * that entry's text-block (until the next top-level `},`). Within the
 * block we replace these specific tokens:
 *   - scale: <number>,
 *   - rotation: <Math.PI / 2 | -Math.PI / 2 | Math.PI | -Math.PI | 0 | <decimal>>,
 *   - pivotY: <number>,
 *
 * Fields the patch omits are left untouched.
 */
function applyCalibrate(source, data) {
  let out = source;
  for (const [critterId, fields] of Object.entries(data)) {
    const block = locateBlock(out, `id: '${critterId}'`, /^\s{0,2}\},\s*$/m);
    if (!block) throw new Error(`calibrate: entry not found for critter '${critterId}'`);
    let inner = block.text;
    if (typeof fields.scale === 'number') {
      inner = replaceField(inner, /scale:\s*[^,}\n]+/g, `scale: ${formatNumber(fields.scale)}`);
    }
    if (typeof fields.pivotY === 'number') {
      inner = replaceField(inner, /pivotY:\s*[^,}\n]+/g, `pivotY: ${formatNumber(fields.pivotY)}`);
    }
    if (typeof fields.rotation === 'number') {
      inner = replaceField(inner, /rotation:\s*[^,}\n]+/g, `rotation: ${formatRotation(fields.rotation)}`);
    }
    out = out.slice(0, block.start) + inner + out.slice(block.end);
  }
  return out;
}

/**
 * Apply an AnimLabPatch to animation-overrides.ts.
 *
 * The whole `ANIMATION_OVERRIDES` record is replaced — anim-lab
 * exports the user's full intent for every modified critter, so a
 * merge-by-key strategy could leak removed states. Easier and safer
 * to rewrite the record from the patch verbatim.
 *
 * Critters present in the source but absent in the patch are LOST.
 * That's deliberate: anim-lab includes every critter the user has
 * touched in the session in `data`, including "no overrides" entries
 * if the user explicitly cleared one. If you only want to add to the
 * existing overrides, edit the JSON before running this.
 */
function applyAnimLab(source, data) {
  const start = source.indexOf('export const ANIMATION_OVERRIDES');
  if (start < 0) throw new Error('anim-lab: ANIMATION_OVERRIDES export not found');
  // Find the matching closing brace + semicolon.
  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) throw new Error('anim-lab: ANIMATION_OVERRIDES open brace not found');
  let depth = 0;
  let close = -1;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close < 0) throw new Error('anim-lab: ANIMATION_OVERRIDES close brace not found');
  const lines = ['{'];
  const ids = Object.keys(data).sort();
  for (const id of ids) {
    const inner = data[id];
    const keys = Object.keys(inner);
    if (keys.length === 0) continue;
    lines.push(`  ${id}: {`);
    for (const k of keys.sort()) {
      lines.push(`    ${k}: ${formatAnimLabValue(inner[k])},`);
    }
    lines.push(`  },`);
  }
  lines.push('}');
  return source.slice(0, openBrace) + lines.join('\n') + source.slice(close + 1);
}

/**
 * Render a single anim-lab override value as TypeScript source.
 *
 *   · strings → JSON.stringify (back-compat with v1 patches and the
 *     existing string-shorthand entries already in source).
 *   · objects with only `clip` → string shorthand (smaller diff).
 *   · objects with `speed`/`loop` → object literal with TS-friendly
 *     formatting (single-quoted clip, unquoted keys).
 *
 * Examples
 *   "Idle"                             → 'Idle'
 *   { clip: "Idle" }                   → 'Idle'
 *   { clip: "Idle", speed: 1.15 }      → { clip: 'Idle', speed: 1.15 }
 *   { clip: "Idle", loop: false }      → { clip: 'Idle', loop: false }
 */
function formatAnimLabValue(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v && typeof v === 'object' && typeof v.clip === 'string') {
    const hasSpeed = typeof v.speed === 'number' && v.speed !== 1;
    const hasLoop = typeof v.loop === 'boolean';
    if (!hasSpeed && !hasLoop) return JSON.stringify(v.clip);
    const parts = [`clip: ${JSON.stringify(v.clip)}`];
    if (hasSpeed) parts.push(`speed: ${formatNumber(v.speed)}`);
    if (hasLoop) parts.push(`loop: ${v.loop}`);
    return `{ ${parts.join(', ')} }`;
  }
  // Defensive: unknown shape — emit as JSON so the source still parses
  // and the user sees something they can hand-edit.
  return JSON.stringify(v);
}

/**
 * Apply a DecorEditorPatch to arena-decor-layouts.ts.
 *
 * Per-pack: locate the `<packId>: [` block in DECOR_LAYOUTS and
 * replace its contents with the patch's placement array. Unmodified
 * packs are left as-is.
 */
function applyDecorEditor(source, data) {
  let out = source;
  for (const [packId, placements] of Object.entries(data)) {
    // Match `<packId>: [` — could be at the start of a line with any indentation.
    const re = new RegExp(`(^|\\n)(\\s*${escapeRegex(packId)}:\\s*\\[)`, 'm');
    const m = re.exec(out);
    if (!m) throw new Error(`decor-editor: pack '${packId}' not found in DECOR_LAYOUTS`);
    const openIdx = m.index + m[1].length + m[2].length;
    // Find matching `]`. Brackets balance.
    let depth = 1;
    let close = -1;
    for (let i = openIdx; i < out.length; i++) {
      if (out[i] === '[') depth++;
      else if (out[i] === ']') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close < 0) throw new Error(`decor-editor: closing bracket for pack '${packId}' not found`);
    const indent = '    ';
    const body = placements.length === 0
      ? '\n  '
      : '\n' + placements.map((p) =>
          `${indent}{ r: ${formatNumber(p.r)}, angle: ${formatNumber(p.angle)}, ` +
          `rotY: ${formatNumber(p.rotY)}, scale: ${formatNumber(p.scale)}, ` +
          `type: ${JSON.stringify(p.type)} },`
        ).join('\n') + '\n  ';
    out = out.slice(0, openIdx) + body + out.slice(close);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block locator + helpers
// ---------------------------------------------------------------------------

/**
 * Find the text block that contains `anchor` and runs until a line
 * matching `closeRe` (default: indented `},`). Returns { start, end,
 * text } where slice(start, end) === text. Used to acutely scope the
 * regex replacements within a single RosterEntry.
 */
function locateBlock(source, anchor, closeRe) {
  const aIdx = source.indexOf(anchor);
  if (aIdx < 0) return null;
  // Walk forward line by line until we hit a matching close line.
  const tail = source.slice(aIdx);
  const closeMatch = tail.match(closeRe);
  if (!closeMatch) return null;
  const localEnd = closeMatch.index + closeMatch[0].length;
  return {
    start: aIdx,
    end: aIdx + localEnd,
    text: tail.slice(0, localEnd),
  };
}

function replaceField(text, fieldRe, replacement) {
  // Replace ALL matches inside the block. Most blocks only have one,
  // but pack-level structures may have repeats — keep it consistent.
  return text.replace(fieldRe, replacement);
}

function formatNumber(n) {
  // Match the existing roster.ts conventions: round-tripped 3-decimal
  // form unless the value is essentially an integer or a known clean
  // value. Avoids spurious trailing zeros / wandering decimals.
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(3);
  // Trim trailing zeros while keeping at least one decimal.
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function formatRotation(r) {
  const SNAP = 0.01;
  if (Math.abs(r) < SNAP) return '0';
  if (Math.abs(r - Math.PI / 2) < SNAP) return 'Math.PI / 2';
  if (Math.abs(r + Math.PI / 2) < SNAP) return '-Math.PI / 2';
  if (Math.abs(r - Math.PI) < SNAP) return 'Math.PI';
  if (Math.abs(r + Math.PI) < SNAP) return '-Math.PI';
  return r.toFixed(4);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Line-based diff producer.
 *
 * Two strategies, picked from line counts:
 *
 * 1. Same line count (calibrate's typical case — fields are rewritten
 *    in place without changing line counts): zip line-by-line and emit
 *    del+add pairs for every divergence. Then post-process to keep ±N
 *    context lines around each pair, collapsing long unchanged runs
 *    with a `...` separator.
 *
 * 2. Different line count (anim-lab and decor-editor block rewrites):
 *    trim the common prefix/suffix and emit the entire diverged middle
 *    as one del-block followed by one add-block. Cheap and correct
 *    because our mutators only ever rewrite a single contiguous block
 *    per run for these tools.
 *
 * Both strategies emit `{ kind: 'add' | 'del' | 'ctx' | 'sep', text }`.
 * Avoids LCS DP entirely so memory cost stays O(N) regardless of file
 * size — the source files we touch are 10K+ lines.
 */
function simpleDiff(a, b) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const ctx = 2;

  if (aLines.length === bLines.length) {
    const raw = [];
    for (let i = 0; i < aLines.length; i++) {
      if (aLines[i] === bLines[i]) {
        raw.push({ kind: 'ctx', text: aLines[i] });
      } else {
        raw.push({ kind: 'del', text: aLines[i] });
        raw.push({ kind: 'add', text: bLines[i] });
      }
    }
    return collapseHunks(raw, ctx);
  }

  // Different line count — trim common prefix/suffix, dump middle.
  const out = [];
  let prefix = 0;
  const minLen = Math.min(aLines.length, bLines.length);
  while (prefix < minLen && aLines[prefix] === bLines[prefix]) prefix++;
  let aEnd = aLines.length;
  let bEnd = bLines.length;
  while (aEnd > prefix && bEnd > prefix && aLines[aEnd - 1] === bLines[bEnd - 1]) {
    aEnd--; bEnd--;
  }

  const ctxStart = Math.max(0, prefix - ctx);
  if (ctxStart > 0) out.push({ kind: 'sep', text: '...' });
  for (let i = ctxStart; i < prefix; i++) out.push({ kind: 'ctx', text: aLines[i] });

  for (let i = prefix; i < aEnd; i++) out.push({ kind: 'del', text: aLines[i] });
  for (let j = prefix; j < bEnd; j++) out.push({ kind: 'add', text: bLines[j] });

  const ctxEndA = Math.min(aLines.length, aEnd + ctx);
  for (let i = aEnd; i < ctxEndA; i++) out.push({ kind: 'ctx', text: aLines[i] });
  if (ctxEndA < aLines.length) out.push({ kind: 'sep', text: '...' });

  return out;
}

/**
 * Post-process raw zipped diff: keep only ±ctxLines context around any
 * `add`/`del` line. Collapse long unchanged runs with a single `sep`.
 */
function collapseHunks(raw, ctxLines) {
  const isChange = (k) => k === 'add' || k === 'del';
  const visible = new Array(raw.length).fill(false);
  for (let k = 0; k < raw.length; k++) {
    if (!isChange(raw[k].kind)) continue;
    const lo = Math.max(0, k - ctxLines);
    const hi = Math.min(raw.length - 1, k + ctxLines);
    for (let kk = lo; kk <= hi; kk++) visible[kk] = true;
  }
  const out = [];
  let prevVisible = false;
  let started = false;
  for (let k = 0; k < raw.length; k++) {
    if (visible[k]) {
      if (started && !prevVisible) out.push({ kind: 'sep', text: '...' });
      out.push(raw[k]);
      prevVisible = true;
      started = true;
    } else {
      prevVisible = false;
    }
  }
  return out;
}
