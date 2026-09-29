#!/usr/bin/env node
// ---------------------------------------------------------------------------
// smoke-crazygames — the CrazyGames build in a muted browser (H5)
// ---------------------------------------------------------------------------
//
//   node scripts/build-crazygames.mjs          (builds .tmp/crazygames/dist)
//   node scripts/smoke-crazygames.mjs [--port 5185]
//
// On localhost the CrazyGames SDK runs in its 'local' mode (demo ads), so
// nothing is published and no account is needed. It needs the network: the
// SDK comes from their CDN. Three parts:
//
//   1. The real build (vite preview of .tmp/crazygames/dist): the SDK starts,
//      the loading is reported, body gets .platform-crazygames, no online
//      buttons, no request to the online server or Sentry, and a match
//      reports gameplay start / stop around ESC's pause.
//   2. The CrazyGames mode on the dev server (window.__game is there to drive
//      it): R on the end screen asks for the break ad and the next match
//      only starts after it; T during it is ignored; the pause never asks.
//      __platform.state.gameplayMs is set past the 3 min threshold.
//   3. The build served under a subpath, like CG's game-files URL: no 404
//      (root-absolute URLs would break the music without an error).
//
// Every browser starts muted (CLAUDE.md): launchMutedBrowser + muteGameAudio
// and CG's own ?muteAudio=true. Ports: --port for the dev server, +1 for the
// preview, +2 for the subpath server; they must be free.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { launchMutedBrowser, muteGameAudio } from './lib/headless-browser.mjs';

