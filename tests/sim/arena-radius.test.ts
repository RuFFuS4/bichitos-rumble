// ---------------------------------------------------------------------------
// Fase 5 (docs/ARENA_V2.md) — todo lo visual en función del radio
// ---------------------------------------------------------------------------
//
// Dos contratos:
//
//   1. Con el disco de hoy (R = 12) NADA cambia: k = R / 12 es exactamente
//      1 y la cámara, el frustum de sombra, el diorama y el sitio de los
//      props son los de siempre. Aquí se fija lo que se puede fijar en node
//      (la cámara, bit a bit); el resto lo prueban las capturas idénticas
//      píxel a píxel y el golden (BUILD_LOG, 2026-09-29).
//   2. Con un disco mayor (el perfil 8P de H6, r 16-17) la capa visual se
//      adapta sola: la cámara se aleja en la misma dirección, los props
//      cambian de sitio y no de tamaño, y el diorama cubre el disco nuevo
//      respetando los techos de gameplay con el interior escalado.
//
// El layout de R = 16 se fabrica escalando los radios de uno real: el
// generador todavía no tiene perfiles (eso es H6).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateArenaLayout, pointInFragment, type ArenaLayout } from '../../src/arena-fragments';
import { ARENA_PACK_IDS, getDecorFootprints } from '../../src/arena-decorations';
import { LOOK_REF_RADIUS, lookRadiusScale } from '../../src/arena-look';
import { ArenaScatter } from '../../src/arena-scatter';
import { PRIMITIVE_META } from '../../src/arena-scatter-geometry';
import { SCATTER_DENSITY, getScatterRecipe } from '../../src/arena-scatter-recipes';
import { SCATTER_LIMITS } from '../../src/arena-scatter-types';
import { GAMEPLAY_CAM_LOOKAT, GAMEPLAY_CAM_POSITION, gameplayCameraForRadius } from '../../src/camera';

function scaledLayout(seed: number, k: number): ArenaLayout {
  const l = generateArenaLayout(seed);
  return {
    ...l,
    maxRadius: l.maxRadius * k,
    immuneRadius: l.immuneRadius * k,
    fragments: l.fragments.map(f => ({ ...f, innerR: f.innerR * k, outerR: f.outerR * k })),
  };
}

function buildOn(layout: ArenaLayout, packId: (typeof ARENA_PACK_IDS)[number], seed: number): ArenaScatter {
  const hostOf = (x: number, z: number): number | null => {
    for (let i = 0; i < layout.fragments.length; i++) if (pointInFragment(x, z, layout.fragments[i])) return i;
    return null;
  };
  const scatter = new ArenaScatter();
  scatter.build({
    layout, recipe: getScatterRecipe(packId), seed, density: SCATTER_DENSITY, hostOf,
    props: getDecorFootprints(packId, lookRadiusScale(layout.maxRadius)),
  });
  return scatter;
}

describe('fase 5 — con el disco de hoy no cambia nada', () => {
  it('k = 1 exacto y la cámara de juego es la de siempre, bit a bit', () => {
    expect(LOOK_REF_RADIUS).toBe(12);
    expect(lookRadiusScale(generateArenaLayout(7).maxRadius)).toBe(1);
    const c = gameplayCameraForRadius(12);
    expect(c.position.toArray()).toEqual([0, 23, 25]);
    expect(c.lookAt.toArray()).toEqual([0, -3, 0]);
    expect(GAMEPLAY_CAM_POSITION.toArray()).toEqual([0, 23, 25]);
    expect(GAMEPLAY_CAM_LOOKAT.toArray()).toEqual([0, -3, 0]);
  });

  it('el sitio de los props con k = 1 es el del layout autorado', () => {
    for (const packId of ARENA_PACK_IDS) expect(getDecorFootprints(packId, 1)).toEqual(getDecorFootprints(packId));
  });
});

describe('fase 5 — un disco mayor (R = 16) se adapta solo', () => {
  const k = 16 / 12;

  it('la cámara se aleja en la misma dirección: el disco ocupa el mismo encuadre', () => {
    const a = gameplayCameraForRadius(12);
    const b = gameplayCameraForRadius(16);
    const da = a.lookAt.clone().sub(a.position);
    const db = b.lookAt.clone().sub(b.position);
    expect(db.length() / da.length()).toBeCloseTo(k, 12);
    expect(db.normalize().angleTo(da.normalize())).toBeLessThan(1e-7);
  });

  it('los props cambian de sitio y no de tamaño', () => {
    for (const packId of ARENA_PACK_IDS) {
      const a = getDecorFootprints(packId);
      const b = getDecorFootprints(packId, k);
      b.forEach((p, i) => {
        expect(p.x).toBeCloseTo(a[i]!.x * k, 9);
        expect(p.z).toBeCloseTo(a[i]!.z * k, 9);
        expect(p.radius).toBe(a[i]!.radius);
      });
    }
  });

  it('el diorama cubre el disco mayor, crece con él y respeta los techos con el interior escalado', () => {
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const packId of ARENA_PACK_IDS) {
      const big = scaledLayout(7, k);
      const scatter = buildOn(big, packId, 7);
      const base = buildOn(generateArenaLayout(7), packId, 7);
      expect(scatter.stats().instances, `${packId}: no crece`).toBeGreaterThan(base.stats().instances * 1.3);
      let beyondOld = 0;
      for (const mesh of scatter.group.children) {
        if (!(mesh instanceof THREE.InstancedMesh) || mesh.name.endsWith('#shadow')) continue;
        const layer = getScatterRecipe(packId).layers.find(l => `scatter:${l.id}` === mesh.name)!;
        const meta = PRIMITIVE_META[layer.primitive];
        const a = mesh.instanceMatrix.array;
        for (let i = 0; i < mesh.count; i++) {
          let hidden = true;
          for (let j = i * 16; j < i * 16 + 16; j++) if (a[j] !== 0) { hidden = false; break; }
          if (hidden) continue;
          mesh.getMatrixAt(i, m);
          m.decompose(pos, quat, scl);
          const r = Math.hypot(pos.x, pos.z);
          expect(r, `${packId}/${layer.id} fuera del disco`).toBeLessThanOrEqual(big.maxRadius + 1e-6);
          if (r > 12) beyondOld++;
          const ceiling = r < SCATTER_LIMITS.innerR * k
            ? SCATTER_LIMITS.innerMaxH
            : pos.z >= 0 ? SCATTER_LIMITS.frontMaxH : SCATTER_LIMITS.backMaxH;
          expect(scl.y * meta.height, `${packId}/${layer.id} #${i} r=${r.toFixed(2)}`).toBeLessThanOrEqual(ceiling + 1e-6);
        }
      }
      expect(beyondOld, `${packId}: nada vive en la corona nueva (r > 12)`).toBeGreaterThan(0);
    }
  });
});
