#!/usr/bin/env node
// ---------------------------------------------------------------------------
// maintenance — open or close the online window without restarting
// ---------------------------------------------------------------------------
//
// Writes the file the server reads (`$DATA_DIR/maintenance.json`, the same
// DATA_DIR as the DB; see server/src/maintenance.ts). While the window is
// active nobody new gets into the online, running matches end normally, and
// the server can be deployed once /health says live.clients = 0. Nothing
// restarts; the server picks the change up within 3 s. The window survives
// the deploy (it lives on the volume) and expires on its own.
//
// Subcommands:
//   on --for <min>   close the online now for <min> minutes (1..120)
//   off              open it again
//   status           what the file says
//
// On Railway, from the container shell (WORKDIR /app):
//   node scripts/maintenance.mjs on --for 20
//   node scripts/maintenance.mjs off
//
// Every subcommand refuses to run when $DATA_DIR/br-online.sqlite does not
// exist: the file must sit next to the live DB, on the volume. Run
// anywhere else (a local checkout), 'off' or 'status' would report an open
// online while production stays closed.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Same resolution as server/src/db.ts and server/src/maintenance.ts.
const DATA_DIR = process.env.DATA_DIR ?? './data';
const DB_PATH = resolve(`${DATA_DIR}/br-online.sqlite`);
const FILE = resolve(`${DATA_DIR}/maintenance.json`);
const MAX_MIN = 120; // MAX_WINDOW_MS in server/src/maintenance.ts

const [cmd, ...args] = process.argv.slice(2);

if (['on', 'off', 'status'].includes(cmd) && !existsSync(DB_PATH)) {
  console.error(`[maintenance] no DB at ${DB_PATH}: DATA_DIR does not point at the server's volume, so this is not the window the server reads. On Railway, run it from the container shell (WORKDIR /app).`);
  process.exit(1);
}

function when(ms) {
  const d = new Date(ms);
  const madrid = d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
  return `${madrid} (España) · ${d.toISOString().slice(11, 16)} UTC`;
}

function readFile() {
  if (!existsSync(FILE)) return null;
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return 'corrupt'; }
}

if (cmd === 'on') {
  const i = args.indexOf('--for');
  const min = Number(i >= 0 ? args[i + 1] : NaN);
  if (!Number.isInteger(min) || min < 1 || min > MAX_MIN) {
    console.error(`[maintenance] usage: on --for <min>, whole minutes between 1 and ${MAX_MIN}`);
    process.exit(1);
  }
  const startsAt = Date.now();
  const endsAt = startsAt + min * 60_000;
  // Atomic: the server never reads a half-written file.
  writeFileSync(`${FILE}.tmp`, JSON.stringify({ startsAt, endsAt, createdAt: startsAt }));
  renameSync(`${FILE}.tmp`, FILE);
  console.log(`[maintenance] ON — online closed until ${when(endsAt)} (${min} min).`);
  console.log('[maintenance] Within 3 s nobody new gets in; running matches end normally.');
  console.log('[maintenance] Deploy once /health says "live":{"clients":0}. Then: node scripts/maintenance.mjs off');
} else if (cmd === 'off') {
  const had = existsSync(FILE);
  rmSync(FILE, { force: true });
  console.log(had ? '[maintenance] OFF — online open again (within 3 s).' : '[maintenance] no window was set; the online is open.');
} else if (cmd === 'status') {
  const w = readFile();
  if (w === null) console.log('[maintenance] no window: the online is open.');
  else if (w === 'corrupt') console.log(`[maintenance] ${FILE} is not valid JSON: the server ignores it (online open). Run "off" to remove it.`);
  else if (Date.now() >= w.endsAt) console.log(`[maintenance] window expired at ${when(w.endsAt)}: the online is open. Run "off" to tidy up.`);
  else console.log(`[maintenance] ACTIVE until ${when(w.endsAt)} (~${Math.ceil((w.endsAt - Date.now()) / 60_000)} min left).`);
} else {
  console.log('usage: node scripts/maintenance.mjs on --for <min> | off | status');
  process.exit(cmd ? 1 : 0);
}
