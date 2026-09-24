#!/usr/bin/env node
// ---------------------------------------------------------------------------
// net-smoothing-bench.mjs — banco de réplica del suavizado online
// ---------------------------------------------------------------------------
//
// Re-simula grabaciones de scripts/net-smoothing-record.mjs con el módulo
// REAL src/net-smoothing.ts (importado tal cual, sin bundler) a cualquier
// tasa de refresco y compara los tres modos del A/B:
//   dr        predicción + corrección para todos (lo de ahora)
//   legacy    lo de antes: snap local, lerp remoto
//   localonly dr para el local, lerp legacy para los rivales
// Con --set clave=valor toca NET_SMOOTHING (correctionTime, snapDistance,
// ...) sin tocar el juego: es la superficie CLI del tuning.
//
// Cómo re-simula: un NetSmoother como el del juego, alimentado con los
// parches grabados a su hora de llegada (notePatch), el mando local grabado
// (noteLocalInput) y FEEL.movement tal como lo vio la página; una llamada a
// beginFrame por frame y place() por bicho. Las tasas sintéticas (60, 144)
// ponen frames equiespaciados sobre la misma red; `rec` usa los tiempos de
// frame del navegador. La fila `nav` es lo que pintó el navegador.
//
// Métricas (px en un lienzo de 1920×1080 con la cámara de gameplay grabada:
// en el centro ≈ 43,8 px/u en x y 30,3 px/u en z). "Verdad" = la trayectoria
// del servidor por hora de SIMULACIÓN (matchTimer), llevada a hora de
// cliente con el percentil 5 de (llegada − hora de simulación): ≈ el estado
// más fresco posible, sin que un parche suelto adelantado la mueva. Con RTT
// inyectado, τ* y err0 NO incluyen la latencia de ida (desde el cliente no
// se puede medir): son el retraso sobre lo mejor que se puede saber.
// Solo cuentan frames con el bicho vivo, sin caer, lejos (−150/+500 ms) de
// saltos de > 1 u entre dos estados (embestidas, knockback, blink,
// reaparición) y dentro de la ventana de conducción:
//   parado%    frames sin moverse con la verdad en marcha (> 0,5 u/s en
//              ±50 ms, con el retraso τ* del propio bicho)
//   salto      desplazamiento por frame en crucero (la verdad a su velocidad
//              típica ±20 % en los 200 ms previos y los 150 siguientes),
//              p50/p95/máx
//   tirón      |Δ desplazamiento| entre frames seguidos en crucero, p95
//              (entre paréntesis, el de la propia verdad a esa tasa)
//   ratio      desplazamiento / el de la verdad en ese frame, p5/p50/p95
//   τ*         retraso frente a la trayectoria del servidor (mejor ajuste)
//   err0       distancia a la verdad en el mismo instante, p95
//   pasada     cuánto se pasa del punto donde el servidor se paró, medido a
//              lo largo de la marcha (paradas de la verdad: de ≥ 3 u/s a
//              quieto), p99/máx; `atrás` = retroceso máximo; tirón p95 de
//              −300 ms hasta que vuelve a arrancar. Separadas en FRENADAS
//              (de media velocidad a quieto en ≥ 80 ms: soltar el mando) y
//              EN SECO (en un parche: choque, empujón), que ninguna
//              predicción puede ver venir
//   al soltar el mando (solo el local): en los 400 ms tras soltar, frames
//              en que el bicho pintado re-acelera > 20 % (tras soltar solo
//              puede frenar); con RTT delata una frenada predicha antes de
//              que llegue en el estado. p50/máx por suelta (y la verdad)
//   coherencia rivales frente a la verdad en el instante en que se ve al
//              local (τ* del local): cuánto "mienten" en un contacto, p50/p95
//   réplica    módulo re-simulado a los tiempos de frame grabados con la
//              config grabada frente a lo que pintó el navegador (u): tiene
//              que dar p99 ≤ 0,1 u o las cifras del banco no valen
// Al final de cada grabación, los umbrales del plan para el modo dr.
//
// Uso:
//   node scripts/net-smoothing-bench.mjs <grabaciones.json | carpetas> [flags]
//   (se relanza solo con --experimental-transform-types, por si el módulo
//    gana algún día sintaxis que el type stripping por defecto de Node 22 no
//    admite; equivale a `node --experimental-transform-types scripts/...`)
//
// Ejemplo completo (servidor, cliente y grabaciones: ver la cabecera de
// scripts/net-smoothing-record.mjs):
//   node scripts/net-smoothing-bench.mjs .tmp/net-smoothing --rates=60,144
//   node scripts/net-smoothing-bench.mjs .tmp/net-smoothing/Sebastian-dr.json \
//        --set correctionTime=0.045 --set snapDistance=4 --json=.tmp/bench.json
//
// Flags:
//   --rates=60,144      tasas a re-simular; `rec` = tiempos del navegador
//   --modes=dr,legacy,localonly
//   --set clave=valor   (repetible, o --set=a=1,b=2) sobre NET_SMOOTHING;
//                       mode/remotes van por --modes
//   --window=drive      drive (def.) = mientras el grabador conducía;
//                       playing = toda la partida grabada
//   --phase=F           desfase de los frames sintéticos, fracción de frame
//   --local-input=off   las réplicas no pasan el mando local a noteLocalInput
//                       (el local frena con la regla de los rivales): what-if
//   --json=RUTA         resultados completos en JSON
//   --quiet             solo la tabla de umbrales
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SELF = fileURLToPath(import.meta.url);
const TS_FLAG = '--experimental-transform-types';
if (process.features?.typescript !== 'transform' && !process.execArgv.includes(TS_FLAG)) {
  if (process.env.NET_SMOOTHING_BENCH_CHILD) {
    console.error(`Este Node no carga .ts con ${TS_FLAG} (hace falta Node ≥ 22.7).`);
    process.exit(2);
  }
  const r = spawnSync(process.execPath,
    [...process.execArgv, TS_FLAG, '--disable-warning=ExperimentalWarning', SELF, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NET_SMOOTHING_BENCH_CHILD: '1' } });
  process.exit(r.status ?? 1);
}
const { NetSmoother, NET_SMOOTHING } = await import(pathToFileURL(resolve(dirname(SELF), '../src/net-smoothing.ts')).href);

