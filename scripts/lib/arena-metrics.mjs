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
//     mucho el 8 %).
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
  const arena = [], bg = [];
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 4) {
      (inside(x, y) ? arena : bg).push(luma(x, y));
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
  };
}
