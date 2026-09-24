#!/usr/bin/env node
// ---------------------------------------------------------------------------
// net-smoothing-record.mjs — graba una partida ONLINE real para medir el
// suavizado (src/net-smoothing.ts). Superficie CLI de la directiva de doble
// superficie; el análisis lo hace scripts/net-smoothing-bench.mjs.
// ---------------------------------------------------------------------------
//
// Qué hace, por cada bicho de --critters (uno detrás de otro):
//   1. Abre una página MUDA (scripts/lib/headless-browser.mjs; con GPU por
//      defecto) con `?netsmooth=<modo>` y comprueba que el juego lo aplicó.
//   2. Entra en quickmatch con `__game.connectOnlineWith(<bicho>)` (el mismo
//      camino que el confirm del selector online). La sala espera 60 s a
//      que entren humanos y rellena con bots; no hay arranque forzado ni
//      DevApi online, así que cada grabación cuesta ~65 s de espera.
//   3. Ya en 'playing', conduce al bicho con el teclado real (Playwright)
//      por un circuito de rectas, giros de 90° y diagonales. Cada 3 s, un
//      cabezazo (Espacio 150 ms, a 1,2 s) y una PARADA de 350 ms (a 2,65 s),
//      separados para que la parada sea una frenada limpia.
//
// Qué graba (todo en hora de página, performance.now() en ms):
//   · frames[]: por cada frame en que el juego llamó a
//     netSmoother.beginFrame, sus argumentos EXACTOS (hora, matchTimer,
//     playing), el dt del place(), el mando local (noteLocalInput) y, de
//     cada bicho colocado: posición PINTADA (mesh.position x/z/y), la del
//     servidor en ese frame, lo que devolvió place() si difiere de lo
//     pintado, y la proyección a 1080p hecha por three en la página.
//   · patches[]: cada parche de estado con su hora de llegada exacta (la
//     que recibió notePatch), matchTimer, fase y, de cada jugador,
//     x, z, vx, vz, alive, falling, fallY.
//   · inputs[] (lo enviado al servidor), pings[] (room.ping, RTT real),
//     cámara de gameplay, NET_SMOOTHING y FEEL.movement vistos por el
//     juego, y netSmoother.stats() al final.
//   Se graba desde que la sala sale de 'waiting' (cuenta atrás incluida):
//   así el banco arranca la réplica en el mismo estado que el navegador.
//
// Latencia inyectada (--rtt, --jitter): envuelve window.WebSocket EN LA
// PÁGINA (addInitScript) para que cada envío y cada mensaje recibido salga
// rtt/2 ± jitter ms tarde, sin reordenar (FIFO, como TCP). Afecta a los
// pings de Colyseus igual que a los parches: pings[] mide el RTT de verdad.
// No hay proxy que levantar ni cerrar.
//
// Uso (servidor y Vite del mismo checkout, en marcha):
//   # 1) servidor: en Windows `npm run dev` carga server/scripts/precise-timers.mjs
//   #    (sin él la sala va a 0,72×; el log dice "[precise-timers] Windows: ...")
//   cd server && PORT=2567 npm run dev
//   # 2) cliente contra ese servidor
//   VITE_SERVER_URL=ws://localhost:2567 npm run dev -- --port 5173 --strictPort
//   # 3) grabar (LAN y con 80 ms de RTT), un fichero por bicho
//   node scripts/net-smoothing-record.mjs --url=http://localhost:5173 \
//        --critters=Sebastian --seconds=20 --netsmooth=dr --out=.tmp/net-smoothing
//   node scripts/net-smoothing-record.mjs --url=http://localhost:5173 \
//        --critters=Sebastian --seconds=20 --netsmooth=legacy --rtt=80 --out=.tmp/net-smoothing
//   # 4) analizar
//   node scripts/net-smoothing-bench.mjs .tmp/net-smoothing
//
// Flags:
//   --url=URL            página del juego (def. http://localhost:5173/)
//   --critters=A,B,...   una grabación por bicho, en orden (def. Sebastian)
//   --seconds=N          segundos conduciendo (def. 20)
//   --out=DIR|F.json     carpeta de salida (def. .tmp/net-smoothing); un .json
//                        solo vale con un bicho
//   --netsmooth=MODO     dr | legacy | localonly (def. dr) → ?netsmooth=MODO
//   --rtt=MS             RTT extra inyectado (def. 0 = LAN tal cual)
//   --jitter=MS          ± por mensaje sobre rtt/2 (def. 0)
//   --label=TXT          sufijo del fichero
//   --no-gpu             render por software (SwiftShader: fps muy bajos)
//   --headed             ventana visible (sigue muda)
//
// Salida: <out>/<Bicho>-<modo>[-rtt<N>][-j<J>][-<label>].json (≈1 MB por
// 20 s). Una línea JSON final en stdout con los ficheros escritos.
// El headless con GPU va a ~50 fps: las cifras a 60/144 Hz las da el banco
// re-simulando; la fila `nav` del banco es lo que pintó este navegador.
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { launchMutedBrowser, muteGameAudio } from './lib/headless-browser.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ CLI
const opt = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) { console.error(`argumento no reconocido: ${a}`); process.exit(2); }
  opt[m[1]] = m[2] ?? true;
}
if (opt.help || opt.h) {
  // La ayuda es la cabecera de este fichero.
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
const MODES = ['dr', 'legacy', 'localonly'];
const MODE = String(opt.netsmooth ?? 'dr');
if (!MODES.includes(MODE)) { console.error(`--netsmooth debe ser ${MODES.join(' | ')}`); process.exit(2); }
const CRITTERS = String(opt.critters ?? 'Sebastian').split(',').map((s) => s.trim()).filter(Boolean);
const SECONDS = Number(opt.seconds ?? 20);
const RTT = Number(opt.rtt ?? 0);
const JITTER = Number(opt.jitter ?? 0);
const LABEL = opt.label ? String(opt.label) : '';
const OUT = resolve(String(opt.out ?? resolve(REPO, '.tmp/net-smoothing')));
const OUT_IS_FILE = OUT.toLowerCase().endsWith('.json');
if (OUT_IS_FILE && CRITTERS.length !== 1) { console.error('--out=<fichero>.json solo con un bicho'); process.exit(2); }
if (!(SECONDS > 0) || !(RTT >= 0) || !(JITTER >= 0)) { console.error('--seconds > 0, --rtt y --jitter ≥ 0'); process.exit(2); }
const W = 1920, H = 1080; // lienzo de referencia de las métricas en px

const pageUrl = (() => {
  const u = new URL(String(opt.url ?? 'http://localhost:5173/'));
  u.searchParams.set('netsmooth', MODE);
  return u.href;
})();

// Circuito: rectas en ejes, giros de 90° y las dos diagonales, en el centro
// (la isla central no se hunde).
const WAYPOINTS = [
  [-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, -3.5],
  [-3.5, 3.5], [3.5, 3.5], [3.5, -3.5], [-3.5, 3.5],
];
// Ciclo de 3 s: cabezazo a 1,2 s y parada de 2,65 a 3 s. Separados a
// propósito: una parada justo tras la embestida no es una frenada limpia
// (el banco descarta ±500 ms alrededor de cada golpe).
const DRIVE = {
  pollMs: 40,                       // cada cuánto se relee la posición y se ajustan teclas
  cycleMs: 3000,
  stopAtMs: 2650, stopMs: 350,      // parada: se sueltan todas las teclas
  hbAtMs: 1200, hbMs: 150,          // cabezazo: Espacio pulsado
};
const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', hb: 'Space' };

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); } catch { /* sin git */ }

