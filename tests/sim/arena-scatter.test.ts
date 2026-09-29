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
import { ARENA_PACK_IDS, getDecorFootprints, type ArenaPackId } from '../../src/arena-decorations';
import { DECOR_TYPES } from '../../src/arena-decor-layouts';
import { ArenaScatter } from '../../src/arena-scatter';
import { PRIMITIVE_META } from '../../src/arena-scatter-geometry';
import { SCATTER_DENSITY, getScatterRecipe } from '../../src/arena-scatter-recipes';
import { SCATTER_LIMITS } from '../../src/arena-scatter-types';

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

/** Con los props del pack (layout + huella medida), como Arena: así las
 *  capas 'props' entran en todos los contratos de este fichero. */
function buildFor(packId: ArenaPackId, seed: number, density = SCATTER_DENSITY): ArenaScatter {
  const { layout, hostOf } = makeHostOf(seed);
  const scatter = new ArenaScatter();
  scatter.build({ layout, recipe: getScatterRecipe(packId), seed, density, hostOf, props: getDecorFootprints(packId) });
  return scatter;
}

/** Instancia oculta (escala 0): el fleco latente antes de que un colapso
 *  lo destape. `decompose` de una matriz nula devuelve escala 1, así que
 *  hay que saltarla a mano. */
function isHidden(mesh: THREE.InstancedMesh, i: number): boolean {
  const a = mesh.instanceMatrix.array;
  for (let k = i * 16; k < i * 16 + 16; k++) if (a[k] !== 0) return false;
  return true;
}

/** Destapa todo el fleco latente, como si hubieran caído todos los
 *  sectores (anfitriones en su sitio: matriz identidad). */
function revealAll(scatter: ArenaScatter, fragments: number): void {
  const id = new THREE.Matrix4();
  for (let f = 0; f < fragments; f++) scatter.revealEdges(f, () => id);
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

  it('ninguna instancia supera el techo de altura de su zona, en 5 biomas × 3 semillas (con el fleco latente destapado)', () => {
    for (const packId of ARENA_PACK_IDS) {
      for (const seed of [1, 42, 501]) {
        const scatter = buildFor(packId, seed);
        revealAll(scatter, generateArenaLayout(seed).fragments.length);
        for (const mesh of layerMeshes(scatter)) {
          const kind = mesh.name.replace('scatter:', '');
          const layer = getScatterRecipe(packId).layers.find(l => l.id === kind);
          expect(layer, `capa ${kind} no está en la receta de ${packId}`).toBeDefined();
          const meta = PRIMITIVE_META[layer!.primitive];
          for (let i = 0; i < mesh.count; i++) {
            if (isHidden(mesh, i)) continue;
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
          if (isHidden(mesh, i)) continue;
          mesh.getMatrixAt(i, m);
          m.decompose(pos, quat, scl);
          expect(Math.hypot(pos.x, pos.z), `${packId}/${kind} #${i}`).toBeGreaterThanOrEqual(layer.clearCenterR - 1e-6);
        }
      }
    }
  });
});

describe('arena scatter — el fleco se regenera (slice 2)', () => {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const m = new THREE.Matrix4();

  it('el fleco latente nace oculto y un colapso destapa solo el borde que descubre', () => {
    const seed = 7;
    const { layout, hostOf } = makeHostOf(seed);
    const scatter = new ArenaScatter();
    scatter.build({ layout, recipe: getScatterRecipe('jungle'), seed, density: SCATTER_DENSITY, hostOf });
    const latent0 = scatter.stats().layers.reduce((a, l) => a + l.latent, 0);
    expect(latent0, 'jungle lleva fleco latente').toBeGreaterThan(0);

    // Cae un sector de la banda exterior: se destapa fleco, todo en la
    // banda de dentro y pegado a su arco exterior (r ≈ 8,5).
    const outerBand = Math.max(...layout.fragments.map(f => f.band));
    const fallen = layout.fragments.findIndex(f => f.band === outerBand);
    const id = new THREE.Matrix4();
    const before = new Map(layerMeshes(scatter).map(mesh => [mesh.name, Float32Array.from(mesh.instanceMatrix.array)]));
    scatter.revealEdges(fallen, () => id);
    const latent1 = scatter.stats().layers.reduce((a, l) => a + l.latent, 0);
    expect(latent1).toBeLessThan(latent0);
    const f = layout.fragments[fallen]!;
    let shown = 0;
    for (const mesh of layerMeshes(scatter)) {
      const prev = before.get(mesh.name)!;
      for (let i = 0; i < mesh.count; i++) {
        const was = prev.slice(i * 16, i * 16 + 16).every(v => v === 0);
        if (!was || isHidden(mesh, i)) continue;
        shown++;
        mesh.getMatrixAt(i, m);
        m.decompose(pos, quat, scl);
        const r = Math.hypot(pos.x, pos.z);
        expect(r).toBeLessThan(f.innerR + 1e-6);
        expect(r).toBeGreaterThan(f.innerR - 1);
        // Dentro del arco angular del sector caído (con el desborde del
        // racimo, que puede pasar un poco al vecino).
        const host = hostOf(pos.x * (f.innerR + 0.05) / r, pos.z * (f.innerR + 0.05) / r);
        expect(host, `instancia ${mesh.name} #${i} destapada por ${fallen}`).toBe(fallen);
      }
    }
    expect(shown).toBe(latent0 - latent1);
    // Destaparlo otra vez no cambia nada.
    const snap = layerMeshes(scatter).map(mesh => Float32Array.from(mesh.instanceMatrix.array));
    scatter.revealEdges(fallen, () => id);
    layerMeshes(scatter).forEach((mesh, k) => expect(Array.from(mesh.instanceMatrix.array)).toEqual(Array.from(snap[k]!)));
  });

  it('si el anfitrión ya no está en pie, su fleco sigue oculto', () => {
    const seed = 7;
    const { layout, hostOf } = makeHostOf(seed);
    const scatter = new ArenaScatter();
    scatter.build({ layout, recipe: getScatterRecipe('jungle'), seed, density: SCATTER_DENSITY, hostOf });
    const latent0 = scatter.stats().layers.reduce((a, l) => a + l.latent, 0);
    for (let f = 0; f < layout.fragments.length; f++) scatter.revealEdges(f, () => null);
    expect(scatter.stats().layers.reduce((a, l) => a + l.latent, 0)).toBe(latent0);
  });
});