// ------------------------------------------------------------------ CLI
const opt = { set: [] };
const inputs = [];
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) { inputs.push(a); continue; }
  if (m[1] === 'set') { if (m[2] !== undefined) opt.set.push(...m[2].split(',')); else opt.set.push(null); continue; }
  opt[m[1]] = m[2] ?? true;
}
// `--set clave=valor` (separado por espacio): el valor es el siguiente argumento.
for (let i = 0; i < opt.set.length; i++) {
  if (opt.set[i] === null) {
    const j = inputs.findIndex((x) => /^[A-Za-z]\w*=/.test(x));
    if (j < 0) { console.error('--set sin clave=valor'); process.exit(2); }
    opt.set[i] = inputs.splice(j, 1)[0];
  }
}
if (opt.help || !inputs.length) {
  // La ayuda es la cabecera de este fichero.
  const lines = readFileSync(SELF, 'utf8').split('\n').slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(opt.help ? 0 : 2);
}
const RATES = String(opt.rates ?? '60,144').split(',').map((s) => (s === 'rec' ? 'rec' : Number(s)));
if (RATES.some((r) => r !== 'rec' && !(r > 0))) { console.error('--rates: números > 0 o rec'); process.exit(2); }
const ALL_MODES = ['dr', 'legacy', 'localonly'];
const MODES = String(opt.modes ?? ALL_MODES.join(',')).split(',');
if (MODES.some((m) => !ALL_MODES.includes(m))) { console.error(`--modes: ${ALL_MODES.join(', ')}`); process.exit(2); }
const WINDOW = String(opt.window ?? 'drive');
if (!['drive', 'playing'].includes(WINDOW)) { console.error('--window=drive|playing'); process.exit(2); }
const PHASE = Number(opt.phase ?? 0);
// --local-input=off: las réplicas no le cuentan al suavizado el mando local
// (noteLocalInput), así que el local frena con la regla de los rivales.
// Para medir alternativas sin tocar el juego; la réplica de validación no
// se ve afectada.
const LOCAL_INPUT = String(opt['local-input'] ?? 'on') !== 'off';

const overrides = {};
for (const kv of opt.set) {
  const [k, ...rest] = kv.split('=');
  const raw = rest.join('=');
  if (!(k in NET_SMOOTHING)) { console.error(`--set ${k}: no existe. Claves: ${Object.keys(NET_SMOOTHING).join(', ')}`); process.exit(2); }
  if (k === 'mode' || k === 'remotes') { console.error(`--set ${k}: el modo se elige con --modes=${ALL_MODES.join(',')}`); process.exit(2); }
  const v = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
  if (typeof v === 'number' && !Number.isFinite(v)) { console.error(`--set ${k}=${raw}: no es un número`); process.exit(2); }
  overrides[k] = v;
}
const modeConfig = (mode, base) => ({
  ...base,
  mode: mode === 'legacy' ? 'legacy' : 'dr',
  remotes: mode !== 'localonly',
});
const BASE_CFG = { ...NET_SMOOTHING, ...overrides };

// ------------------------------------------------------------ utilidades
const q = (a, p) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const maxOf = (a) => (a.length ? a.reduce((m, v) => (v > m ? v : m), -Infinity) : NaN);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);
const st = (a) => ({ n: a.length, p50: r2(q(a, 0.5)), p95: r2(q(a, 0.95)), p99: r2(q(a, 0.99)), max: r2(maxOf(a)) });
const fmt = (x) => (Number.isFinite(x) ? String(x) : '–');
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Proyección a 1920×1080 con la cámara grabada (sin ella, la de
 *  src/camera.ts: posición (0,23,25), mira a (0,−3,0), fov 40). */
function makeProjector(cam) {
  const pos = cam?.pos ?? [0, 23, 25];
  const fov = cam?.fov ?? 40;
  const W = cam?.W ?? 1920, H = cam?.H ?? 1080;
  let f, u;
  if (cam?.fwd && cam?.up) { f = norm3(cam.fwd); u = norm3(cam.up); } else {
    f = norm3(sub3([0, -3, 0], pos));
    u = cross3(norm3(cross3(f, [0, 1, 0])), f);
  }
  const r = norm3(cross3(f, u));
  const t = Math.tan((fov * Math.PI) / 360);
  const aspect = W / H;
  return (x, z) => {
    const d = [x - pos[0], -pos[1], z - pos[2]];
    const zc = dot3(d, f);
    return [((dot3(d, r) / (zc * t * aspect) + 1) / 2) * W, ((1 - dot3(d, u) / (zc * t)) / 2) * H];
  };
}

// ------------------------------------------------------------ carga
function collectFiles(args) {
  const out = [];
  for (const a of args) {
    const p = resolve(a);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f.toLowerCase().endsWith('.json')) out.push({ path: join(p, f), fromDir: true });
    } else out.push({ path: p, fromDir: false });
  }
  return out;
}

function loadRecording(path) {
  const d = JSON.parse(readFileSync(path, 'utf8'));
  if (d.tool !== 'net-smoothing-record') return null;
  const u = (v) => (v === null || v === undefined ? undefined : v);
  const bo = (v) => (v === null || v === undefined ? undefined : !!v);
  const patches = d.patches.map((p) => ({
    t: p.t, mt: p.mt ?? undefined, ph: p.ph,
    pl: new Map(p.p.map((r) => [r[0], { x: u(r[1]), z: u(r[2]), vx: u(r[3]), vz: u(r[4]), alive: bo(r[5]), falling: bo(r[6]), fallY: u(r[7]) }])),
  }));
  if (!d.movement) throw new Error(`${basename(path)}: falta movement (grabación incompleta)`);
  const frames = d.frames;
  const playingT = d.window?.playingT ?? patches.find((p) => p.ph === 'playing')?.t;
  const lastT = patches.length ? patches[patches.length - 1].t : 0;
  const win = WINDOW === 'drive' && d.window?.driveT0
    ? [d.window.driveT0, (d.window.driveT1 ?? lastT) + 300]
    : [(playingT ?? 0) + 500, lastT];
  return { d, file: basename(path), patches, frames, players: d.players, localIndex: d.localIndex, movement: d.movement, win, playingT };
}