// ------------------------------------------------------ código en la página
// Latencia artificial (técnica del banco de predicción): WebSocket envuelto.
function installLag({ oneway, jitter }) {
  const Native = window.WebSocket;
  const delay = () => oneway + (Math.random() * 2 - 1) * jitter;
  // Un carril FIFO por sentido. Con un setTimeout que entrega SU mensaje,
  // dos que vencen casi a la vez pueden salir cambiados (el temporizador
  // redondea al ms: medido con --jitter, un parche llegó antes que el
  // anterior) y un parche fuera de orden rompe el estado de Colyseus. Aquí
  // cada temporizador solo despierta a la cola, que entrega en orden. Uno
  // por mensaje, armado desde el evento: re-armar desde el propio
  // temporizador anidaría y el navegador lo retrasaría a ≥ 4 ms.
  const lane = (run) => {
    const q = [];
    let lastDue = 0;
    const pump = () => {
      while (q.length && q[0].due <= performance.now() + 0.5) run(q.shift().item);
      if (q.length && !q[0].rearmed) { q[0].rearmed = true; setTimeout(pump, Math.max(0, q[0].due - performance.now())); }
    };
    return (item) => {
      const due = Math.max(lastDue, performance.now() + delay());
      lastDue = due;
      q.push({ due, item, rearmed: false });
      setTimeout(pump, Math.max(0, due - performance.now()));
    };
  };
  class LagWS extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      const inbound = [];
      const up = lane((data) => { if (this.readyState === 1) Native.prototype.send.call(this, data); });
      this.__up = (raw) => {
        // El SDK reutiliza su buffer de codificación: copiar YA, o saldrían
        // bytes pisados (el servidor cierra con 4002).
        up(ArrayBuffer.isView(raw) ? raw.slice() : (raw instanceof ArrayBuffer ? raw.slice(0) : raw));
      };
      const down = lane((ev) => {
        const clone = new MessageEvent('message', { data: ev.data, origin: ev.origin });
        for (const fn of inbound) fn.call(this, clone);
        if (this.__onmessage) this.__onmessage.call(this, clone);
      });
      Native.prototype.addEventListener.call(this, 'message', down);
      this.__inbound = inbound;
    }
    send(data) { this.__up(data); }
    set onmessage(fn) { this.__onmessage = fn; }
    get onmessage() { return this.__onmessage ?? null; }
    addEventListener(type, fn, opts) {
      if (type === 'message') { this.__inbound.push(fn); return; }
      return super.addEventListener(type, fn, opts);
    }
  }
  window.WebSocket = LagWS;
}

