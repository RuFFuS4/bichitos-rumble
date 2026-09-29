// ---------------------------------------------------------------------------
// Fondo v2 — determinismo y contrato del cielo (docs/DIORAMAS.md §«Fondo v2» §9)
// ---------------------------------------------------------------------------
//
// El servidor solo manda seed + packId, y cada cliente construye su cielo.
// Si dos clientes de una sala lo construyen distinto, ven mundos distintos:
// cosmético, pero es justo lo que el determinismo del plan promete. Se
// comprueba byte a byte sobre `instanceMatrix` e `instanceColor` de cada
// malla, no sobre el hash (que resume la colocación, no los búferes).
//
// Y lo que el cielo promete sin mirar una imagen: 0 violaciones del pasillo
// del canto y ninguna geometría fuera de la cúpula (r 420 menos lo que se
// separa del origen la cámara de victoria, 16,5 u en horizontal y 2,5 de
// alto). Se mide en 3D: la cúpula es una esfera pegada a la cámara y las
// torres suben a y ≈ +33. La vida y la deriva se prueban en dos instantes:
// el reloj del fondo no puede romper la reproducibilidad.
//
// three se importa en node sin WebGL: InstancedMesh solo es un buffer.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArenaBackdrop } from '../../src/arena-backdrop';
import { ARENA_PACK_IDS, getPackCliff, getPackFogColor, getPackSky, type ArenaPackId } from '../../src/arena-decorations';
import { FRAG } from '../../src/arena-fragments';
import { BACKDROP_LOOK } from '../../src/arena-look';

const EXTENT_LIMIT = BACKDROP_LOOK.domeRadius - 16.5;
const REACH_LIMIT = BACKDROP_LOOK.domeRadius - Math.hypot(16.5, 2.5);

function build(pack: ArenaPackId, seed: number, time = 0): ArenaBackdrop {
  const b = new ArenaBackdrop();
  b.buildSky(getPackSky(pack), getPackFogColor(pack), getPackCliff(pack), seed, FRAG.maxRadius);
  b.setTime(time);
  return b;
}

/** Los búferes de instancias de cada malla, en orden, más la rotación de
 *  la deriva (lo que cambia con el reloj). */
function snapshot(b: ArenaBackdrop): Array<{ matrix: Float32Array; color: Float32Array | null; rotY: number }> {
  return b.group.children
    .filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh)
    .map((m) => ({
      matrix: new Float32Array(m.instanceMatrix.array),
      color: m.instanceColor ? new Float32Array(m.instanceColor.array) : null,
      rotY: m.rotation.y,
    }));
}

describe('fondo v2 — determinismo del cielo', () => {
  for (const pack of ARENA_PACK_IDS) {
    it(`${pack}: dos construcciones con la misma semilla dan los mismos búferes`, () => {
      for (const time of [0, 37.5]) {
        const a = snapshot(build(pack, 1, time));
        const b = snapshot(build(pack, 1, time));
        expect(a.length).toBeGreaterThan(0);
        expect(b.length).toBe(a.length);
        a.forEach((m, i) => {
          expect(Buffer.from(b[i]!.matrix.buffer).equals(Buffer.from(m.matrix.buffer))).toBe(true);
          expect(b[i]!.color === null).toBe(m.color === null);
          if (m.color) expect(Buffer.from(b[i]!.color!.buffer).equals(Buffer.from(m.color.buffer))).toBe(true);
          expect(b[i]!.rotY).toBe(m.rotY);
        });
      }
    });
  }

  it('otra semilla da otro cielo (el hash no es constante)', () => {
    expect(build('jungle', 1).stats()!.hash).not.toBe(build('jungle', 2).stats()!.hash);
  });
});

describe('fondo v2 — contrato sin imagen', () => {
  for (const pack of ARENA_PACK_IDS) {
    it(`${pack}: 0 violaciones del pasillo y todo dentro de la cúpula (semillas 1, 7, 42)`, () => {
      for (const seed of [1, 7, 42]) {
        const st = build(pack, seed).stats()!;
        expect(st.corridorViolations).toBe(0);
        expect(st.maxExtent).toBeLessThanOrEqual(EXTENT_LIMIT);
        expect(st.maxReach).toBeLessThanOrEqual(REACH_LIMIT);
      }
    });
  }
});