// ------------------------------------------------------------ réplica
/**
 * Corre un NetSmoother sobre la grabación. `sched` = [{t, dt, rec?}] con
 * `rec` = el frame grabado (réplica exacta: sus argumentos de beginFrame,
 * su mando y solo los bichos que colocó el juego). Devuelve, por bicho, la
 * posición colocada en cada frame (o null).
 */
function replay(R, cfg, sched, localInput = LOCAL_INPUT) {
  // fallSpeed: las grabaciones anteriores al 2026-09-24 guardaban solo
  // FEEL.movement.
  const sm = new NetSmoother(() => ({ fallSpeed: 12, ...R.movement }), cfg);
  const keys = R.players.map(() => ({}));
  const out = R.players.map(() => new Array(sched.length).fill(null));
  // Mando local como escalón en el tiempo (tasas sintéticas).
  const inpT = [], inpV = [];
  for (const f of R.frames) { inpT.push(f.t); inpV.push(f.inp); }
  let ii = -1;
  // RTT: el que midió el juego (noteRtt grabado) o, en grabaciones viejas,
  // los pings del grabador a su hora de respuesta.
  const rtts = (R.d.rtts?.length ? R.d.rtts : (R.d.pings ?? []).map((p) => ({ t: p.t + p.ms, ms: p.ms })))
    .slice().sort((a, b) => a.t - b.t);
  let ri = 0;
  let k = 0, cur = null, misaligned = 0;
  for (let n = 0; n < sched.length; n++) {
    const fr = sched[n];
    while (k < R.patches.length && R.patches[k].t <= fr.t) {
      cur = R.patches[k++];
      sm.notePatch(cur.t, cur.mt, cur.ph);
    }
    while (ri < rtts.length && rtts[ri].t <= fr.t) sm.noteRtt?.(rtts[ri++].ms);
    if (!cur) continue;
    const rec = fr.rec;
    let inp = null;
    if (rec) inp = rec.inp;
    else {
      while (ii + 1 < inpT.length && inpT[ii + 1] <= fr.t) ii++;
      inp = ii >= 0 && cur.ph === 'playing' ? inpV[ii] : null;
    }
    // Hora del mando: la grabada (grabaciones nuevas) o la del frame.
    if (inp && (rec || localInput)) sm.noteLocalInput(inp[0], inp[1], rec ? (inp[2] ?? rec.t) : fr.t);
    if (rec) {
      if (rec.mt !== null && cur.mt !== rec.mt) misaligned++;
      sm.beginFrame(rec.t, rec.mt ?? undefined, !!rec.pl);
      for (const e of rec.e) {
        const s = cur.pl.get(e.i);
        if (s) out[e.i][n] = { ...sm.place(keys[e.i], s, e.i === R.localIndex, rec.dt) };
      }
    } else {
      sm.beginFrame(fr.t, cur.mt, cur.ph === 'playing');
      for (const [i, s] of cur.pl) out[i][n] = { ...sm.place(keys[i], s, i === R.localIndex, fr.dt) };
    }
  }
  return { out, misaligned, stats: sm.stats() };
}

function schedule(R, rate) {
  if (rate === 'rec') return R.frames.map((f) => ({ t: f.t, dt: f.dt }));
  const t0 = R.patches[0].t + (PHASE * 1000) / rate, t1 = R.patches[R.patches.length - 1].t;
  const s = [];
  for (let t = t0; t < t1; t += 1000 / rate) s.push({ t, dt: 1 / rate });
  return s;
}

// ------------------------------------------------------------ verdad
function buildTruth(R, i) {
  const pts = [];
  for (const p of R.patches) {
    if (p.ph !== 'playing' || typeof p.mt !== 'number') continue;
    const s = p.pl.get(i);
    if (!s || typeof s.x !== 'number' || typeof s.z !== 'number') continue;
    const ts = -p.mt * 1000;
    if (pts.length && ts <= pts[pts.length - 1].ts + 1e-6) continue;
    pts.push({ ts, x: s.x, z: s.z, ok: s.alive !== false && !s.falling, tArr: p.t });
  }
  return pts;
}
function sampleTruth(pts, ts) {
  if (pts.length < 2 || ts < pts[0].ts || ts > pts[pts.length - 1].ts) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].ts <= ts) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi];
  const jump = Math.hypot(b.x - a.x, b.z - a.z) > 1.0;
  if (jump) return { x: a.x, z: a.z, ok: false, jump };
  const u = b.ts > a.ts ? (ts - a.ts) / (b.ts - a.ts) : 0;
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, ok: a.ok && b.ok, jump: false };
}