describe('arena scatter — al pie de los props (slice 2, cohesión)', () => {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const m = new THREE.Matrix4();

  it('cada capa \'props\' tiene a quién vestir: sus tipos existen y están en el layout del pack', () => {
    let layers = 0;
    for (const packId of ARENA_PACK_IDS) {
      const present = new Set(getDecorFootprints(packId).map(p => p.type));
      for (const layer of getScatterRecipe(packId).layers) {
        if (layer.anchor !== 'props') continue;
        layers++;
        expect(layer.near?.length, `${packId}/${layer.id} sin near`).toBeGreaterThan(0);
        for (const t of layer.near!) expect(DECOR_TYPES[t], `${packId}/${layer.id}: tipo ${t}`).toBeDefined();
        expect(layer.near!.some(t => present.has(t)), `${packId}/${layer.id}: ningún prop de su near en el layout`).toBe(true);
      }
    }
    expect(layers).toBeGreaterThanOrEqual(10);
  });

  it('cada instancia cae en la corona [faldón + rMin, faldón + rMax] de un prop de su filtro', () => {
    for (const packId of ARENA_PACK_IDS) {
      const props = getDecorFootprints(packId);
      const scatter = buildFor(packId, 7);
      for (const mesh of layerMeshes(scatter)) {
        const layer = getScatterRecipe(packId).layers.find(l => `scatter:${l.id}` === mesh.name)!;
        if (layer.anchor !== 'props') continue;
        expect(mesh.count, `${packId}/${layer.id} vacía`).toBeGreaterThan(0);
        const hosts = props.filter(p => layer.near!.includes(p.type) && (layer.arc !== 'back' || p.z < 0));
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          m.decompose(pos, quat, scl);
          const ok = hosts.some(p => {
            const d = Math.hypot(pos.x - p.x, pos.z - p.z);
            return d >= p.radius + layer.rMin - 1e-6 && d <= p.radius + layer.rMax + 1e-6;
          });
          expect(ok, `${packId}/${layer.id} #${i} en (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) lejos de sus props`).toBe(true);
        }
      }
    }
  });

  it('sin props, las capas \'props\' no salen y el resto del diorama es el mismo byte a byte', () => {
    for (const packId of ARENA_PACK_IDS) {
      const seed = 7;
      const { layout, hostOf } = makeHostOf(seed);
      const bare = new ArenaScatter();
      bare.build({ layout, recipe: getScatterRecipe(packId), seed, density: SCATTER_DENSITY, hostOf });
      const full = buildFor(packId, seed);
      const byName = new Map(layerMeshes(full).map(mesh => [mesh.name, mesh]));
      const propsIds = new Set(getScatterRecipe(packId).layers.filter(l => l.anchor === 'props').map(l => `scatter:${l.id}`));
      for (const mesh of layerMeshes(bare)) {
        expect(propsIds.has(mesh.name), `${packId}: ${mesh.name} salió sin props`).toBe(false);
        expect(Array.from(mesh.instanceMatrix.array), `${packId}/${mesh.name}`)
          .toEqual(Array.from(byName.get(mesh.name)!.instanceMatrix.array));
      }
    }
  });
});

describe('arena scatter — coste', () => {
  it('cada bioma cabe en el presupuesto del plan (≤ 16 draws, ≤ 25k tris a densidad por defecto)', () => {
    // 8-11 capas por bioma (slice 2 suma las de al pie de los props), y
    // las que llevan sombra de contacto instanciada cuestan un segundo
    // draw: 12 en los cinco.
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