// Instrumentación: envuelve métodos de la INSTANCIA (no toca el módulo).
function installProbe() {
  const g = window.__game;
  const sm = g && g.netSmoother;
  if (!sm || typeof sm.place !== 'function') return 'no hay __game.netSmoother (build sin suavizado online)';
  const proto = Object.getPrototypeOf(sm);
  const T = (window.__nsr = {
    log: false, done: false, frames: [], patches: [], inputs: [], pings: [], rtts: [],
    idx: new Map(), players: [], bf: null, inp: null, dt: null, placed: new Map(),
    np: null, refCam: null, camera: null, hooked: false,
    window: { playingT: null, driveT0: null, driveT1: null },
    configStart: null, movement: null,
  });
  const pIndex = (sid, p, room) => {
    let i = T.idx.get(sid);
    if (i === undefined) {
      i = T.players.length;
      T.idx.set(sid, i);
      T.players.push({ sid, name: p?.critterName ?? '', local: sid === room.sessionId, bot: !!p?.isBot });
    }
    return i;
  };
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const b = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : null);

  sm.notePatch = function (arrivalMs, matchTimer, phase) {
    // La llamada del oyente del juego lleva fase; la interna de beginFrame no.
    if (arguments.length >= 3) T.np = arrivalMs;
    return proto.notePatch.apply(this, arguments);
  };
  sm.beginFrame = function (nowMs, matchTimer, playing) {
    T.bf = { t: nowMs, mt: matchTimer, pl: playing ? 1 : 0 };
    return proto.beginFrame.apply(this, arguments);
  };
  sm.noteLocalInput = function (mx, mz, tMs) {
    // [mx, mz, hora]: la hora es la que el juego pasa (performance.now()).
    T.inp = [mx, mz, typeof tMs === 'number' ? tMs : performance.now()];
    return proto.noteLocalInput.apply(this, arguments);
  };
  if (typeof proto.noteRtt === 'function') {
    // El RTT que mide el propio juego (maybePing → room.ping): el banco lo
    // repite tal cual para frenar al local con el mando de hace un RTT.
    sm.noteRtt = function (ms) {
      T.rtts.push({ t: performance.now(), ms });
      return proto.noteRtt.apply(this, arguments);
    };
  }
  sm.place = function (key, p, isLocal, dt) {
    const r = proto.place.apply(this, arguments);
    T.placed.set(key, r);
    if (T.dt === null) T.dt = dt;
    return r;
  };

  const camSnap = () => {
    let cam = null;
    g.scene.traverse((o) => { if (!cam && o.isPerspectiveCamera) cam = o; });
    if (!cam) return;
    const ref = cam.clone();
    ref.aspect = 1920 / 1080;
    ref.updateProjectionMatrix();
    ref.updateMatrixWorld(true);
    T.refCam = ref;
    const V = cam.position.constructor;
    const fwd = new V(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new V(0, 1, 0).applyQuaternion(cam.quaternion);
    T.camera = { pos: cam.position.toArray(), fwd: fwd.toArray(), up: up.toArray(), fov: cam.fov, W: 1920, H: 1080 };
  };
  const project = (x, z) => {
    const v = T.refCam.position.clone().set(x, 0, z).project(T.refCam);
    return [((v.x + 1) / 2) * 1920, ((1 - v.y) / 2) * 1080];
  };

  const orig = g.update.bind(g);
  g.update = function (dt) {
    T.bf = null; T.inp = null; T.dt = null; T.placed.clear();
    orig(dt);
    const room = g.room;
    const st = room && room.state;
    if (!st || !st.players || typeof st.players.forEach !== 'function') return;
    if (!T.log && !T.done && st.phase && st.phase !== 'waiting') T.log = true;
    if (!T.log || !T.bf) return;
    if (st.phase === 'playing' && T.window.playingT === null) { T.window.playingT = T.bf.t; camSnap(); }
    const e = [];
    g.onlineCritters.forEach((c, sid) => {
      const r = T.placed.get(c);
      if (!r) return;
      const p = st.players.get(sid);
      const m = c.mesh.position;
      const row = { i: pIndex(sid, p, room), rx: m.x, rz: m.z, ry: m.y, sx: n(p?.x), sz: n(p?.z) };
      if (Math.abs(r.x - m.x) > 1e-9 || Math.abs(r.z - m.z) > 1e-9 || Math.abs(r.y - m.y) > 1e-9) row.q = [r.x, r.z, r.y];
      if (T.refCam) { const [px, py] = project(m.x, m.z); row.px = px; row.py = py; }
      e.push(row);
    });
    T.frames.push({ t: T.bf.t, dt: T.dt ?? dt, mt: n(T.bf.mt), pl: T.bf.pl, inp: T.inp, e });
  };

  T.hookRoom = () => {
    const room = g.room;
    if (!room) return false;
    if (T.hooked) return true;
    T.hooked = true;
    room.onStateChange((st) => {
      const t = T.np ?? performance.now();
      T.np = null;
      if (!T.log && !T.done && st.phase && st.phase !== 'waiting') T.log = true;
      if (!T.log) return;
      const pl = [];
      st.players.forEach((p, sid) => {
        pl.push([pIndex(sid, p, room), n(p.x), n(p.z), n(p.vx), n(p.vz), b(p.alive), b(p.falling), n(p.fallY)]);
      });
      T.patches.push({ t, mt: n(st.matchTimer), ph: st.phase, p: pl });
    });
    const origSend = room.send.bind(room);
    room.send = (type, msg) => {
      if (type === 'input' && T.log && msg) T.inputs.push({ t: performance.now(), mx: msg.moveX, mz: msg.moveZ, hb: msg.headbutt ? 1 : 0 });
      return origSend(type, msg);
    };
    return true;
  };
  T.startPings = () => {
    const room = g.room;
    T.pingTimer = setInterval(() => {
      const t0 = performance.now();
      // El SDK redondea su medida al ms (en LAN da 0): se cronometra aquí.
      try { room.ping(() => T.pings.push({ t: t0, ms: performance.now() - t0 })); } catch { /* socket cerrado */ }
    }, 500);
  };
  T.finish = () => {
    T.log = false; T.done = true;
    clearInterval(T.pingTimer);
    let gl = 'unknown';
    try {
      const c = document.querySelector('canvas');
      const ctx = c.getContext('webgl2') || c.getContext('webgl');
      const ext = ctx && ctx.getExtension('WEBGL_debug_renderer_info');
      gl = ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    } catch { /* sin contexto */ }
    return {
      frames: T.frames, patches: T.patches, inputs: T.inputs, pings: T.pings, rtts: T.rtts,
      players: T.players, window: T.window, camera: T.camera,
      configStart: T.configStart, configEnd: { ...sm.config }, movement: sm.movement(),
      stats: sm.stats(), sessionId: g.room?.sessionId ?? null, gl, ua: navigator.userAgent,
    };
  };
  T.configStart = { ...sm.config };
  return null;
}