/** Todo lo que se mide de un bicho y que no depende del modo. */
function prepareEntity(R, i, off, proj) {
  const truth = buildTruth(R, i);
  if (truth.length < 10) return null;
  const bad = [];
  for (let j = 1; j < truth.length; j++) {
    const a = truth[j - 1], b = truth[j];
    if (Math.hypot(b.x - a.x, b.z - a.z) > 1.0 || !b.ok) bad.push(b.ts);
  }
  const nearBad = (ts) => bad.some((e) => ts > e - 150 && ts < e + 500);
  // Velocidad media de la verdad en [tc − back, tc + fwd] (ms, hora cliente).
  const speedAt = (tc, back = 200, fwd = 0) => {
    const a = sampleTruth(truth, tc - off + fwd), b = sampleTruth(truth, tc - off - back);
    if (!a || !b || a.jump || b.jump) return NaN;
    return Math.hypot(a.x - b.x, a.z - b.z) / ((back + fwd) / 1000);
  };
  const speeds = [];
  for (let j = 6; j < truth.length; j++) {
    const a = truth[j], b = truth[j - 6];
    const dd = Math.hypot(a.x - b.x, a.z - b.z);
    if (dd > 1.5 || !a.ok || !b.ok) continue;
    const v = dd / ((a.ts - b.ts) / 1000);
    if (v > 0.5) speeds.push(v);
  }
  // Velocidad de crucero = la MODA (la velocidad con más muestras a ±5 %),
  // no la mediana: con arranques, frenadas y empujones la mediana cae por
  // debajo del crucero real y la banda de ±20 % lo dejaría fuera.
  const sp = Float64Array.from(speeds).sort();
  let cruise = NaN, best = 0;
  for (let a = 0, b = 0, c = 0; c < sp.length; c++) {
    while (sp[a] < sp[c] * 0.95) a++;
    while (b < sp.length && sp[b] <= sp[c] * 1.05) b++;
    if (b - a > best) { best = b - a; cruise = sp[(a + b - 1) >> 1]; }
  }
  // Paradas de la verdad: de ≥ 3 u/s (en los 300 ms previos) a quieto.
  const stops = [];
  const segV = (j) => Math.hypot(truth[j].x - truth[j - 1].x, truth[j].z - truth[j - 1].z) / ((truth[j].ts - truth[j - 1].ts) / 1000);
  for (let j = 2; j < truth.length; j++) {
    if (!(segV(j) < 0.05) || !(segV(j - 1) >= 0.05)) continue;
    const S = truth[j - 1];
    if (!S.ok || nearBad(S.ts)) continue;
    let peak = 0, jp = -1;
    for (let m = j - 1; m >= 1 && truth[m].ts >= S.ts - 300; m--) { const v = segV(m); if (v > peak) { peak = v; jp = m; } }
    if (peak < 3 || jp < 0) continue;
    // Frenada (soltar el mando: fricción de parada, ~120 ms de la mitad de
    // la velocidad a quieto) o parada en seco (choque, empujón: en un solo
    // parche), que ninguna predicción puede anticipar.
    let tHi = truth[jp].ts;
    for (let m = j - 1; m >= jp; m--) if (segV(m) >= 0.5 * peak) { tHi = truth[m].ts; break; }
    const kind = S.ts - tHi >= 80 ? 'brake' : 'abrupt';
    let restart = S.ts + 600;
    for (let m = j + 1; m < truth.length && truth[m].ts < S.ts + 600; m++) if (segV(m) > 0.3) { restart = truth[m - 1].ts; break; }
    const P0 = truth[jp - 1];
    const [sx, sy] = proj(S.x, S.z), [ax, ay] = proj(P0.x, P0.z);
    const L = Math.hypot(sx - ax, sy - ay);
    if (L < 1) continue;
    stops.push({ ts: S.ts, restart, S: [sx, sy], u: [(sx - ax) / L, (sy - ay) / L], peak, kind });
  }
  return { i, truth, nearBad, speedAt, cruise, stops };
}

