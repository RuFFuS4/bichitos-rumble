// ---------------------------------------------------------------------------
// Métricas del fondo sobre una captura (docs/DIORAMAS.md §«Fondo v2», §12)
// ---------------------------------------------------------------------------
//
// La puerta numérica del fondo v2, sobre la imagen de verdad (no sobre lo
// que el código cree que pinta):
//
//   · ΔL del canto: luminancia 6 px por dentro del labio menos 6 px por
//     fuera, en 64 azimuts. El labio es el CONTORNO VIVO (los fragmentos
//     que siguen en pie), no un r=12 fijo: a t=29/50 los sectores caídos
//     ya no son disco y la muestra de "dentro" caería en fondo.
//   · Jerarquía: luma media de la arena y del fondo, y fracción del fondo
//     por encima del percentil 75 de la arena (decisión 1 de Rafa: como
//     mucho el 8 %). Desde la F4, también la saturación media de cada uno
//     y su cociente, y `checkContract` da el veredicto del contrato §8.
//
// Los azimuts con un sector CAYENDO se excluyen (y se cuentan): justo
// después de un colapso el trozo que se desploma está pegado por fuera
// del labio vivo, es arena y no fondo, y hundía la mediana a t=29.
//
// Solo tiene sentido en la POSE DE JUEGO: la proyección usa esa cámara.
// Los azimuts que caen fuera del cuadro se descartan (en 390×844 los
// labios laterales se salen). No sabe qué tapan props y bichos: por eso se
// reporta la mediana y el percentil 10, no solo el mínimo.
// ---------------------------------------------------------------------------

import sharp from 'sharp';

const CAM = { pos: [0, 23, 25], look: [0, -3, 0], fovDeg: 40 };

function basis() {
  const [px, py, pz] = CAM.pos;
  let f = [CAM.look[0] - px, CAM.look[1] - py, CAM.look[2] - pz];
  const fl = Math.hypot(...f); f = f.map((v) => v / fl);
  // r = f × up(0,1,0) ; u = r × f
  let r = [-f[2], 0, f[0]];
  const rl = Math.hypot(...r); r = r.map((v) => v / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}

/** Mundo → píxel con la cámara de juego. null si queda detrás. */
function projector(W, H) {
  const { f, r, u } = basis();
  const t = Math.tan((CAM.fovDeg * Math.PI) / 360);
  const aspect = W / H;
  return (x, y, z) => {
    const v = [x - CAM.pos[0], y - CAM.pos[1], z - CAM.pos[2]];
    const d = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    if (d <= 0.01) return null;
    const nx = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / d / (t * aspect);
    const ny = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / d / t;
    return [(nx + 1) / 2 * W, (1 - ny) / 2 * H];
  };
}

const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

const inSpan = (a, f) => norm(a - norm(f.startAngle)) <= f.endAngle - f.startAngle + 1e-9;

/** Radio del labio vivo en el azimut `a` (0 si no queda disco). */
function lipRadiusAt(a, fragments) {
  let best = 0;
  for (const f of fragments) {
    if (f.immune) { best = Math.max(best, f.outerR); continue; }
    if (inSpan(a, f)) best = Math.max(best, f.outerR);
  }
  return best;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * @param {Buffer} png   captura SIN HUD (la cuenta atrás y los paneles
 *                       contarían como fondo)
 * @param {Array} fragments fragmentos vivos {innerR, outerR, startAngle, endAngle, immune}
 * @param {Array} falling   fragmentos que están cayendo (misma forma)
 */
export async function measureBackdrop(png, fragments, falling = []) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const luma = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    const o = (yi * W + xi) * C;
    return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  };
  /** Saturación HSV (0-1) de un píxel. Ojo: infla los colores oscuros (un
   *  azul marino casi negro da ~0,9); se reporta por continuidad. */
  const sat = (x, y) => {
    const o = (Math.round(y) * W + Math.round(x)) * C;
    const mx = Math.max(data[o], data[o + 1], data[o + 2]);
    const mn = Math.min(data[o], data[o + 1], data[o + 2]);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };
  /** Croma perceptual CIELAB C* de un píxel (sRGB → lineal → XYZ D65 →
   *  Lab): «cuánto color» hay, sin inflar los oscuros. */
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const chroma = (x, y) => {
    const o = (Math.round(y) * W + Math.round(x)) * C;
    const r = lin(data[o]), g = lin(data[o + 1]), b = lin(data[o + 2]);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
    return Math.hypot(500 * (fx - fy), 200 * (fy - fz));
  };
  const project = projector(W, H);

  // --- ΔL del canto en 64 azimuts ------------------------------------------
  const deltas = [];
  const lipPx = [];
  let fallingSkipped = 0;
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const R = lipRadiusAt(a, fragments);
    if (R <= 0) continue;
    const p = project(Math.cos(a) * R, 0, Math.sin(a) * R);
    const q = project(Math.cos(a) * (R + 0.2), 0, Math.sin(a) * (R + 0.2));
    if (!p || !q) continue;
    lipPx.push(p);
    if (falling.some((f) => inSpan(a, f))) { fallingSkipped++; continue; }
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const dl = Math.hypot(dx, dy) || 1;
    const inL = luma(p[0] - (dx / dl) * 6, p[1] - (dy / dl) * 6);
    const outL = luma(p[0] + (dx / dl) * 6, p[1] + (dy / dl) * 6);
    if (inL === null || outL === null) continue;       // fuera de cuadro
    deltas.push(Math.abs(inL - outL));
  }
  deltas.sort((x, y) => x - y);

  // --- Jerarquía: arena (dentro del labio) frente a fondo ------------------
  // Polígono del labio en pantalla (en orden de azimut).
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = lipPx.length - 1; i < lipPx.length; j = i++) {
      const [xi, yi] = lipPx[i], [xj, yj] = lipPx[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const arena = [], bg = [], arenaSat = [], bgSat = [], arenaC = [], bgC = [];
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 4) {
      const isArena = inside(x, y);
      (isArena ? arena : bg).push(luma(x, y));
      (isArena ? arenaSat : bgSat).push(sat(x, y));
      (isArena ? arenaC : bgC).push(chroma(x, y));
    }
  }
  arena.sort((x, y) => x - y);
  const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const p75 = quantile(arena, 0.75);
  // Sin arena en cuadro no hay jerarquía que medir: null, no un 0 que pase.
  const bgAbove = p75 === null ? null : bg.filter((v) => v > p75).length / (bg.length || 1);
  const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    lip: {
      azimuths: deltas.length,
      fallingSkipped,
      median: r1(quantile(deltas, 0.5)),
      p10: r1(quantile(deltas, 0.1)),
      min: r1(deltas[0] ?? null),
    },
    arenaMean: r1(mean(arena)),
    arenaP75: r1(p75),
    bgMean: r1(mean(bg)),
    bgAboveArenaP75: bgAbove === null ? null : Math.round(bgAbove * 1000) / 10,   // %
    arenaSat: r2(mean(arenaSat)),
    bgSat: r2(mean(bgSat)),
    satRatio: mean(arenaSat) ? r2(mean(bgSat) / mean(arenaSat)) : null,
    arenaChroma: r1(mean(arenaC)),
    bgChroma: r1(mean(bgC)),
    chromaRatio: mean(arenaC) ? r2(mean(bgC) / mean(arenaC)) : null,
  };
}