// ------------------------------------------------------ conducción
async function drive(page, seconds) {
  const held = new Set();
  const setKeys = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  let wp = 0, laps = 0, stops = 0, headbutts = 0, wasStop = false, wasHb = false;
  const tStart = Date.now();
  const tEnd = tStart + seconds * 1000;
  while (Date.now() < tEnd) {
    const pos = await page.evaluate(() => {
      const g = window.__game;
      const p = g.room?.state?.players?.get(g.room.sessionId);
      return p ? { x: p.x, z: p.z, alive: p.alive, falling: p.falling } : null;
    });
    const want = new Set();
    if (pos && pos.alive && !pos.falling) {
      const [tx, tz] = WAYPOINTS[wp];
      if (Math.hypot(tx - pos.x, tz - pos.z) < 0.6) {
        wp = (wp + 1) % WAYPOINTS.length;
        if (wp === 0) laps++;
      }
      const [ux, uz] = WAYPOINTS[wp];
      const ex = ux - pos.x, ez = uz - pos.z;
      // 8 direcciones; el eje secundario solo si pesa > 40 % del principal
      // (así las rectas salen rectas).
      const ax = Math.abs(ex), az = Math.abs(ez);
      if (ax > 0.25 && ax >= 0.4 * az) want.add(ex > 0 ? KEYS.right : KEYS.left);
      if (az > 0.25 && az >= 0.4 * ax) want.add(ez > 0 ? KEYS.down : KEYS.up);
      const ms = (Date.now() - tStart) % DRIVE.cycleMs;
      const stop = ms >= DRIVE.stopAtMs && ms < DRIVE.stopAtMs + DRIVE.stopMs;
      const hb = ms >= DRIVE.hbAtMs && ms < DRIVE.hbAtMs + DRIVE.hbMs;
      if (stop) want.clear();
      if (hb) want.add(KEYS.hb);
      if (stop && !wasStop) stops++;
      if (hb && !wasHb) headbutts++;
      wasStop = stop; wasHb = hb;
    }
    await setKeys(want);
    await page.waitForTimeout(DRIVE.pollMs);
  }
  await setKeys(new Set());
  return { laps, lastWaypoint: wp, stops, headbutts, ...DRIVE };
}