// ------------------------------------------------------------ métricas
function metrics(E, render, times, off, proj, win, releases = null) {
  const { truth, nearBad, speedAt, cruise } = E;
  const okFrame = (n) => {
    const b = render[n], a = render[n - 1];
    if (!a || !b) return false;
    const t = times[n];
    if (t < win[0] || t > win[1]) return false;
    const P = sampleTruth(truth, t - off), P2 = sampleTruth(truth, t - off - 250), P3 = sampleTruth(truth, t - off + 150);
    if (!P || !P2 || !P3 || P.jump || P2.jump || P3.jump || !P.ok || !P2.ok) return false;
    return !nearBad(t - off);
  };
  const moving = [], cru = [];
  for (let n = 2; n < render.length; n++) {
    if (!okFrame(n) || !okFrame(n - 1)) continue;
    const v = speedAt(times[n]);
    if (!(v > 0.5)) continue;
    moving.push(n);
    // Crucero = velocidad típica ±20 % en los 200 ms previos Y en los 150
    // siguientes (sin eso entran los primeros frames de cada frenada).
    const vf = speedAt(times[n], 0, 150);
    if (Math.abs(v - cruise) <= 0.2 * cruise && Math.abs(vf - cruise) <= 0.2 * cruise) cru.push(n);
  }
  let best = { tau: NaN, err: Infinity };
  for (let tau = -40; tau <= 250; tau++) {
    let s = 0, c = 0;
    for (const n of cru) {
      const P = sampleTruth(truth, times[n] - off - tau);
      if (!P || P.jump) continue;
      s += (render[n].x - P.x) ** 2 + (render[n].z - P.z) ** 2; c++;
    }
    if (c && s / c < best.err) best = { tau, err: s / c };
  }
  const tau = Number.isFinite(best.tau) ? best.tau : 0;
  const collect = (idx) => {
    const disp = [], ratio = [], jerk = [], jerkT = [], err0 = [];
    let zeros = 0, movingNow = 0;
    for (const n of idx) {
      const a = render[n - 2], b = render[n - 1], c = render[n];
      const [ax, ay] = proj(a.x, a.z), [bx, by] = proj(b.x, b.z), [cx, cy] = proj(c.x, c.z);
      disp.push(Math.hypot(cx - bx, cy - by));
      // Parado = no se mueve mientras la verdad, con su retraso τ*, sí se
      // mueve (±50 ms): al frenar no cuenta el frame en que ya paró.
      if (speedAt(times[n] - tau, 50, 50) > 0.5) {
        movingNow++;
        if (Math.hypot(c.x - b.x, c.z - b.z) < 1e-6) zeros++;
      }
      jerk.push(Math.hypot(cx - 2 * bx + ax, cy - 2 * by + ay));
      const Ta = sampleTruth(truth, times[n - 2] - off - tau), Tb = sampleTruth(truth, times[n - 1] - off - tau), Tc = sampleTruth(truth, times[n] - off - tau);
      if (Ta && Tb && Tc && !Ta.jump && !Tb.jump && !Tc.jump) {
        const [tax, tay] = proj(Ta.x, Ta.z), [tbx, tby] = proj(Tb.x, Tb.z), [tcx, tcy] = proj(Tc.x, Tc.z);
        const ideal = Math.hypot(tcx - tbx, tcy - tby);
        if (ideal > 0.05) ratio.push(Math.hypot(cx - bx, cy - by) / ideal);
        jerkT.push(Math.hypot(tcx - 2 * tbx + tax, tcy - 2 * tby + tay));
      }
      const T0 = sampleTruth(truth, times[n] - off);
      if (T0 && !T0.jump) { const [x0, y0] = proj(T0.x, T0.z); err0.push(Math.hypot(cx - x0, cy - y0)); }
    }
    return {
      frames: idx.length, zeroPct: r2((100 * zeros) / Math.max(1, movingNow)),
      dispPx: st(disp), jerkPx: st(jerk), jerkTruthPx: st(jerkT), err0Px: st(err0),
      ratio: [r2(q(ratio, 0.05)), r2(q(ratio, 0.5)), r2(q(ratio, 0.95))],
    };
  };
  // Paradas: pasada de largo a lo largo de la marcha y retroceso desde
  // −150 ms del reposo de la verdad hasta que arranca otra vez (+τ*); el
  // tirón, desde −300 ms (con RTT, el local sabe que soltó el mando un RTT
  // antes de que la frenada llegue en el estado).
  const stopMetrics = (kind) => {
    const over = [], stopJerk = [];
    let back = 0, nStops = 0;
    for (const s of E.stops) {
      if (s.kind !== kind) continue;
      const cj = s.ts - 300 + off, c0 = s.ts - 150 + off, c1 = Math.min(s.restart, s.ts + 600) + off + Math.max(0, tau);
      if (cj < win[0] || c1 > win[1]) continue;
      nStops++;
      let maxA = -Infinity, pp = null, ppp = null;
      for (let n = 0; n < render.length; n++) {
        const t = times[n];
        if (t < cj) continue;
        if (t > c1) break;
        const r = render[n];
        if (!r) { pp = null; ppp = null; continue; }
        const [px, py] = proj(r.x, r.z);
        if (pp && ppp) stopJerk.push(Math.hypot(px - 2 * pp[0] + ppp[0], py - 2 * pp[1] + ppp[1]));
        ppp = pp; pp = [px, py];
        if (t < c0) continue;
        const a = (px - s.S[0]) * s.u[0] + (py - s.S[1]) * s.u[1];
        over.push(Math.max(0, a));
        if (a > maxA) maxA = a;
        if (maxA > 0) back = Math.max(back, maxA - a);
      }
    }
    return { n: nStops, overshootPx: { p99: r2(q(over, 0.99)), max: r2(maxOf(over)) }, backPx: r2(back), jerkPx: st(stopJerk) };
  };
  // Al SOLTAR el mando (solo el local): en los 400 ms siguientes el bicho
  // solo puede frenar, así que cada frame que acelera > 20 % sobre el
  // anterior es un tirón (con RTT, el suavizado sabe que se soltó un RTT
  // antes de que la frenada llegue en el estado). Entre paréntesis, lo mismo
  // contado sobre la verdad con el τ* del bicho.
  const releaseMetrics = () => {
    const per = [], perT = [];
    for (const tr of releases ?? []) {
      if (tr < win[0] || tr + 400 > win[1] || nearBad(tr - off) || nearBad(tr + 400 - off)) continue;
      let k = 0, kt = 0, prev = NaN, prevT = NaN;
      for (let n = 1; n < render.length; n++) {
        const t = times[n];
        if (t < tr) continue;
        if (t > tr + 400) break;
        const a = render[n - 1], b = render[n];
        if (!a || !b) { prev = NaN; continue; }
        const dt = (t - times[n - 1]) / 1000;
        const s = Math.hypot(b.x - a.x, b.z - a.z) / dt;
        if (prev > 0.3 && s > 1.2 * prev) k++;
        prev = s;
        const Ta = sampleTruth(truth, times[n - 1] - off - tau), Tb = sampleTruth(truth, t - off - tau);
        if (Ta && Tb && !Ta.jump && !Tb.jump) {
          const st2 = Math.hypot(Tb.x - Ta.x, Tb.z - Ta.z) / dt;
          if (prevT > 0.3 && st2 > 1.2 * prevT) kt++;
          prevT = st2;
        }
      }
      per.push(k); perT.push(kt);
    }
    return { n: per.length, reaccel: { p50: q(per, 0.5), max: maxOf(per) }, reaccelTruth: { max: maxOf(perT) } };
  };
  return {
    tauMs: Number.isFinite(best.tau) ? best.tau : null,
    moving: collect(moving), cruise: collect(cru),
    stops: stopMetrics('brake'), abruptStops: stopMetrics('abrupt'),
    ...(releases ? { releases: releaseMetrics() } : {}),
  };
}

/** Rivales frente a la verdad en el instante en que se pinta al local. */
function coherence(Es, localIdx, renderByEnt, times, off, proj, win, tauL) {
  const errs = [];
  for (const E of Es) {
    if (E.i === localIdx) continue;
    const rr = renderByEnt[E.i];
    for (let n = 0; n < rr.length; n++) {
      const r = rr[n], t = times[n];
      if (!r || t < win[0] || t > win[1]) continue;
      const P = sampleTruth(E.truth, t - off - tauL), P2 = sampleTruth(E.truth, t - off - tauL - 200);
      if (!P || !P2 || P.jump || P2.jump || !P.ok || !P2.ok || E.nearBad(t - off - tauL)) continue;
      if (Math.hypot(P.x - P2.x, P.z - P2.z) / 0.2 < 1) continue;
      const [ax, ay] = proj(r.x, r.z), [bx, by] = proj(P.x, P.z);
      errs.push(Math.hypot(ax - bx, ay - by));
    }
  }
  return { n: errs.length, p50: r2(q(errs, 0.5)), p95: r2(q(errs, 0.95)) };
}

