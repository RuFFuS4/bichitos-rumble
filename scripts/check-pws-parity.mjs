#!/usr/bin/env node
// ---------------------------------------------------------------------------
// check-pws-parity — verify src/pws-stats.ts matches its server mirror
// ---------------------------------------------------------------------------
//
// The header of src/pws-stats.ts promises that server/src/sim/pws-stats.ts
// stays in sync (the authoritative server must derive the exact same
// numbers the client HUD + physics use), but until now nothing verified
// it. This script does, as part of `npm run check`.
//
// Deliberately NOT a raw byte compare: the server mirror strips the
// client's doc comments and appends one server-only helper
// (`getCritterPWS`) — that layout predates this check (the server file's
// own header says "byte-identical LOGIC"). So we compare the logic:
// strip comments + blank lines from both files, allow exactly the known
// server-only trailing helper, and require everything else to match line
// for line. Any other difference — a scalar, a roster row, a formula —
// fails the check.
//
// If the two files are ever made truly byte-identical, this still
// passes; tighten it to a plain buffer compare at that point.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const CLIENT = 'src/pws-stats.ts';
const SERVER = 'server/src/sim/pws-stats.ts';

/** Strip comments + blank lines, keep indentation (part of identity).
 *  Comment stripping is regex-based and safe HERE because neither file
 *  contains `//` or block-comment markers inside string literals. */
function normalize(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block + doc comments
    .replace(/\/\/.*$/gm, '')         // line + trailing comments
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
}

// The one divergence the mirror is allowed: a server-only lookup helper
// appended at the end of the file. Anything else must be identical.
const SERVER_ONLY_TAIL = [
  'export function getCritterPWS(name: string): PWS | null {',
  '  return CRITTER_PWS[name] ?? null;',
  '}',
];

async function loadNormalized(rel) {
  const abs = path.resolve(process.cwd(), rel);
  try {
    return normalize(await readFile(abs, 'utf8'));
  } catch {
    console.error(`check-pws-parity ✗ cannot read ${rel}`);
    process.exit(1);
  }
}

const client = await loadNormalized(CLIENT);
const server = await loadNormalized(SERVER);

// Strip the allowlisted tail from the server side — unless the client
// grew the same helper, in which case both sides must carry it.
const clientHasHelper = client.some((l) => l.startsWith('export function getCritterPWS'));
if (!clientHasHelper && server.length >= SERVER_ONLY_TAIL.length) {
  const tail = server.slice(-SERVER_ONLY_TAIL.length);
  if (tail.join('\n') === SERVER_ONLY_TAIL.join('\n')) server.length -= SERVER_ONLY_TAIL.length;
}

const max = Math.max(client.length, server.length);
const drift = [];
for (let i = 0; i < max; i++) {
  if (client[i] !== server[i]) {
    drift.push(`  client: ${client[i] ?? '(end of file)'}\n  server: ${server[i] ?? '(end of file)'}`);
    if (drift.length >= 5) break; // first divergences are enough to act on
  }
}

if (drift.length > 0) {
  console.error(`check-pws-parity ✗ ${CLIENT} and ${SERVER} logic has drifted:`);
  console.error(drift.join('\n  ---\n'));
  console.error('  Fix: port the change to the other side so both derive the same numbers.');
  process.exit(1);
}

console.log(`check-pws-parity ✓ ${CLIENT} ≡ ${SERVER} (logic parity)`);
