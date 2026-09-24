#!/usr/bin/env node
// ---------------------------------------------------------------------------
// critter-grade — recolour a critter texture by colour family, keeping detail
// ---------------------------------------------------------------------------
//
// The Tripo atlases are hundreds of tiny UV islands, so nothing can be
// painted by region. Instead each grade op selects a colour FAMILY (a soft
// range of hue / saturation / lightness) and moves that family's mean to a
// target colour with an offset in CIELAB: every pixel of the family moves by
// the same amount, so the texture's own shading, warts and stripes survive.
// Ops run in order, each on the result of the previous one.
//
//   { "name": "pelo negro → carbón",
//     "select": { "h": [340, 20], "s": [0, 0.3], "l": [0, 0.22] },   any subset; h wraps
//     "to": "#3f3f40",           the family's new mean colour (albedo, before lighting)
//     "contrast": 1.4 }          optional: scale lightness around the mean (flat blacks)
//
// Used by scripts/critter-recipe.mjs (`textures.grade`). As a CLI it
// previews a grade on the CURRENT game GLB, without Blender or gltfpack:
//
//   node scripts/critter-grade.mjs kowalski --out=.tmp/k.glb          # the recipe's grade
//   node scripts/critter-grade.mjs kowalski --ops=try.json --png=.tmp/k.png
//
// Target colours are ALBEDO: the lights of the arena and the select screen
// brighten them, so judge the render next to the sketch, not the swatch.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const SOFT = { h: 10, s: 0.06, l: 0.05 };

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToLab(r, g, b) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  return [R, G, B].map((c) => Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))));
}

function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Soft membership of `v` in [lo, hi] with edges `soft` wide (outside the range). */
function inRange(v, [lo, hi], soft) {
  return smooth(lo - soft, lo, v) * (1 - smooth(hi, hi + soft, v));
}

/** Hue membership; the range may wrap through 0 (e.g. [340, 20]). */
function inHue(h, [lo, hi], soft) {
  const span = ((hi - lo) % 360 + 360) % 360;
  const off = ((h - lo) % 360 + 360) % 360;       // 0..360 from lo, going up
  const inside = off <= span;
  if (inside) return 1;
  const below = 360 - off;                          // distance under lo
  const above = off - span;                         // distance over hi
  return 1 - smooth(0, soft, Math.min(below, above));
}

function membership([h, s, l], sel) {
  let w = 1;
  if (sel.h) w *= inHue(h, sel.h, sel.softH ?? SOFT.h);
  if (sel.s) w *= inRange(s, sel.s, sel.softS ?? SOFT.s);
  if (sel.l) w *= inRange(l, sel.l, sel.softL ?? SOFT.l);
  return w;
}

/**
 * Apply `ops` to raw 8-bit RGB(A) pixels in place. Returns one report line
 * per op: the family's share of the texture and its mean before/after.
 */
export function gradePixels(data, channels, ops) {
  const n = data.length / channels;
  const report = [];
  for (const op of ops) {
    const target = rgbToLab(...hexToRgb(op.to));
    const w = new Float32Array(n);
    const lab = new Float32Array(n * 3);
    const mean = [0, 0, 0];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const r = data[i * channels] / 255, g = data[i * channels + 1] / 255, b = data[i * channels + 2] / 255;
      const wi = membership(rgbToHsl(r, g, b), op.select ?? {});
      if (wi <= 0) continue;
      const [L, A, B] = rgbToLab(r, g, b);
      w[i] = wi; lab[3 * i] = L; lab[3 * i + 1] = A; lab[3 * i + 2] = B;
      mean[0] += wi * L; mean[1] += wi * A; mean[2] += wi * B; total += wi;
    }
    if (total < 1) { report.push(`${op.name ?? op.to}: 0 %`); continue; }
    mean.forEach((_, k) => (mean[k] /= total));
    const contrast = op.contrast ?? 1;
    for (let i = 0; i < n; i++) {
      const wi = w[i];
      if (!wi) continue;
      const L = target[0] + (lab[3 * i] - mean[0]) * contrast;
      const A = lab[3 * i + 1] + target[1] - mean[1];
      const B = lab[3 * i + 2] + target[2] - mean[2];
      const out = labToRgb(L, A, B);
      for (let k = 0; k < 3; k++) {
        const o = i * channels + k;
        data[o] = Math.round(255 * (data[o] / 255 + wi * (out[k] - data[o] / 255)));
      }
    }
    const hex = (l) => '#' + labToRgb(...l).map((c) => Math.round(255 * c).toString(16).padStart(2, '0')).join('');
    report.push(`${op.name ?? op.to}: ${(100 * total / n).toFixed(1)} % · ${hex(mean)} → ${op.to}`);
  }
  return report;
}

/** Grade an encoded image; returns lossless PNG bytes and the report. */
export async function gradeImage(bytes, ops) {
  const { data, info } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true });
  const report = gradePixels(data, info.channels, ops);
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
  return { png: new Uint8Array(png), report };
}

// ---------------------------------------------------------------------------
// CLI: preview a grade on the current game GLB.
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { MeshoptDecoder, MeshoptEncoder } = await import('meshoptimizer');
  const ROOT = resolve(import.meta.dirname, '..');
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  if (!id) {
    console.error('uso: node scripts/critter-grade.mjs <id> [--ops=ops.json] [--out=preview.glb] [--png=textura.png]');
    process.exit(1);
  }
  const ops = opt('ops')
    ? JSON.parse(readFileSync(resolve(opt('ops')), 'utf8'))
    : JSON.parse(readFileSync(resolve(ROOT, 'scripts/critter-recipes', `${id}.json`), 'utf8')).textures?.grade ?? [];
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(resolve(ROOT, 'public/models/critters', `${id}.glb`));
  const textures = new Set(doc.getRoot().listMaterials().map((m) => m.getBaseColorTexture()).filter(Boolean));
  for (const tex of textures) {
    const { png, report } = await gradeImage(tex.getImage(), ops);
    tex.setImage(png).setMimeType('image/png');
    for (const line of report) console.log(`  ${line}`);
    if (opt('png')) writeFileSync(resolve(opt('png')), png);
  }
  if (opt('out')) {
    writeFileSync(resolve(opt('out')), await io.writeBinary(doc));
    console.log(`→ ${opt('out')}`);
  }
}