// ------------------------------------------------------------ una grabación
function analyze(R) {
  const d = R.d;
  const proj = makeProjector(d.camera);
  const playP = R.patches.filter((p) => p.ph === 'playing' && typeof p.mt === 'number');
  // Desfase llegada − hora de simulación: percentil 5, no el mínimo. Un
  // solo parche que sale antes de lo habitual (medido: 1 de 440, 16,5 ms)
  // movería toda la verdad y inflaría el retraso de todos por igual.
  const offs = playP.map((p) => p.t + p.mt * 1000);
  const off = q(offs, 0.05);
  // Red y reloj
  const ticks = {};
  for (let j = 1; j < playP.length; j++) {
    const k = Math.round((playP[j - 1].mt - playP[j].mt) * 30);
    ticks[k] = (ticks[k] || 0) + 1;
  }
  const simSpeed = playP.length > 2 ? ((playP[0].mt - playP.at(-1).mt) * 1000) / (playP.at(-1).t - playP[0].t) : NaN;
  const arrIv = playP.slice(1).map((p, j) => p.t - playP[j].t);
  const recF = R.frames.filter((f) => f.pl);
  const frameIv = recF.slice(1).map((f, j) => f.t - recF[j].t);
  const pings = (d.pings ?? []).map((p) => p.ms);
  const [cx, cy] = proj(0, 0), [xx, xy] = proj(1, 0), [zx, zy] = proj(0, 1);
  let projErr = 0;
  for (const f of R.frames) for (const e of f.e) if (e.px !== undefined) {
    const [x, y] = proj(e.rx, e.rz);
    projErr = Math.max(projErr, Math.hypot(x - e.px, y - e.py));
  }
  const meta = {
    file: R.file, critter: d.critter, recordedMode: d.netsmooth, rttInjectedMs: d.rttMs, jitterMs: d.jitterMs,
    commit: d.commit, gl: d.gl,
    browserFps: r1(1000 / (frameIv.reduce((s, v) => s + v, 0) / Math.max(1, frameIv.length))),
    frameMs: st(frameIv),
    patchHz: r1((1000 * (playP.length - 1)) / (playP.at(-1).t - playP[0].t)), patchIntervalMs: st(arrIv), ticksPerPatch: ticks,
    simSpeedVsRealtime: r2(simSpeed), pingMs: st(pings),
    arrivalOffsetVsP5Ms: { min: r1(q(offs, 0) - off), p50: r1(q(offs, 0.5) - off), p95: r1(q(offs, 0.95) - off) },
    pxPerUnitAtCenter: { x: r1(Math.hypot(xx - cx, xy - cy)), z: r1(Math.hypot(zx - cx, zy - cy)) },
    projectionCheckMaxPx: r2(projErr),
    window: [r1(R.win[0]), r1(R.win[1])],
    stats: d.stats,
  };

  // Réplica exacta: config grabada, frames grabados.
  const cfgRec = { ...BASE_CFG, ...(d.configStart ?? {}) };
  const cfgChanged = JSON.stringify(d.configStart) !== JSON.stringify(d.configEnd);
  const recSched = R.frames.map((f) => ({ t: f.t, dt: f.dt, rec: f }));
  const rep = replay(R, cfgRec, recSched);
  const replica = { misalignedFrames: rep.misaligned, configChangedDuringRun: cfgChanged, entities: [] };
  const allErr = [];
  R.players.forEach((P, i) => {
    const errs = [], errsPlace = [];
    R.frames.forEach((f, n) => {
      if (!f.pl || f.t < (R.playingT ?? 0)) return;
      const e = f.e.find((x) => x.i === i);
      const r = rep.out[i][n];
      if (!e || !r) return;
      errs.push(Math.hypot(r.x - e.rx, r.z - e.rz, r.y - e.ry));
      const qv = e.q ?? [e.rx, e.rz, e.ry];
      errsPlace.push(Math.hypot(r.x - qv[0], r.z - qv[1], r.y - qv[2]));
    });
    allErr.push(...errs);
    replica.entities.push({ name: P.name, local: i === R.localIndex, n: errs.length,
      vsPaintedU: { p50: Number(q(errs, 0.5).toExponential(1)), p99: Number(q(errs, 0.99).toExponential(1)), max: Number(maxOf(errs).toExponential(1)) },
      vsPlaceU: { p99: Number(q(errsPlace, 0.99).toExponential(1)) } });
  });
  replica.exactP99U = Number(q(allErr, 0.99).toExponential(1));
  // La misma réplica por el camino de las tasas sintéticas (parches por
  // hora de llegada, mando como escalón, todos los bichos del estado) a los
  // tiempos del navegador: esto es lo que valida las cifras a 60/144 Hz.
  const syn = replay(R, cfgRec, R.frames.map((f) => ({ t: f.t, dt: f.dt })), true);
  const synErr = [];
  R.frames.forEach((f, n) => {
    if (!f.pl || f.t < (R.playingT ?? 0)) return;
    for (const e of f.e) { const r = syn.out[e.i][n]; if (r) synErr.push(Math.hypot(r.x - e.rx, r.z - e.rz, r.y - e.ry)); }
  });
  replica.benchPathP99U = Number(q(synErr, 0.99).toExponential(1));
  replica.benchPathMaxU = Number(maxOf(synErr).toExponential(1));
  replica.p99U = Math.max(replica.exactP99U, replica.benchPathP99U);
  replica.ok = replica.p99U <= 0.1;

  // Entidades y réplicas por tasa × modo.
  const Es = R.players.map((_, i) => prepareEntity(R, i, off, proj)).filter(Boolean);
  const results = { meta, replica, entities: [], coherence: {} };
  const rows = new Map(Es.map((E) => [E.i, {}]));
  // Lo que pintó el navegador.
  const recTimes = R.frames.map((f) => f.t);
  const painted = R.players.map((_, i) => R.frames.map((f) => { const e = f.e.find((x) => x.i === i); return e ? { x: e.rx, z: e.rz } : null; }));
  // Momentos en que el local suelta el mando (del mando grabado por frame).
  const releases = [];
  let held = null;
  for (const f of R.frames) {
    if (!f.inp) continue;
    const h = Math.hypot(f.inp[0], f.inp[1]) > 0.01;
    if (held === true && !h) releases.push(f.t);
    held = h;
  }
  const relOf = (E) => (E.i === R.localIndex ? releases : null);
  for (const E of Es) rows.get(E.i).nav = { [d.netsmooth]: metrics(E, painted[E.i], recTimes, off, proj, R.win, relOf(E)) };
  const L = Es.find((E) => E.i === R.localIndex);
  if (L) {
    const tauL = rows.get(L.i).nav[d.netsmooth].tauMs ?? 0;
    results.coherence.nav = { [d.netsmooth]: coherence(Es, R.localIndex, painted, recTimes, off, proj, R.win, tauL) };
  }
  for (const rate of RATES) {
    const sched = schedule(R, rate);
    const times = sched.map((s) => s.t);
    for (const mode of MODES) {
      const { out } = replay(R, modeConfig(mode, BASE_CFG), sched);
      for (const E of Es) (rows.get(E.i)[rate] ??= {})[mode] = metrics(E, out[E.i], times, off, proj, R.win, relOf(E));
      if (L) {
        const tauL = rows.get(L.i)[rate][mode].tauMs ?? 0;
        (results.coherence[rate] ??= {})[mode] = coherence(Es, R.localIndex, out, times, off, proj, R.win, tauL);
      }
    }
  }
  for (const E of Es) {
    const P = R.players[E.i];
    results.entities.push({ name: P.name, role: E.i === R.localIndex ? 'local' : (P.bot ? 'rival-bot' : 'rival'),
      cruiseUps: r2(E.cruise), stopsInTruth: { brake: E.stops.filter((s) => s.kind === 'brake').length, abrupt: E.stops.filter((s) => s.kind === 'abrupt').length },
      rows: rows.get(E.i) });
  }
  results.acceptance = acceptance(results);
  return results;
}

