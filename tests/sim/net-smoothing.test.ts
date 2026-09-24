// ---------------------------------------------------------------------------
// Suavizado online (src/net-smoothing.ts) contra un servidor de mentira que
// integra EXACTAMENTE como el paso de BrawlRoom (v += empuje; x += v·dt;
// v *= f; zona muerta en inercia con pushTerminal; tope maxSpeed) con los
// números de SIM, manda parches a 20 Hz (1 y 2 ticks alternos) con
// matchTimer, y un cliente que pinta a 60 o 144 Hz. Lo que se mide es lo que
// se ve: saltos por frame, frames parados y distancia a la trayectoria del
// servidor. 0,07 u ≈ 3 px a 1080p con la cámara de juego (43,8 px/u).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { SIM } from '../../server/src/sim/config.js';
import { FEEL } from '../../src/gamefeel';
import { NET_SMOOTHING, NetSmoother, type NetPlayerState, type NetMovement } from '../../src/net-smoothing';

const DT = 1 / SIM.tickRate;
const cfg = () => ({ ...NET_SMOOTHING, mode: 'dr' as const, remotes: true });
const movement = (): NetMovement => ({ ...FEEL.movement, fallSpeed: FEEL.lives.fallSpeed });

interface Tick {
  n: number; mt: number; x: number; z: number; vx: number; vz: number;
  alive: boolean; falling: boolean; fallY: number; input: [number, number];
}

/** Servidor de mentira: `input(n)` = dirección [mx, mz] en el tick n;
 *  `impulse(n)` = Δv instantáneo (choque) al empezar el tick n. */
function simulate(ticks: number, speed: number, input: (n: number) => [number, number],
  impulse: (n: number) => [number, number] = () => [0, 0]): Tick[] {
  const out: Tick[] = [];
  let x = 0, z = 0, vx = 0, vz = 0;
  const accel = speed * SIM.movement.accelerationScale;
  for (let n = 1; n <= ticks; n++) {
    const [ix, iz] = impulse(n); vx += ix; vz += iz;
    const [mx, mz] = input(n);
    const has = Math.hypot(mx, mz) > 0.01;
    const moveAccel = Math.hypot(mx, mz) * accel;
    vx += mx * accel * DT; vz += mz * accel * DT;
    x += vx * DT; z += vz * DT;
    const hl = has ? SIM.movement.frictionHalfLife : SIM.movement.idleFrictionHalfLife;
    const f = Math.pow(0.5, DT / hl);
    vx *= f; vz *= f;
    const s = Math.hypot(vx, vz);
    const coasting = !has || (moveAccel * hl) / Math.LN2 < SIM.movement.velocityDeadZone;
    if (coasting && s < SIM.movement.velocityDeadZone) { vx = 0; vz = 0; }
    else if (s > SIM.movement.maxSpeed) { vx *= SIM.movement.maxSpeed / s; vz *= SIM.movement.maxSpeed / s; }
    out.push({ n, mt: 90 - n * DT, x, z, vx, vz, alive: true, falling: false, fallY: 0, input: [mx, mz] });
  }
  return out;
}

/** Posición del servidor en hora de servidor t (s), lineal entre ticks. */
function truthAt(ticks: Tick[], t: number): [number, number] {
  const k = t / DT;
  const i = Math.max(0, Math.min(ticks.length - 2, Math.floor(k) - 1));
  const a = ticks[i], b = ticks[i + 1];
  const u = Math.max(0, Math.min(1, k - a.n));
  return [a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u];
}

/** Cliente: parches cada 50 ms con el último tick, que llegan `latencyMs`
 *  después (vuelta); pinta a `hz`. Si `local`, el mando que conoce el
 *  cliente es el que el servidor aplicará `latencyMs` más tarde (ida), y el
 *  RTT medido es la suma de las dos. Devuelve lo pintado por frame, en hora
 *  de servidor. */
