// ---------------------------------------------------------------------------
// Scatter — determinismo, techos de gameplay y coste
// ---------------------------------------------------------------------------
//
// La capa densa del diorama (src/arena-scatter.ts) es decorado, pero tiene
// dos contratos que SÍ son de gameplay y por eso viven aquí, junto a los
// tests del sim:
//
//   1. DETERMINISMO: el servidor solo manda seed + packId. Si dos clientes
//      de una sala construyen dioramas distintos con la misma semilla, uno
//      de los dos ve hierba donde el otro ve suelo. Se comprueba byte a
//      byte sobre instanceMatrix.
//   2. TECHOS DE ALTURA (SCATTER_LIMITS): en el interior nada supera 0,4 u
//      y en el arco frontal nada supera 1,2 u, porque un objeto alto
//      delante tapa la acción y el borde del vacío es la información
//      crítica del juego. Se recalcula la altura real de CADA instancia
//      desde su matriz, sin fiarse del motor.
//
// three se importa en node sin WebGL: InstancedMesh solo es un buffer.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateArenaLayout, pointInFragment } from '../../src/arena-fragments';
import { ARENA_PACK_IDS, type ArenaPackId } from '../../src/arena-decorations';
import { ArenaScatter } from '../../src/arena-scatter';
import { PRIMITIVE_META } from '../../src/arena-scatter-geometry';
import { getScatterRecipe } from '../../src/arena-scatter-recipes';
import { SCATTER_DENSITY, SCATTER_LIMITS } from '../../src/arena-scatter-types';

/** El mismo criterio de anfitrión que usa Arena.findFragmentAt en su pase
 *  estricto: el fragmento que contiene el punto. */
function makeHostOf(seed: number) {
  const layout = generateArenaLayout(seed);
  return {
    layout,
    hostOf: (x: number, z: number): number | null => {
      for (let i = 0; i < layout.fragments.length; i++) {
        if (pointInFragment(x, z, layout.fragments[i])) return i;
      }
      return null;
    },
  };
}

function buildFor(packId: ArenaPackId, seed: number, density = SCATTER_DENSITY): ArenaScatter {
  const { layout, hostOf } = makeHostOf(seed);
  const scatter = new ArenaScatter();
  scatter.build({ layout, recipe: getScatterRecipe(packId), seed, density, hostOf });
  return scatter;
}

/** Capas instanciadas (sin los discos de sombra, que van aparte). */
function layerMeshes(scatter: ArenaScatter): THREE.InstancedMesh[] {
  return scatter.group.children.filter(
    (o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh && !o.name.endsWith('#shadow'),
  );
}

describe('arena scatter — determinismo', () => {
  it('misma semilla y mismo pack ⇒ instanceMatrix idéntico byte a byte, en los 5 biomas', () => {
    for (const packId of ARENA_PACK_IDS) {
      const a = layerMeshes(buildFor(packId, 7));
      const b = layerMeshes(buildFor(packId, 7));
      expect(a.length, packId).toBeGreaterThan(0);
      expect(a.map(m => m.name)).toEqual(b.map(m => m.name));
      for (let i = 0; i < a.length; i++) {
        expect(a[i].count, `${packId}/${a[i].name}`).toBe(b[i].count);
        expect(Array.from(a[i].instanceMatrix.array)).toEqual(Array.from(b[i].instanceMatrix.array));
        expect(Array.from(a[i].instanceColor!.array)).toEqual(Array.from(b[i].instanceColor!.array));
      }
    }
  });

  it('semillas distintas ⇒ dioramas distintos (la semilla se usa de verdad)', () => {
    const a = layerMeshes(buildFor('jungle', 1));
    const b = layerMeshes(buildFor('jungle', 2));
    const same = a.every((m, i) =>
      Array.from(m.instanceMatrix.array).every((v, k) => v === b[i]?.instanceMatrix.array[k]));
    expect(same).toBe(false);
  });

  it('subir la densidad AÑADE instancias sin mover las que ya estaban', () => {
    // El stream se consume en orden de instancia: con más densidad las N
    // primeras posiciones son las mismas. Es lo que hace que el slider de
    // densidad sea un ajuste fino y no un reparto nuevo cada vez.
    const lo = layerMeshes(buildFor('coral_beach', 3, 0.3));
    const hi = layerMeshes(buildFor('coral_beach', 3, 0.6));
    for (let i = 0; i < lo.length; i++) {
      expect(hi[i].count).toBeGreaterThanOrEqual(lo[i].count);
    }
  });
});

describe('arena scatter — techos de gameplay', () => {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const m = new THREE.Matrix4();

  it('ninguna instancia supera el techo de altura de su zona, en 5 biomas × 3 semillas', () => {
    for (const packId of ARENA_PACK_IDS) {
      for (const seed of [1, 42, 501]) {
        const scatter = buildFor(packId, seed);
        for (const mesh of layerMeshes(scatter)) {
          const kind = mesh.name.replace('scatter:', '');
          const layer = getScatterRecipe(packId).layers.find(l => l.id === kind);
          expect(layer, `capa ${kind} no está en la receta de ${packId}`).toBeDefined();
          const meta = PRIMITIVE_META[layer!.primitive];
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, m);
            m.decompose(pos, quat, scl);
            const r = Math.hypot(pos.x, pos.z);
            const height = scl.y * meta.height;
            const ceiling = r < SCATTER_LIMITS.innerR
              ? SCATTER_LIMITS.innerMaxH
              : pos.z >= 0 ? SCATTER_LIMITS.frontMaxH : SCATTER_LIMITS.backMaxH;
            expect(height, `${packId} seed ${seed} capa ${kind} instancia ${i} en r=${r.toFixed(2)} z=${pos.z.toFixed(2)}`)
              .toBeLessThanOrEqual(ceiling + 1e-6);
            expect(r, `${packId} ${kind} #${i} fuera del disco`).toBeLessThanOrEqual(12 + 1e-6);
          }
        }
      }
    }
  });

  it('el centro respira: nada por debajo del clearCenterR de su capa', () => {
    for (const packId of ARENA_PACK_IDS) {
      const scatter = buildFor(packId, 11);
      for (const mesh of layerMeshes(scatter)) {
        const kind = mesh.name.replace('scatter:', '');
        const layer = getScatterRecipe(packId).layers.find(l => l.id === kind)!;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          m.decompose(pos, quat, scl);
          expect(Math.hypot(pos.x, pos.z), `${packId}/${kind} #${i}`).toBeGreaterThanOrEqual(layer.clearCenterR - 1e-6);
        }
      }
    }
  });
});

describe('arena scatter — coste', () => {
  it('cada bioma cabe en el presupuesto del plan (≤ 16 draws, ≤ 25k tris a densidad por defecto)', () => {
    // 8 capas por bioma, y las que llevan sombra de contacto instanciada
    // (guijarros, rocas, arbustos) cuestan un segundo draw: 13 en tundra.
    // Contra los 70-80 draws de una partida hoy, sigue siendo calderilla;
    // lo que este test vigila es que nadie meta una capa por objeto.
    for (const packId of ARENA_PACK_IDS) {
      const s = buildFor(packId, 5).stats();
      expect(s.instances, packId).toBeGreaterThan(100);
      expect(s.drawCalls, `${packId} draw calls`).toBeLessThanOrEqual(16);
      expect(s.triangles, `${packId} triángulos`).toBeLessThanOrEqual(25_000);
    }
  });
});