/** Umbrales del plan aprobado, para el modo dr a cada tasa. */
function acceptance(res) {
  const out = [];
  const lan = !(res.meta.rttInjectedMs > 0);
  const local = res.entities.find((e) => e.role === 'local');
  const rivals = res.entities.filter((e) => e.role !== 'local');
  for (const rate of RATES) {
    const row = (e, m) => e?.rows?.[rate]?.[m];
    if (!row(local, 'dr')) continue;
    const L = row(local, 'dr');
    const chk = (name, value, ok, note = '') => out.push({ rate, name, value, ok, note });
    chk('frames parados local (0 %)', L.moving.zeroPct, L.moving.zeroPct === 0);
    // El peor bicho de cada métrica, con su nombre (y la verdad, para ver si
    // el tirón ya venía del servidor: empujones en contacto, bots que dudan).
    const ents = [local, ...rivals].filter((e) => row(e, 'dr'));
    const worst = (f, dir) => ents.reduce((w, e) => { const v = f(row(e, 'dr')); return Number.isFinite(v) && (!w || (dir > 0 ? v > w.v : v < w.v)) ? { v, e } : w; }, null);
    const jw = worst((x) => x.cruise.jerkPx.p95, 1);
    if (jw) chk('tirón crucero p95, todos (≤ 1 px)', `${jw.v} (${jw.e.name}; verdad ${row(jw.e, 'dr').cruise.jerkTruthPx.p95})`, jw.v <= 1);
    const lo = worst((x) => x.cruise.ratio[0], -1), hi = worst((x) => x.cruise.ratio[2], 1);
    if (lo && hi) chk('ratio crucero p5-p95 (0,85-1,20)', `${lo.v} (${lo.e.name})-${hi.v} (${hi.e.name})`, lo.v >= 0.85 && hi.v <= 1.2);
    chk('retraso local (≤ 10 ms en LAN)', L.tauMs, lan ? L.tauMs !== null && L.tauMs <= 10 : null, lan ? '' : 'no aplica: RTT inyectado');
    const withStops = ents.filter((e) => row(e, 'dr').stops.n > 0);
    const ow = withStops.length ? worst((x) => (x.stops.n > 0 ? x.stops.overshootPx.p99 : NaN), 1) : null;
    const nStops = withStops.reduce((s, e) => s + row(e, 'dr').stops.n, 0);
    chk('pasada de largo en frenadas p99 (≤ 3 px)', ow ? `${ow.v} (${ow.e.name})` : '–', ow ? ow.v <= 3 : null,
      ow ? `${nStops} frenadas: ${withStops.map((e) => `${e.name} ${row(e, 'dr').stops.n}`).join(', ')}` : 'sin frenadas medibles');
    const cDr = res.coherence?.[rate]?.dr, cLg = res.coherence?.[rate]?.legacy;
    if (cDr && cLg) chk('coherencia local↔rivales p95 (≤ legacy)', `${cDr.p95} vs ${cLg.p95}`, cDr.p95 <= cLg.p95, lan ? 'el plan la pide a RTT 80/160' : '');
  }
  out.push({ rate: 'rec', name: 'réplica vs navegador p99 (≤ 0,1 u)', value: res.replica.p99U, ok: res.replica.ok,
    note: res.replica.misalignedFrames ? `${res.replica.misalignedFrames} frames con otro parche` : '' });
  return out;
}