function play(ticks: Tick[], hz: number, opts: { latencyMs?: number; local?: boolean; rtt?: boolean;
  mutate?: (p: Tick, tMs: number) => NetPlayerState } = {}) {
  const latencyMs = opts.latencyMs ?? 10;
  const local = opts.local ?? true;
  const sm = new NetSmoother(movement, cfg());
  if (opts.rtt ?? true) sm.noteRtt(2 * latencyMs);
  const key = {};
  const frames: Array<{ t: number; x: number; z: number; y: number }> = [];
  const endMs = ticks[ticks.length - 1].n * DT * 1000;
  for (let tMs = 60; tMs < endMs - 60; tMs += 1000 / hz) {
    const sendMs = Math.floor((tMs - latencyMs) / 50 + 1e-9) * 50;        // último parche que ya llegó
    const n = Math.floor(sendMs / (DT * 1000) + 1e-6);
    if (n < 1) continue;
    const p = ticks[n - 1];
    if (local) {
      const nIn = Math.min(ticks.length, Math.max(1, Math.floor((tMs + latencyMs) / (DT * 1000))));
      sm.noteLocalInput(...ticks[nIn - 1].input, tMs);
    }
    sm.beginFrame(tMs, p.mt, true);
    const pos = sm.place(key, opts.mutate ? opts.mutate(p, tMs) : p, local, 1 / hz);
    frames.push({ t: (tMs - latencyMs) / 1000, x: pos.x, z: pos.z, y: pos.y });
  }
  return frames;
}

const straight = (n: number): [number, number] => (n > 0 ? [1, 0] : [0, 0]);

describe('net-smoothing — crucero', () => {
  it('serverTickHz es el tick del servidor', () => {
    expect(NET_SMOOTHING.serverTickHz).toBe(SIM.tickRate);
  });

  it('en crucero el bicho recorre 1/f veces la v publicada (por eso no vale extrapolar con v)', () => {
    const t = simulate(120, 14, straight);
    const a = t[100], b = t[101];
    const lead = (b.x - a.x) / DT / a.vx;
    expect(lead).toBeCloseTo(Math.pow(2, DT / SIM.movement.frictionHalfLife), 3); // ≈ 1,335
  });

  for (const hz of [60, 144]) {
    for (const local of [true, false]) {
      it(`a ${hz} Hz (${local ? 'local' : 'remoto'}): ningún frame parado, velocidad uniforme y pegado al servidor`, () => {
        const ticks = simulate(150, 14, straight);
        const frames = play(ticks, hz, { local }).filter((f) => f.t > 1.2);   // tras acelerar
        const ideal = (ticks[140].x - ticks[139].x) / DT / hz;
        for (let i = 1; i < frames.length; i++) {
          const d = frames[i].x - frames[i - 1].x;
          expect(d / ideal).toBeGreaterThan(0.9);
          expect(d / ideal).toBeLessThan(1.1);
          const [sx] = truthAt(ticks, frames[i].t);
          expect(Math.abs(frames[i].x - sx)).toBeLessThan(0.03);  // < 1,3 px (snap: hasta 0,27 u)
        }
      });
    }
  }
});