const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

/**
 * Veredicto del contrato de legibilidad (docs/DIORAMAS.md §«Fondo v2» §8)
 * sobre lo que devuelve `measureBackdrop`:
 *   · ΔL del canto: mediana ≥45 y mínimo ≥15;
 *   · pozo oscuro: fondo ≥20 por debajo de la arena y ≤8 % del fondo por
 *     encima de su p75 (decisión 1). Con pozo CLARO (decisión 2) se
 *     invierte: el fondo tiene que quedar POR ENCIMA de la arena;
 *   · saturación del fondo entre 0,4 y 0,9 veces la de la arena, medida
 *     como croma perceptual (CIELAB C*): la HSV infla los oscuros y daba a
 *     todos los pozos por encima de su arena. Con el croma, tundra y
 *     kitsune siguen fuera (su arena es casi gris: nieve y piedra); es
 *     una decisión pendiente de Rafa, no un fallo del cielo (DIORAMAS F4).
 * Devuelve `{ ok, fails }` con cada incumplimiento dicho en claro.
 */
export function checkContract(m, pit = 'dark') {
  const fails = [];
  if (m.lip.median === null || m.lip.median < 45) fails.push(`ΔL mediana ${m.lip.median} < 45`);
  if (m.lip.min === null || m.lip.min < 15) fails.push(`ΔL mínimo ${m.lip.min} < 15`);
  if (pit === 'dark') {
    if (m.bgMean !== null && m.arenaMean !== null && m.bgMean > m.arenaMean - 20) {
      fails.push(`fondo ${m.bgMean} no queda 20 por debajo de la arena ${m.arenaMean}`);
    }
    if (m.bgAboveArenaP75 !== null && m.bgAboveArenaP75 > 8) fails.push(`fondo claro ${m.bgAboveArenaP75} % > 8 %`);
  } else if (m.bgMean !== null && m.arenaMean !== null && m.bgMean <= m.arenaMean) {
    fails.push(`pozo claro: el fondo ${m.bgMean} no queda por encima de la arena ${m.arenaMean}`);
  }
  if (m.chromaRatio !== null && (m.chromaRatio < 0.4 || m.chromaRatio > 0.9)) {
    fails.push(`saturación (croma) fondo/arena ${m.chromaRatio} fuera de 0,4-0,9`);
  }
  return { ok: fails.length === 0, fails };
}