const argv = process.argv.slice(2);
const PORT = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 5185);
const DIST = '.tmp/crazygames/dist';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => {
  console.log(`[smoke-cg] ${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

async function portFree(port) {
  try { await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(800) }); return false; } catch { return true; }
}

async function startVite(args, port) {
  if (!(await portFree(port))) throw new Error(`el puerto ${port} está ocupado`);
  const env = { ...process.env };
  delete env.VITE_SERVER_URL;
  delete env.VITE_SENTRY_DSN;
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...args, '--port', String(port), '--strictPort'], { env, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    if (!(await portFree(port))) return child;
    await sleep(250);
  }
  child.kill();
  throw new Error(`vite ${args.join(' ')} no arranca en ${port}`);
}

async function newPage(browser, url, log) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await muteGameAudio(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The SDK's own local-mode notices ("%cHTML5 SDK …", e.g. a throttled
    // call) are its logging, not errors of the game.
    if (m.text().startsWith('%cHTML5 SDK')) log.sdk.push(m.text().replace(/^%cHTML5 SDK\s+\S.*?;\s+/, '').slice(0, 120));
    else log.errors.push(m.text().slice(0, 200));
  });
  page.on('request', (r) => log.requests.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) log.bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

const platformLog = (page) => page.evaluate(() => window.__platform.state.log.map((l) => l.replace(/^\d+ /, '')));
async function waitLog(page, entry, ms) {
  try {
    await page.waitForFunction((e) => window.__platform?.state.log.some((l) => l.endsWith(e)), entry, { timeout: ms });
    return true;
  } catch { return false; }
}
async function startMatch(page) {
  await page.keyboard.press('Enter'); // title: vs Bots (preselected)
  await page.waitForSelector('#character-select:not(.hidden)', { timeout: 15_000 });
  await page.keyboard.press('Enter'); // the selected critter
}

// A tiny static server that puts DIST under /game/ — CG's game-files URL.
function subpathServer(port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith('/game/')) { res.writeHead(404).end(); return; }
    const file = normalize(join(DIST, path.slice('/game/'.length) || 'index.html'));
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

const children = [];
let browser;
let server;
try {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no hay ${DIST}: corre antes node scripts/build-crazygames.mjs`);
  browser = await launchMutedBrowser();

  // --- 1. The real build ---------------------------------------------------
  console.log('\n[smoke-cg] === 1. el build de CrazyGames (vite preview)');
  children.push(await startVite(['preview', '--outDir', DIST], PORT + 1));
  const log1 = { errors: [], sdk: [], requests: [], bad: [] };
  const p1 = await newPage(browser, `http://localhost:${PORT + 1}/?muteAudio=true`, log1);
  await p1.waitForFunction(() => window.__platform && window.__platform.state.backend !== 'pending', null, { timeout: 30_000 });
  const s1 = await p1.evaluate(() => ({
    name: window.__platform.state.name,
    backend: window.__platform.state.backend,
    bodyClass: document.body.classList.contains('platform-crazygames'),
    onlineButtons: ['btn-online', 'btn-friends'].filter((id) => { const el = document.getElementById(id); return el && el.offsetParent !== null; }),
  }));
  check(s1.name === 'crazygames' && s1.backend === 'ready', `el SDK arranca en modo local (${s1.name}, ${s1.backend})`);
  check(s1.bodyClass, 'body lleva .platform-crazygames');
  check(s1.onlineButtons.length === 0, `sin botones de online (${s1.onlineButtons.join(', ') || 'ninguno'})`);
  check(await waitLog(p1, 'loadingStop', 10_000), 'avisa del final de la carga');
  const l1 = await platformLog(p1);
  check(l1.indexOf('loadingStart') >= 0 && l1.indexOf('loadingStart') < l1.indexOf('loadingStop'), `loadingStart antes que loadingStop (${l1.slice(0, 4).join(' → ')})`);
  await startMatch(p1);
  check(await waitLog(p1, 'gameplayStart', 45_000), 'avisa de gameplayStart al empezar la partida');
  await p1.keyboard.press('Escape');
  check(await waitLog(p1, 'gameplayStop', 5000), 'ESC (pausa) avisa de gameplayStop');
  await sleep(1500); // a real pause; the SDK throttles start/stop under 1 s
  await p1.keyboard.press('Escape');
  await sleep(500);
  const l1b = await platformLog(p1);
  check(l1b.filter((l) => l === 'gameplayStart').length === 2, 'al reanudar, otro gameplayStart');
  check(!l1b.some((l) => l.startsWith('midgame')), 'la pausa no pide anuncio');
  check(log1.requests.some((u) => u.includes('sdk.crazygames.com')), 'carga el SDK de su CDN');
  check(!log1.requests.some((u) => /railway\.app|sentry/.test(u)), 'ninguna petición al servidor online ni a Sentry');
  check(log1.errors.length === 0, `sin errores de página (${log1.errors.slice(0, 2).join(' | ')})`);
  if (log1.sdk.length) console.log(`[smoke-cg] avisos del SDK: ${log1.sdk.join(' | ')}`);

  // --- 2. The break ad, on the dev server in CrazyGames mode ---------------
  console.log('\n[smoke-cg] === 2. el anuncio del descanso (vite --mode crazygames)');
  children.push(await startVite(['--mode', 'crazygames'], PORT));
  const log2 = { errors: [], sdk: [], requests: [], bad: [] };
  const p2 = await newPage(browser, `http://localhost:${PORT}/?muteAudio=true`, log2);
  await p2.waitForFunction(() => window.__platform?.state.backend === 'ready' && window.__game, null, { timeout: 60_000 });
  await startMatch(p2);
  await p2.waitForFunction(() => window.__game.phase === 'playing', null, { timeout: 45_000 });
  await p2.evaluate(() => { window.__platform.state.gameplayMs = 10 * 60_000; window.__game.matchTimer = 0.05; });
  await p2.waitForFunction(() => window.__game.phase === 'ended', null, { timeout: 15_000 });
  check((await platformLog(p2)).at(-1) === 'gameplayStop', 'el final avisa de gameplayStop');
  await p2.keyboard.press('KeyR');
  check(await waitLog(p2, 'midgame requested', 5000), 'R en la pantalla final pide el anuncio');
  await sleep(300);
  await p2.keyboard.press('KeyT'); // must be ignored while the break runs
  const during = await p2.evaluate(() => window.__game.phase);
  check(during === 'ended', `mientras dura el descanso no empieza nada, y T no saca al título (fase ${during})`);
  const finished = await p2.waitForFunction(() => window.__platform.state.log.some((l) => /midgame (finished|error|timeout)/.test(l)), null, { timeout: 60_000 }).then(() => true).catch(() => false);
  check(finished, 'el anuncio termina (o falla) y el SDK contesta');
  await p2.waitForFunction(() => window.__game.phase === 'countdown' || window.__game.phase === 'playing', null, { timeout: 15_000 }).catch(() => {});
  const after = await p2.evaluate(() => ({ phase: window.__game.phase, mute: { ...window.__platform.state.mute } }));
  check(after.phase === 'countdown' || after.phase === 'playing', `después arranca la siguiente partida (${after.phase})`);
  check(!after.mute.ad, 'y el silencio del anuncio se ha soltado');
  const l2 = await platformLog(p2);
  console.log(`[smoke-cg] registro: ${l2.filter((l) => /midgame|mute/.test(l)).join(' → ')}`);
  check(log2.errors.length === 0, `sin errores de página (${log2.errors.slice(0, 2).join(' | ')})`);

  // --- 3. Under a subpath, like CG's game-files URL ------------------------
  console.log('\n[smoke-cg] === 3. el build bajo una subruta');
  if (!(await portFree(PORT + 2))) throw new Error(`el puerto ${PORT + 2} está ocupado`);
  server = await subpathServer(PORT + 2);
  const log3 = { errors: [], sdk: [], requests: [], bad: [] };
  const p3 = await newPage(browser, `http://localhost:${PORT + 2}/game/index.html?muteAudio=true`, log3);
  await p3.waitForFunction(() => window.__platform && window.__platform.state.backend !== 'pending', null, { timeout: 30_000 });
  await startMatch(p3);
  await p3.waitForFunction(() => window.__platform.state.log.some((l) => l.endsWith('gameplayStart')), null, { timeout: 45_000 }).catch(() => {});
  const notFound = log3.bad.filter((b) => b.startsWith('404'));
  check(notFound.length === 0, `sin 404 bajo /game/ (${notFound.slice(0, 4).join(', ')})`);
} catch (e) {
  check(false, String(e?.stack ?? e));
} finally {
  await browser?.close().catch(() => {});
  server?.close();
  for (const c of children) c.kill();
}
if (failures.length) {
  console.error(`\n[smoke-cg] ${failures.length} fallo(s)`);
  process.exit(1);
}
console.log('\n[smoke-cg] todo OK');
process.exit(0);