// ------------------------------------------------------------ salida
function printResult(res) {
  const m = res.meta;
  console.log(`\n## ${m.file} — ${m.critter}, grabado en ${m.recordedMode}${m.rttInjectedMs ? `, RTT +${m.rttInjectedMs} ms${m.jitterMs ? ` ±${m.jitterMs}` : ''}` : ', LAN'} (commit ${m.commit})`);
  console.log(`   navegador ${m.browserFps} fps (frame p95 ${m.frameMs.p95} ms) · parches ${m.patchHz} Hz, ticks/parche ${JSON.stringify(m.ticksPerPatch)} · sim×real ${m.simSpeedVsRealtime}`
    + ` · ping p50/p95 ${m.pingMs.p50}/${m.pingMs.p95} ms · llegada−sim frente a su p5: mín ${m.arrivalOffsetVsP5Ms.min} p50 +${m.arrivalOffsetVsP5Ms.p50} p95 +${m.arrivalOffsetVsP5Ms.p95} ms`
    + ` · px/u centro x ${m.pxPerUnitAtCenter.x} z ${m.pxPerUnitAtCenter.z} · proyección ±${m.projectionCheckMaxPx} px`);
  const rp = res.replica;
  console.log(`   réplica (config grabada, frames del navegador) p99 exacta ${rp.exactP99U} u, por el camino del banco ${rp.benchPathP99U} u (máx ${rp.benchPathMaxU}) → ${rp.ok ? 'OK' : 'NO VALE'}`
    + (rp.misalignedFrames ? ` · ${rp.misalignedFrames} frames desalineados` : '') + (rp.configChangedDuringRun ? ' · ¡la config cambió durante la grabación!' : '')
    + ' · ' + rp.entities.map((e) => `${e.name}${e.local ? '*' : ''} ${e.vsPaintedU.p99}/${e.vsPaintedU.max}`).join(', '));
  if (opt.quiet) return;
  const head = '   Hz   modo       parado%  n crucero  salto p50/p95/máx   tirón p95 (verdad)  ratio p5/p50/p95   τ* ms  err0 p95  frenadas: pasada p99/máx · atrás · tirón p95 (n)  en seco: pasada máx (n)';
  const sp = (s) => `${fmt(s.overshootPx.p99)}/${fmt(s.overshootPx.max)} · ${fmt(s.backPx)} · ${fmt(s.jerkPx.p95)} (${s.n})`;
  for (const e of res.entities) {
    console.log(`\n   ${e.name} [${e.role}] crucero ${e.cruiseUps} u/s · paradas en la verdad: ${e.stopsInTruth.brake} frenadas, ${e.stopsInTruth.abrupt} en seco`);
    console.log(head);
    for (const [rate, modes] of Object.entries(e.rows)) {
      for (const [mode, x] of Object.entries(modes)) {
        const c = x.cruise;
        console.log(`   ${String(rate).padEnd(4)} ${mode.padEnd(10)} ${String(x.moving.zeroPct).padStart(6)}  ${String(c.frames).padStart(9)}  ${`${fmt(c.dispPx.p50)}/${fmt(c.dispPx.p95)}/${fmt(c.dispPx.max)}`.padEnd(18)}  `
          + `${`${fmt(c.jerkPx.p95)} (${fmt(c.jerkTruthPx.p95)})`.padEnd(18)}  ${c.ratio.map(fmt).join('/').padEnd(17)} ${String(x.tauMs ?? '–').padStart(5)}  ${fmt(x.moving.err0Px.p95).padStart(8)}`
          + `  ${sp(x.stops).padEnd(47)}  ${fmt(x.abruptStops.overshootPx.max)} (${x.abruptStops.n})`);
      }
    }
    const rel = Object.entries(e.rows).flatMap(([rate, modes]) => Object.entries(modes)
      .filter(([, x]) => x.releases?.n).map(([mode, x]) => `${rate} ${mode} ${x.releases.reaccel.p50}/${x.releases.reaccel.max} (${x.releases.reaccel.p50 !== undefined ? x.releases.reaccelTruth.max : '–'})`));
    if (rel.length) {
      const n = Object.values(e.rows).flatMap((m) => Object.values(m)).find((x) => x.releases?.n)?.releases.n;
      console.log(`   al soltar el mando (${n} veces, 400 ms): frames que re-aceleran > 20 %, p50/máx (verdad máx) — ${rel.join(' · ')}`);
    }
  }
  const coh = Object.entries(res.coherence).map(([rate, ms]) => `${rate}: ` + Object.entries(ms).map(([mo, c]) => `${mo} ${c.p50}/${c.p95}`).join(', '));
  if (coh.length) console.log(`\n   coherencia local↔rivales p50/p95 px — ${coh.join(' · ')}`);
}

function printAcceptance(all) {
  console.log('\n## Umbrales del plan (modo dr)');
  for (const res of all) {
    console.log(`   ${res.meta.file}`);
    for (const a of res.acceptance) {
      const v = a.ok === null ? 'n/a ' : a.ok ? 'OK  ' : 'FALLA';
      console.log(`     ${v} ${String(a.rate).padEnd(4)} ${a.name}: ${a.value}${a.note ? ` (${a.note})` : ''}`);
    }
  }
}

// ------------------------------------------------------------ main
const files = collectFiles(inputs);
const all = [];
for (const f of files) {
  let R;
  try { R = loadRecording(f.path); } catch (e) { console.error(`${basename(f.path)}: ${e.message}`); process.exitCode = 1; continue; }
  if (!R) { if (!f.fromDir) { console.error(`${basename(f.path)}: no es una grabación de net-smoothing-record`); process.exitCode = 1; } continue; }
  const res = analyze(R);
  all.push(res);
  printResult(res);
}
if (!all.length) { console.error('Ninguna grabación que analizar.'); process.exit(1); }
printAcceptance(all);
if (Object.keys(overrides).length) console.log(`\n(--set aplicado a las réplicas: ${JSON.stringify(overrides)}; la réplica de validación usa la config grabada)`);
if (!LOCAL_INPUT) console.log('\n(--local-input=off: las réplicas no conocen el mando local; la réplica de validación sí)');
if (opt.json) {
  const out = resolve(String(opt.json));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ tool: 'net-smoothing-bench', rates: RATES, modes: MODES, window: WINDOW, phase: PHASE, localInput: LOCAL_INPUT, overrides, config: BASE_CFG, results: all }, null, 1));
  console.log(`\nJSON → ${out}`);
}
