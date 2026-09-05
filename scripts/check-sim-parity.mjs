#!/usr/bin/env node
// ---------------------------------------------------------------------------
// check-sim-parity — byte-compare the hand-kept client/server sim mirrors
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS
//
// Parts of the simulation are duplicated by hand. `src/arena-fragments.ts`
// (client) and `server/src/sim/arena-fragments.ts` (server) must produce the
// SAME layout for the same seed: if they drift, an online match desyncs the
// floor — a player falls through a fragment that is still alive for everyone
// else, and nothing in the build says why.
//
// There is no shared module, and there cannot be one today:
//   · `server/tsconfig.json` pins `rootDir: "src"` (i.e. `server/src`), so a
//     file above that root does not compile into the server build.
//   · `server/Dockerfile` copies only `server/src` into the image, so a
//     shared file outside it would not even exist at runtime.
// Decision recorded in docs/ARENA_V2.md §2 ("Restricciones que manda el
// código"): keep the mirrors and turn the manual discipline into a blocking
// gate. This script is that gate — it runs in `npm run check`.
//
// It complements, and does not replace, the sibling checks:
//   · `check-pws-parity.mjs` compares LOGIC (strips comments, tolerates a
//     server-only helper) because that mirror is deliberately not identical.
//   · `verify-ability-parity.mjs` compares extracted VALUES across two files
//     written in different shapes.
// Here the two files are meant to be the same file, so the check is the
// strictest one available: a raw buffer compare.
//
// HOW IT COMPARES
//
// Byte for byte over the whole file, after exactly two normalizations:
//   1. EOL — CRLF vs LF is not drift (the working tree is CRLF, git stores
//      LF; a file checked out either way must still pass).
//   2. The leading header comment block of each side. That block is per-copy
//      documentation BY DESIGN: it names which copy this is ("CLIENT copy" /
//      "SERVER copy" — line 2, verified with `diff` to be the only real
//      difference today) and the sibling path it must stay in sync with, so
//      the two headers can never be identical. It is the leading run of `//`
//      lines, it must exist, and it must stay within `maxHeaderLines` — a
//      header that grows past the budget is reported instead of ignored, so
//      the tolerance cannot silently swallow code.
//
// NOTHING else is normalized. Comments inside the body, blank lines, spacing
// and identifier casing all count, because the value of this check is that a
// single differing byte of logic FAILS it.
//
// Run:
//   node scripts/check-sim-parity.mjs      (from the repo root)
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// --- The mirror pairs -------------------------------------------------------
// Grows as more sim files get mirrored (arena profiles, pack ids…). Adding a
// pair is one entry; no other change is needed.

const PAIRS = [
  {
    name: 'arena-fragments',
    client: 'src/arena-fragments.ts',
    server: 'server/src/sim/arena-fragments.ts',
    // Header budget: 11 lines client / 10 server today (each header names
    // the OTHER file, so the two can never be byte-identical).
    maxHeaderLines: 12,
    note: 'deterministic layout generator — same seed must yield the same fragments/batches on both sides',
  },
];

const ROOT = process.cwd();
const MAX_REPORTED_DIVERGENCES = 5;

/** Read a mirror file and normalize EOL. Missing file = hard error, never a pass. */
async function readMirror(rel) {
  const abs = path.resolve(ROOT, rel);
  let buf;
  try {
    buf = await readFile(abs);
  } catch (err) {
    throw new Error(`cannot read ${rel} (looked at ${abs}): ${err.code ?? err.message}`);
  }
  return buf.toString('utf8').replace(/\r\n/g, '\n');
}

/** Split off the leading `//` header block — the one documented divergence. */
function splitHeader(text, rel, maxHeaderLines) {
  const lines = text.split('\n');
  let n = 0;
  while (n < lines.length && lines[n].startsWith('//')) n++;
  if (n === 0) {
    throw new Error(`${rel} does not start with the mirror header comment; refusing to guess where the body begins`);
  }
  if (n > maxHeaderLines) {
    throw new Error(
      `${rel} header comment is ${n} lines, over the ${maxHeaderLines}-line budget; ` +
        'shorten it or raise maxHeaderLines deliberately (the ignored block must stay documentation only)',
    );
  }
  return { headerLines: n, body: lines.slice(n) };
}

function diffReport(client, server) {
  const max = Math.max(client.body.length, server.body.length);
  const out = [];
  for (let i = 0; i < max && out.length < MAX_REPORTED_DIVERGENCES; i++) {
    const a = client.body[i];
    const b = server.body[i];
    if (a === b) continue;
    // Two lines that read the same but differ in spacing are quoted, so the
    // report never shows two apparently identical lines.
    const whitespaceOnly = a !== undefined && b !== undefined && a.trim() === b.trim();
    const show = (line) =>
      line === undefined ? '(end of file)' : whitespaceOnly ? JSON.stringify(line) : line;
    const ca = show(a);
    const cb = show(b);
    out.push(
      `  client:${String(i + client.headerLines + 1).padStart(4)}  ${ca}\n` +
        `  server:${String(i + server.headerLines + 1).padStart(4)}  ${cb}`,
    );
  }
  if (out.length === 0) {
    // Bodies compare unequal but no line differs: only reachable if one side
    // carries a BOM or another byte the line split hides.
    out.push('  (no differing line — check for a byte-order mark or an invisible character)');
  }
  return out;
}

let failed = 0;

for (const pair of PAIRS) {
  const label = `${pair.name} (${pair.client} ↔ ${pair.server})`;
  let client;
  let server;
  try {
    const [clientText, serverText] = await Promise.all([readMirror(pair.client), readMirror(pair.server)]);
    client = splitHeader(clientText, pair.client, pair.maxHeaderLines);
    server = splitHeader(serverText, pair.server, pair.maxHeaderLines);
  } catch (err) {
    console.error(`check-sim-parity ✗ ${label}\n  ${err.message}`);
    failed++;
    continue;
  }

  const clientBody = Buffer.from(client.body.join('\n'), 'utf8');
  const serverBody = Buffer.from(server.body.join('\n'), 'utf8');

  if (Buffer.compare(clientBody, serverBody) !== 0) {
    console.error(`check-sim-parity ✗ ${label} have drifted (${pair.note}):`);
    console.error(diffReport(client, server).join('\n  ---\n'));
    console.error('  Fix: port the change to the other side — the mirror is manual, this check is the only gate.');
    failed++;
    continue;
  }

  console.log(
    `check-sim-parity ✓ ${pair.name}: ${pair.client} ≡ ${pair.server} ` +
      `(${clientBody.length} bytes byte-identical; headers of ${client.headerLines}/${server.headerLines} lines ignored)`,
  );
}

if (failed > 0) {
  console.error(`check-sim-parity ✗ ${failed}/${PAIRS.length} mirror pair(s) out of sync`);
  process.exit(1);
}

console.log(`check-sim-parity ✓ ${PAIRS.length}/${PAIRS.length} mirror pair(s) in sync`);