// ------------------------------------------------------ una grabación
async function recordOne(browser, critter) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await muteGameAudio(context);
  if (RTT > 0 || JITTER > 0) await context.addInitScript(installLag, { oneway: RTT / 2, jitter: JITTER });
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`  [pageerror] ${e.message}`));
  try {
    log(`${critter}: cargando ${pageUrl}${RTT || JITTER ? ` (RTT +${RTT} ± ${JITTER} ms inyectado)` : ''}`);
    await page.goto(pageUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game && window.__game.phase === 'title', null, { timeout: 60000 });
    const err = await page.evaluate(installProbe);
    if (err) throw new Error(err);
    const cfg = await page.evaluate(() => ({ ...window.__game.netSmoother.config }));
    const wantMode = MODE === 'legacy' ? 'legacy' : 'dr';
    const wantRemotes = MODE !== 'localonly';
    if (cfg.mode !== wantMode || (wantMode === 'dr' && cfg.remotes !== wantRemotes)) {
      throw new Error(`la página no aplicó ?netsmooth=${MODE}: config ${JSON.stringify(cfg)}`);
    }
    log(`${critter}: modo ${MODE} confirmado en la página; conectando (quickmatch)`);
    await page.evaluate((name) => { window.__game.connectOnlineWith(name); }, critter);
    await page.waitForFunction(() => window.__nsr.hookRoom(), null, { timeout: 30000, polling: 100 });
    log(`${critter}: en sala; esperando 'playing' (60 s de sala de espera + cuenta atrás)`);
    await page.waitForFunction(() => window.__game.room?.state?.phase === 'playing', null, { timeout: 180000, polling: 250 });
    // Que caiga el overlay "Preparing arena" y aparezcan todos los bichos.
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__nsr.startPings(); window.__nsr.window.driveT0 = performance.now(); });
    log(`${critter}: conduciendo ${SECONDS} s (cada ${DRIVE.cycleMs / 1000} s: cabezazo y parada de ${DRIVE.stopMs} ms)`);
    const driveInfo = await drive(page, SECONDS);
    await page.evaluate(() => { window.__nsr.window.driveT1 = performance.now(); });
    await page.waitForTimeout(300); // que se vea la última frenada
    const data = await page.evaluate(() => window.__nsr.finish());
    const localIndex = data.players.findIndex((p) => p.local);
    const rec = {
      tool: 'net-smoothing-record', version: 1,
      createdAt: new Date().toISOString(), commit,
      url: pageUrl, critter, netsmooth: MODE, rttMs: RTT, jitterMs: JITTER, seconds: SECONDS,
      gpu: !opt['no-gpu'], viewport: { w: W, h: H },
      localIndex, drive: driveInfo, ...data,
    };
    const name = `${critter}-${MODE}${RTT ? `-rtt${RTT}` : ''}${JITTER ? `-j${JITTER}` : ''}${LABEL ? `-${LABEL}` : ''}.json`;
    const file = OUT_IS_FILE ? OUT : resolve(OUT, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(rec));
    const pings = data.pings.map((p) => p.ms).sort((a, b) => a - b);
    const fps = data.frames.length > 1 ? (1000 * (data.frames.length - 1)) / (data.frames.at(-1).t - data.frames[0].t) : NaN;
    log(`${critter}: ${data.frames.length} frames (${fps.toFixed(1)} fps), ${data.patches.length} parches, ` +
      `${data.players.length} bichos, ping p50 ${pings.length ? pings[pings.length >> 1].toFixed(1) : '?'} ms, ` +
      `${driveInfo.stops} paradas, ${driveInfo.headbutts} cabezazos → ${file}`);
    return file;
  } finally {
    await context.close();
  }
}

// ------------------------------------------------------ main
const gpu = opt['no-gpu'] ? {} : { channel: 'chromium', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] };
const browser = await launchMutedBrowser({ ...gpu, headless: !opt.headed });
const files = [];
let failed = false;
try {
  for (const c of CRITTERS) {
    try { files.push(await recordOne(browser, c)); } catch (e) { failed = true; log(`${c}: ERROR ${e.message}`); }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ files }));
process.exit(failed ? 1 : 0);