describe('net-smoothing — frenadas, golpes y saltos', () => {
  // Medido al escribirlo (velocidad 14, 10-80 ms): el local, con el mando de
  // hace un RTT, se pasa 0,005-0,007 u (0,3 px) y su velocidad baja sin
  // rebotar; frenarlo en el acto daba 0 de pasada pero un diente de sierra
  // de velocidad de ~200 ms a RTT 160 (4,1 → 1,4 → 4,3 u/s, medido en
  // navegador). Un remoto, que lo deduce, se pasa ≤ 0,018 u.
  for (const local of [true, false]) {
    for (const latencyMs of [10, 40, 80]) {
      it(`al soltar el mando no se pasa de largo ni rebota (${local ? 'local' : 'remoto'}, ${latencyMs} ms)`, () => {
        const ticks = simulate(150, 14, (n) => (n <= 90 ? [1, 0] : [0, 0]));
        const rest = ticks[ticks.length - 1].x;
        const frames = play(ticks, 144, { local, latencyMs });
        const maxX = Math.max(...frames.map((f) => f.x));
        expect(maxX - rest).toBeLessThan(local ? 0.01 : 0.03);
        // nunca retrocede (el rebote que se veía al parar)…
        for (let i = 1; i < frames.length; i++) {
          expect(frames[i].x - frames[i - 1].x).toBeGreaterThan(local ? -0.002 : -0.01);
        }
        // …y el local no vuelve a acelerar después de empezar a frenar
        if (local) {
          const tRelease = 90 * DT;
          const steps = frames.filter((f) => f.t > tRelease - 0.05).map((f, i, a) => (i ? f.x - a[i - 1].x : 0)).slice(1);
          const peak = steps.findIndex((d, i) => i > 0 && d < steps[i - 1] * 0.9);   // empieza a frenar
          for (let i = Math.max(1, peak + 1); i < steps.length && steps[i - 1] > 1e-3; i++) {
            expect(steps[i]).toBeLessThan(steps[i - 1] * 1.1 + 1e-4);
          }
        }
        expect(Math.abs(frames[frames.length - 1].x - rest)).toBeLessThan(0.005);
      });
    }
  }

  it('sin RTT medido todavía, el local frena con la regla de los rivales', () => {
    const ticks = simulate(150, 14, (n) => (n <= 90 ? [1, 0] : [0, 0]));
    const rest = ticks[ticks.length - 1].x;
    const frames = play(ticks, 144, { local: true, latencyMs: 40, rtt: false });
    expect(Math.max(...frames.map((f) => f.x)) - rest).toBeLessThan(0.03);
  });

  it('un rival quieto al que golpean frena con la fricción de parada, sin retroceder', () => {
    // Quieto (sin mando) y un golpe de 10-20 u/s: el servidor lo frena con la
    // fricción de parada. El "empuje" deducido va contra la marcha y es mayor
    // que el máximo: sin la regla de frenada se predecía con la fricción de
    // empuje y retrocedía hasta 0,026 u al corregir (medido).
    for (const kick of [10, 15, 20]) {
      const ticks = simulate(150, 14, () => [0, 0], (n) => (n === 60 ? [kick, 0] : [0, 0]));
      const frames = play(ticks, 60, { local: false });
      for (let i = 1; i < frames.length; i++) {
        expect(frames[i].x - frames[i - 1].x).toBeGreaterThan(-0.005);
      }
      expect(Math.max(...frames.map((f) => f.x)) - ticks[ticks.length - 1].x).toBeLessThan(0.01);
    }
  });

  for (const kick of [15, 25]) {
    it(`un knockback de ${kick} u/s se frena donde lo frena el servidor (tope después de la fricción)`, () => {
      // crucero en +x y, en el tick 80, un golpe en +z
      const ticks = simulate(140, 14, straight, (n) => (n === 80 ? [0, kick] : [0, 0]));
      const frames = play(ticks, 60);
      // El golpe llega sin avisar (hasta un parche de retraso: eso no lo arregla
      // nadie sin predicción de cliente), y ese error inicial crece con el
      // golpe. Una vez recibido, en 4·correctionTime (98 %) ya va pegado al
      // servidor, y en ningún momento se pasa de largo.
      let worst = 0;
      const t0 = 80 * DT + 0.05 + 4 * NET_SMOOTHING.correctionTime;
      for (const f of frames) {
        if (f.t < t0 || f.t > t0 + 0.5) continue;
        const [sx, sz] = truthAt(ticks, f.t);
        worst = Math.max(worst, Math.hypot(f.x - sx, f.z - sz));
      }
      const maxZ = Math.max(...frames.map((f) => f.z));
      expect(maxZ).toBeLessThan(ticks[ticks.length - 1].z + 0.05);
      expect(worst).toBeLessThan(0.05);
    });
  }

  it('respawn (falling → no falling) salta a la posición nueva, sin deslizarse', () => {
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    const base = { vx: 0, vz: 0, alive: true };
    sm.beginFrame(0, 90, true);
    sm.place(key, { ...base, x: 5, z: 5, falling: false }, true, 1 / 60);
    sm.beginFrame(16, 90 - DT, true);
    sm.place(key, { ...base, x: 5, z: 5, falling: true, fallY: -1 }, true, 1 / 60);
    sm.beginFrame(33, 90 - 2 * DT, true);
    const p = sm.place(key, { ...base, x: 0.5, z: -0.5, falling: false, fallY: 0 }, true, 1 / 60);
    expect([p.x, p.z, p.y]).toEqual([0.5, -0.5, 0]);
    expect(sm.stats().snaps.respawn).toBe(1);
  });

  it('un teleport (blink, decoy, Grip: v = 0), aunque sea corto, salta; un empujón de choque no', () => {
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    const s = { vx: 0, vz: 0, alive: true, falling: false };
    sm.beginFrame(0, 90, true);
    sm.place(key, { ...s, x: 0, z: 0 }, false, 1 / 60);
    // Separación de un choque (resolveCollisions): unas décimas → se reparte.
    sm.beginFrame(17, 90 - DT, true);
    const nudge = sm.place(key, { ...s, x: 0.4, z: 0 }, false, 1 / 60);
    expect(nudge.x).toBeGreaterThan(0);
    expect(nudge.x).toBeLessThan(0.4);
    // Blink corto (1,5 u < snapDistance) y parado → salto directo. Antes se
    // deslizaba ~200 ms a 44-53 u/s.
    sm.beginFrame(51, 90 - 3 * DT, true);
    const blink = sm.place(key, { ...s, x: 1.9, z: 0 }, false, 1 / 60);
    expect(blink.x).toBeCloseTo(1.9, 6);
    expect(sm.stats().snaps.teleport).toBe(1);
    // Knockback: mucho recorrido pero con velocidad → no es teleport.
    sm.beginFrame(85, 90 - 4 * DT, true);
    sm.place(key, { ...s, x: 2.9, z: 0, vx: 15 }, false, 1 / 60);
    expect(sm.stats().snaps.teleport).toBe(1);
    // Más allá de snapDistance, salta siempre (red de seguridad).
    sm.beginFrame(119, 90 - 5 * DT, true);
    const far = sm.place(key, { ...s, x: 2.9 + NET_SMOOTHING.snapDistance + 1, z: 0, vx: 15 }, false, 1 / 60);
    expect(far.x).toBeGreaterThan(2.9 + NET_SMOOTHING.snapDistance);
    expect(sm.stats().snaps.distance).toBe(1);
  });

  it('un bicho que para (v → 0) no recula: frenar hasta 0 no es un empuje hacia atrás', () => {
    for (const local of [true, false]) {
      const ticks = simulate(150, 14, (n) => (n <= 60 ? [1, 0] : [0, 0]));
      const frames = play(ticks, 60, { local, latencyMs: 40 });
      const stop = ticks.findIndex((t) => t.n > 60 && t.vx === 0);
      const after = frames.filter((f) => f.t > ticks[stop].n * DT);
      for (let i = 1; i < after.length; i++) expect(after[i].x - after[i - 1].x).toBeGreaterThan(-1e-3);
    }
  });

  it('fuera de playing (cuenta atrás, fin) no extrapola aunque v siga puesta', () => {
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    for (let i = 0; i < 30; i++) {
      sm.beginFrame(i * 16.7, 42, false);                   // matchTimer quieto
      const p = sm.place(key, { x: 3, z: 1, vx: 5, vz: 0, alive: true, falling: false }, true, 1 / 60);
      expect([p.x, p.z]).toEqual([3, 1]);
    }
  });

  it('a pocos fps, un parche de la cuenta atrás no entra en el reloj de playing', () => {
    // Sin un frame entre el último parche de la cuenta atrás y los primeros
    // de playing (pestaña lenta, 10 fps), nada rearma el reloj entre medias.
    // La cuenta atrás lleva matchTimer congelado en 90: tomado como hora de
    // servidor, dejaría el reloj ~50 ms corto y la subida lenta (clockCreep)
    // tardaría casi un segundo en arreglarlo, con el bicho adelantado.
    const sm = new NetSmoother(movement, cfg());
    sm.beginFrame(500, 90, false);                      // último frame de la cuenta atrás
    sm.notePatch(560, 90, 'countdown');                 // enviado a los 550 ms
    sm.notePatch(660, 90 - DT, 'playing');              // enviado a los 650: tick 1 (633 ms)
    sm.notePatch(710, 90 - 3 * DT, 'playing');          // enviado a los 700: tick 3 (700 ms)
    sm.beginFrame(720, 90 - 3 * DT, true);
    // Hora de servidor = −matchTimer·1000. El parche mejor entregado es el de
    // los 710 ms (tick 3, −89 900): desfase 710 + 89 900 = 90 610. El de la
    // cuenta atrás daría 560 + 90 000 = 90 560, 50 ms corto.
    expect(Math.abs(sm.stats().clockOffsetMs - 90610)).toBeLessThan(3);
  });

  /** Servidor con su propio reloj: `rate` = velocidad de su simulación frente
   *  al reloj real; `stall` = un tirón (ni manda ni avanza). Parches cada
   *  50 ms de reloj real con el último tick, que llegan 10 ms después; el
   *  cliente pinta a 60 Hz. Devuelve los frames con la edad saturada en
   *  maxExtrapolation a partir de `fromMs`. */
  function saturatedAfter(rate: number, fromMs: number, stall?: { atMs: number; ms: number }): number {
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    const serverAt = (w: number) => rate * (w - (stall ? Math.min(Math.max(w - stall.atMs, 0), stall.ms) : 0));
    const patches: Array<{ arrival: number; mt: number }> = [];
    for (let w = 0; w <= 10000; w += 50) {
      if (stall && w > stall.atMs && w < stall.atMs + stall.ms) continue;
      const n = Math.floor(serverAt(w) / (DT * 1000) + 1e-6);
      patches.push({ arrival: w + 10, mt: 90 - n * DT });
    }
    let k = 0, mt = patches[0].mt, before = 0;
    for (let t = 20; t < 10000; t += 1000 / 60) {
      while (k < patches.length && patches[k].arrival <= t) { mt = patches[k].mt; sm.notePatch(patches[k].arrival, mt, 'playing'); k++; }
      if (t < fromMs) before = sm.stats().saturatedFrames;
      sm.beginFrame(t, mt, true);
      sm.place(key, { x: 0, z: 0, vx: 0, vz: 0, alive: true, falling: false }, true, 1 / 60);
    }
    return sm.stats().saturatedFrames - before;
  }

  it('el reloj se recupera de un tirón de 200 ms del servidor en ~1 s', () => {
    // Con el mínimo histórico, la edad se quedaba saturada para siempre
    // (medido en la verificación: vuelven los saltos a 20 Hz).
    expect(saturatedAfter(1, 3000 + 200 + 1300, { atMs: 3000, ms: 200 })).toBe(0);
  });

  it('el reloj sigue a un servidor algo lento (0,966×, setInterval de 34,5 ms en Linux)', () => {
    expect(saturatedAfter(0.966, 2000)).toBe(0);
  });

  it('la secuencia real de fases (espera, cuenta atrás, playing) deja el reloj en su sitio', () => {
    const ticks = simulate(150, 14, straight);
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    const frame = 1000 / 60;
    for (let tMs = 0; tMs < 300; tMs += frame) {          // espera
      sm.notePatch(tMs, 0, 'waiting');
      sm.beginFrame(tMs, 0, false);
      sm.place(key, { x: 0, z: 0, vx: 0, vz: 0, alive: true, falling: false }, true, 1 / 60);
    }
    for (let tMs = 300; tMs < 600; tMs += frame) {        // cuenta atrás
      sm.notePatch(tMs, 90, 'countdown');
      sm.beginFrame(tMs, 90, false);
      sm.place(key, { x: 0, z: 0, vx: 0, vz: 0, alive: true, falling: false }, true, 1 / 60);
    }
    // playing: el tick n sale en hora 600 + n·DT y llega 10 ms después (la
    // hora EXACTA de llegada la da el hook, como room.onStateChange).
    let worst = 0;
    let lastSent = -1;
    for (let tMs = 610; tMs < 600 + 140 * DT * 1000; tMs += frame) {
      const sentMs = Math.floor((tMs - 610) / 50) * 50;
      const n = Math.floor(sentMs / (DT * 1000) + 1e-6);
      if (n < 1) continue;
      const p = ticks[n - 1];
      if (sentMs !== lastSent) { sm.notePatch(610 + sentMs, p.mt, 'playing'); lastSent = sentMs; }
      sm.beginFrame(tMs, p.mt, true);
      sm.noteLocalInput(1, 0);
      const pos = sm.place(key, p, true, 1 / 60);
      const t = (tMs - 610) / 1000;
      if (t > 1.2) worst = Math.max(worst, Math.abs(pos.x - truthAt(ticks, t)[0]));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('un servidor que deja de mandar no se escapa: tope maxExtrapolation', () => {
    const ticks = simulate(60, 14, straight);
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    const last = ticks[59];
    let p = { x: 0, z: 0 };
    for (let tMs = 2000; tMs < 3000; tMs += 16.7) {
      sm.beginFrame(tMs, last.mt, true);
      p = sm.place(key, last, true, 1 / 60);
    }
    const lead = Math.pow(2, DT / SIM.movement.frictionHalfLife);
    expect(p.x - last.x).toBeLessThanOrEqual(last.vx * lead * NET_SMOOTHING.maxExtrapolation + 1e-6);
  });

  it('un frame largo (pestaña en segundo plano) salta al presente', () => {
    const ticks = simulate(200, 14, straight);
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    sm.beginFrame(1000, ticks[29].mt, true);
    sm.place(key, ticks[29], true, 1 / 60);
    sm.beginFrame(5000, ticks[149].mt, true);
    const p = sm.place(key, ticks[149], true, 0.05);
    expect(p.x).toBeCloseTo(ticks[149].x, 6);
    expect(sm.stats().snaps.frameGap).toBe(1);
  });

  it('partida nueva (matchTimer vuelve arriba) rearma el reloj', () => {
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    const s = { x: 0, z: 0, vx: 3, vz: 0, alive: true, falling: false };
    sm.beginFrame(0, 1.0, true);
    sm.place(key, s, true, 1 / 60);
    sm.beginFrame(20, 90, true);                              // nueva partida
    const p = sm.place(key, { ...s, alive: false }, true, 1 / 60);
    sm.beginFrame(40, 90, true);
    const q = sm.place(key, s, true, 1 / 60);
    expect(Number.isFinite(p.x) && Number.isFinite(q.x)).toBe(true);
    expect(Math.abs(q.x)).toBeLessThan(0.2);
  });

  it('campos que faltan en el primer parche no dan NaN', () => {
    const sm = new NetSmoother(movement, cfg());
    sm.beginFrame(0, 90, true);
    const p = sm.place({}, {}, true, 1 / 60);
    expect(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('net-smoothing — caída al vacío', () => {
  it('quien cae tras un golpe no recula hacia la arena', () => {
    // Golpe hacia +x: la predicción lo adelanta; al caer, el servidor lo
    // deja quieto donde cayó. Corregir hacia ese punto lo hacía retroceder
    // 10-18 px (medido); ahora se queda donde se le ve caer.
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    const base = { z: 0, vz: 0, alive: true };
    const xs: number[] = [];
    const frame = (tMs: number, n: number, p: NetPlayerState) => {
      sm.beginFrame(tMs, 90 - n * DT, true);
      xs.push(sm.place(key, p, false, 1 / 60).x);
    };
    frame(0, 1, { ...base, x: 0, vx: 0, falling: false });
    frame(50, 2, { ...base, x: 0.5, vx: 15, falling: false });
    for (let t = 67; t < 120; t += 1000 / 60) frame(t, 2, { ...base, x: 0.5, vx: 15, falling: false });
    const ahead = xs[xs.length - 1];
    for (let t = 120; t < 500; t += 1000 / 60) frame(t, 4, { ...base, x: 0.7, vx: 0, falling: true, fallY: -1 });
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
    expect(xs[xs.length - 1]).toBeCloseTo(ahead, 6);
  });

  it('la altura baja lisa entre parches y se corta al reaparecer', () => {
    const fall = FEEL.lives.fallSpeed;
    const sm = new NetSmoother(movement, cfg());
    const key = {};
    const ys: number[] = [];
    // El servidor baja fallY a `fall` u/s mientras cae; parches cada 50 ms.
    for (let tMs = 0; tMs < 600; tMs += 1000 / 60) {
      const n = Math.floor(tMs / 50) * 50 / (DT * 1000) | 0;
      const mt = 90 - n * DT;
      sm.beginFrame(tMs, mt, true);
      const pos = sm.place(key, { x: 2, z: 0, vx: 0, vz: 0, alive: true, falling: true, fallY: -fall * n * DT }, true, 1 / 60);
      ys.push(pos.y);
      expect(pos.x).toBe(2);                                  // quien cae no se mueve en x/z
    }
    // Sin escalones: cada frame baja, y ninguno más de 1,5× lo ideal.
    const ideal = fall / 60;
    for (let i = 5; i < ys.length; i++) {
      const d = ys[i - 1] - ys[i];
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(1.5 * ideal + 1e-9);
    }
    // Reaparece: y vuelve a 0 en el acto.
    sm.beginFrame(620, 90 - 20 * DT, true);
    const back = sm.place(key, { x: 0, z: 0, vx: 0, vz: 0, alive: true, falling: false, fallY: 0 }, true, 1 / 60);
    expect([back.x, back.z, back.y]).toEqual([0, 0, 0]);
  });
});

describe('net-smoothing — modo legacy y remotos apagados (A/B)', () => {
  it('legacy reproduce lo de antes: snap local, lerp dt·15 remoto', () => {
    const sm = new NetSmoother(movement, { ...NET_SMOOTHING, mode: 'legacy' });
    const L = {}, R = {};
    const s = { vx: 9, vz: 0, alive: true, falling: false };
    sm.beginFrame(0, 90, true);
    sm.place(L, { ...s, x: 0, z: 0 }, true, 1 / 60);
    sm.place(R, { ...s, x: 0, z: 0 }, false, 1 / 60);
    sm.beginFrame(16, 90 - DT, true);
    expect(sm.place(L, { ...s, x: 1, z: 0 }, true, 1 / 60).x).toBe(1);
    expect(sm.place(R, { ...s, x: 1, z: 0 }, false, 1 / 60).x).toBeCloseTo(15 / 60, 10);
    expect(sm.place(L, { ...s, x: 1, z: 0, falling: true, fallY: -2 }, true, 1 / 60).y).toBe(-2);
  });

  it('remotes: false deja a los rivales con el lerp y al local con la predicción', () => {
    const sm = new NetSmoother(movement, { ...NET_SMOOTHING, mode: 'dr', remotes: false });
    const R = {};
    const s = { vx: 9, vz: 0, alive: true, falling: false };
    sm.beginFrame(0, 90, true);
    sm.place(R, { ...s, x: 0, z: 0 }, false, 1 / 60);
    sm.beginFrame(16, 90 - DT, true);
    expect(sm.place(R, { ...s, x: 1, z: 0 }, false, 1 / 60).x).toBeCloseTo(15 / 60, 10);
  });
});
