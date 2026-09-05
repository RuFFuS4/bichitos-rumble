#!/usr/bin/env node
// ---------------------------------------------------------------------------
// apply-tool-patch — apply a ToolPatch JSON to its target source file
// ---------------------------------------------------------------------------
//
// Thin CLI over scripts/tool-patch-core.mjs (H3 slice 1). All mutation
// logic lives in the core module so the same code serves this CLI, the
// dev-server apply endpoint (H3 slice 4) and the test suite
// (npm run test:patch).
//
// Routes the payload (via targetByTool) to one of:
//   · src/roster.ts                — calibrate     (sparse field rewrite)
//   · src/animation-overrides.ts   — anim-lab      (sparse MERGE — never
//                                    deletes; see core docstring)
//   · src/arena-decor-layouts.ts   — decor-editor  (per-pack wholesale)
//   · src/gamefeel.ts              — feel-patch    (numeric token rewrite)
//   · src/animation-personality-overrides.ts
//                                  — anim-personality (sparse numeric
//                                    MERGE — never deletes)
//   · src/abilities.ts             — ability-patch (slot-indexed numeric
//                                    MERGE into the CRITTER_ABILITIES
//                                    factory-call overrides — never
//                                    deletes)
//
// Safety
// ------
// · Validates the envelope AND the payload shape before touching disk.
// · Always prints a coloured diff BEFORE writing.
// · `--dry-run` prints the diff and exits without writing.
// · Bails out hard (non-zero exit, no write) on any validation or
//   anchor error — partial application is impossible by construction.
//
// Usage
// -----
//   npm run apply-tool-patch                            # uses tool-patch.json
//     (if absent: falls back to a SINGLE tool-patch-<tool>-<stamp>.json
//      in the cwd — the filename downloadPatch() emits from the labs)
//   npm run apply-tool-patch -- --patch=path/to.json    # alt input
//   npm run apply-tool-patch -- --dry-run               # preview only
//   npm run apply-tool-patch -- --help
// ---------------------------------------------------------------------------

import { readFile, writeFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  applyPatch,
  validateToolPatch,
  targetByTool,
  simpleDiff,
} from './tool-patch-core.mjs';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = {
  patch: 'tool-patch.json',
  patchExplicit: false, // true when the user passed --patch= (disables the download-name fallback)
  dryRun: false,
  help: false,
};
for (const a of args) {
  if (a === '--dry-run') flags.dryRun = true;
  else if (a === '--help' || a === '-h') flags.help = true;
  else if (a.startsWith('--patch=')) { flags.patch = a.slice('--patch='.length); flags.patchExplicit = true; }
  else {
    console.error(`Unknown arg: ${a}`);
    process.exit(2);
  }
}

if (flags.help) {
  console.log(`apply-tool-patch — apply a ToolPatch JSON to its target source file

Usage:
  npm run apply-tool-patch                       # reads ./tool-patch.json
                                                 # (or the single tool-patch-<tool>-<stamp>.json download in the cwd)
  npm run apply-tool-patch -- --patch=foo.json   # alt input
  npm run apply-tool-patch -- --dry-run          # show diff, do not write

Patch shape (see src/tools/tool-storage.ts ToolPatch):
  { "tool": "calibrate" | "anim-lab" | "decor-editor" | "feel-patch" | "anim-personality" | "ability-patch",
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
// Downloaded-patch fallback
// ---------------------------------------------------------------------------
//
// `downloadPatch()` in src/tools/tool-storage.ts names browser downloads
// `tool-patch-<tool>-<stamp>.json`, not `tool-patch.json`. When no --patch=
// was given, the default file is absent, and EXACTLY ONE file matching that
// pattern sits in the cwd, use it — saves the manual rename after a
// download. Two or more matches is ambiguous → bail and ask for --patch=.

if (!flags.patchExplicit) {
  try {
    await access(path.resolve(process.cwd(), flags.patch));
  } catch {
    // Anchor on the timestamp shape downloadPatch emits (ISO 8601 with
    // [:.] replaced by '-') so unrelated tool-patch-*.json files with
    // hand-made names don't get silently picked up.
    const downloadName = /^tool-patch-.+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
    const candidates = (await readdir(process.cwd())).filter((f) => downloadName.test(f));
    if (candidates.length === 1) {
      flags.patch = candidates[0];
      console.log(c.cyan(`No tool-patch.json found — using downloaded patch: ${candidates[0]}`));
    } else if (candidates.length > 1) {
      console.error(c.red(`✗ No tool-patch.json and ${candidates.length} downloaded patches in the cwd:`));
      for (const f of candidates) console.error(c.red(`    · ${f}`));
      console.error(c.dim('  Pick one explicitly: npm run apply-tool-patch -- --patch=<file>'));
      process.exit(1);
    }
    // 0 matches → fall through to the normal "cannot read patch" error.
  }
}

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

const problems = validateToolPatch(patch);
if (problems.length > 0) {
  console.error(c.red('✗ Patch failed validation:'));
  for (const p of problems) console.error(c.red(`    · ${p}`));
  process.exit(1);
}

console.log(c.bold(`apply-tool-patch — tool: ${c.cyan(patch.tool)}`));
console.log(c.dim(`  generated: ${patch.generated ?? '(unknown)'}`));
console.log(c.dim(`  patch:     ${path.relative(process.cwd(), patchPath)}`));
console.log(c.dim(`  mode:      ${flags.dryRun ? 'DRY RUN (no write)' : 'apply'}`));

// ---------------------------------------------------------------------------
// Apply via core
// ---------------------------------------------------------------------------

const target = targetByTool[patch.tool];
const targetPath = path.resolve(process.cwd(), target);
try { await access(targetPath); }
catch {
  console.error(c.red(`✗ Target file not found: ${targetPath}`));
  process.exit(1);
}

const original = await readFile(targetPath, 'utf8');
let updated;
try {
  updated = applyPatch(original, patch);
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
