// ---------------------------------------------------------------------------
// Server-side arena simulation (Bloque B 3b — irregular fragments)
// ---------------------------------------------------------------------------
// Authoritative collapse timeline driven by a deterministic seed. Both
// clients generate the identical layout from the same seed; the server only
// broadcasts: seed, collapseLevel (completed batches), warningBatch (-1 or
// current batch index), and an approximate radius for quick checks.
// ---------------------------------------------------------------------------

import { generateArenaLayout, isPointOnArena, pointInFragment, FRAG,
         type ArenaLayout } from './arena-fragments.js';

export class ArenaSim {
  readonly seed: number;
  private layout: ArenaLayout;
  private alive: boolean[];

  // Collapse progression
  private level = 0;               // completed batches
  private timer = 0;               // time accumulator (since match start or last batch)
  private warningActive = false;
  private warningTimer = 0;

  constructor(seed: number) {
    this.seed = seed;
    this.layout = generateArenaLayout(seed);
    this.alive = this.layout.fragments.map(() => true);
  }

  // --- Getters for state sync -------------------------------------------

  /** How many batches have fully collapsed (0 .. batches.length). */
  get collapseLevel(): number { return this.level; }

  /** Batch index currently warning (-1 if none). */
  get warningBatch(): number {
    return this.warningActive ? this.level : -1;
  }

  /**
   * Approximate current playable radius — max outer edge of alive non-immune
   * fragments. Used as a fast bounding-box check before the expensive
   * per-fragment test, and synced to clients for camera framing.
   */
  get currentRadius(): number {
    let maxR = this.layout.immuneRadius;
    for (let i = 0; i < this.layout.fragments.length; i++) {
      if (this.alive[i] && !this.layout.fragments[i].immune) {
        maxR = Math.max(maxR, this.layout.fragments[i].outerR);
      }
    }
    return maxR;
  }

  /**
   * Playable radius IN ONE DIRECTION — max outer edge of the alive
   * non-immune fragments whose arc contains `angle` (radians, world atan2
   * convention: 0 = +X).
   *
   * 2026-09-06 (terreno v2 fase 0.5): `currentRadius` es el máximo GLOBAL,
   * así que en un colapso por eje se queda en 12 mientras siga vivo un
   * solo sector exterior, aunque medio disco haya desaparecido. Todo el que
   * pregunta "¿cuánto suelo me queda?" desde una posición concreta
   * necesita el radio de SU dirección, no el del disco entero.
   *
   * Mismo código en `src/arena.ts` (clase Arena) — la copia visual no puede
   * importar de aquí; ver la nota de espejos en `arena-fragments.ts`.
   */
  radiusAt(angle: number): number {
    let maxR = this.layout.immuneRadius;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    for (let i = 0; i < this.layout.fragments.length; i++) {
      const f = this.layout.fragments[i];
      if (!this.alive[i] || f.immune) continue;
      if (maxR >= f.outerR) continue;
      // Un punto justo dentro del borde exterior basta para saber si el
      // sector cubre este ángulo (los sectores son anulares).
      const probe = f.outerR - 0.001;
      if (pointInFragment(x * probe, z * probe, f)) maxR = f.outerR;
    }
    return maxR;
  }

  // --- Simulation -------------------------------------------------------

  tick(dt: number): void {
    if (this.level >= this.layout.batches.length) return; // all collapsed

    this.timer += dt;

    if (this.warningActive) {
      this.warningTimer -= dt;
      if (this.warningTimer <= 0) {
        // Collapse the batch
        const batch = this.layout.batches[this.level];
        for (const idx of batch.indices) this.alive[idx] = false;
        this.level++;
        this.warningActive = false;
        this.timer = 0; // reset for next batch delay
      }
    } else {
      // Check if it's time to start next warning
      const batch = this.layout.batches[this.level];
      if (this.timer >= batch.delay) {
        this.warningActive = true;
        this.warningTimer = FRAG.warningDuration;
      }
    }
  }

  // --- Spatial queries --------------------------------------------------

  /** True if (x, z) stands on any alive fragment or the immune center. */
  isOnArena(x: number, z: number): boolean {
    return isPointOnArena(x, z, this.layout.fragments, this.alive);
  }

  /**
   * 2026-04-30 final-polish — Sihans Sinkhole real-hole support.
   * Find every alive non-immune fragment whose centroid lies inside
   * the (cx, cz, r) disc. Centroid (band-mid × angle-mid) is the
   * conservative pick — fragments only fully under the hole are
   * eligible. Used by `applyAbilityEffectIfAny` so the server can
   * pre-select knock-out candidates and broadcast their indices to
   * clients.
   */
  getAliveFragmentsInDisc(cx: number, cz: number, r: number): number[] {
    const r2 = r * r;
    const out: number[] = [];
    for (let i = 0; i < this.layout.fragments.length; i++) {
      const f = this.layout.fragments[i];
      if (!f || f.immune) continue;
      if (!this.alive[i]) continue;
      const midR = (f.innerR + f.outerR) * 0.5;
      const midA = (f.startAngle + f.endAngle) * 0.5;
      const fx = Math.cos(midA) * midR;
      const fz = Math.sin(midA) * midR;
      const dx = fx - cx;
      const dz = fz - cz;
      if (dx * dx + dz * dz <= r2) out.push(i);
    }
    return out;
  }

  /**
   * Mark the given fragment indices as dead. Skips already-dead and
   * immune fragments defensively. Returns the indices that were
   * actually killed (for the broadcast payload — clients only need
   * to apply the same change locally).
   */
  killFragmentIndices(indices: number[]): number[] {
    const killed: number[] = [];
    for (const idx of indices) {
      const f = this.layout.fragments[idx];
      if (!f || f.immune) continue;
      if (!this.alive[idx]) continue;
      this.alive[idx] = false;
      killed.push(idx);
    }
    return killed;
  }

  reset(): void {
    this.layout = generateArenaLayout(this.seed);
    this.alive = this.layout.fragments.map(() => true);
    this.level = 0;
    this.timer = 0;
    this.warningActive = false;
    this.warningTimer = 0;
  }
}
