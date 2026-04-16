// ---------------------------------------------------------------------------
// Server-side arena collapse simulation (Bloque B 3a)
// ---------------------------------------------------------------------------
//
// Authoritative collapse timeline. Replicates the client's src/arena.ts logic
// WITHOUT Three.js — pure numeric state. The client stops driving its own
// timer in online mode and instead mirrors three fields from the server:
//
//   - arenaRadius       (current standable radius, used for falloff)
//   - arenaCollapsedRings (how many rings have fully disappeared)
//   - warningRingIndex    (-1, or the index of the ring blinking red)
//
// Ring index convention matches the client: 0 = innermost, ringCount-1 =
// outermost. Collapses always start from the outermost still-standing ring.
// ---------------------------------------------------------------------------

import { SIM } from './config.js';

interface WarningState {
  /** Index in the original rings array — 0=innermost, ringCount-1=outermost. */
  ringIndex: number;
  /** Seconds remaining until this ring actually disappears. */
  timer: number;
}

export class ArenaSim {
  readonly maxRadius: number;
  readonly ringCount: number;
  readonly ringWidth: number;
  readonly warningDuration: number;

  currentRadius: number;
  /** Rings scheduled for collapse so far (includes those currently warning). */
  private collapseIndex: number = 0;
  private collapseTimer: number = 0;
  private warnings: WarningState[] = [];

  constructor(
    maxRadius: number = SIM.arena.radius,
    ringCount: number = SIM.arena.collapseRings,
    warningDuration: number = SIM.arena.warningDuration,
  ) {
    this.maxRadius = maxRadius;
    this.ringCount = ringCount;
    this.ringWidth = maxRadius / ringCount;
    this.warningDuration = warningDuration;
    this.currentRadius = maxRadius;
  }

  /** Rings that have already fully disappeared (not the ones currently warning). */
  get collapsedRings(): number {
    return this.collapseIndex - this.warnings.length;
  }

  /**
   * Index of the ring currently warning (blinking red) or -1 if none.
   * Only one ring warns at a time in Bloque B 3a since collapseInterval
   * (20s) is always greater than warningDuration (1.5s). If multiple ever
   * overlap we return the outermost, matching the "most urgent" semantics.
   */
  get warningRingIndex(): number {
    if (this.warnings.length === 0) return -1;
    let maxIdx = this.warnings[0].ringIndex;
    for (let i = 1; i < this.warnings.length; i++) {
      if (this.warnings[i].ringIndex > maxIdx) maxIdx = this.warnings[i].ringIndex;
    }
    return maxIdx;
  }

  /**
   * Advance simulation by dt seconds. Schedules a new collapse when the
   * interval elapses and finalises any warnings whose timer has expired.
   */
  tick(dt: number, intervalSec: number = SIM.match.collapseInterval): void {
    this.collapseTimer += dt;
    if (this.collapseTimer >= intervalSec) {
      this.collapseTimer = 0;
      this.scheduleNextCollapse();
    }

    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.timer -= dt;
      if (w.timer <= 0) {
        this.currentRadius = Math.max(0, this.currentRadius - this.ringWidth);
        this.warnings.splice(i, 1);
      }
    }
  }

  /** Schedule the next outer ring for collapse. Returns false when all gone. */
  private scheduleNextCollapse(): boolean {
    if (this.collapseIndex >= this.ringCount) return false;
    const outerIdx = this.ringCount - 1 - this.collapseIndex;
    this.warnings.push({ ringIndex: outerIdx, timer: this.warningDuration });
    this.collapseIndex++;
    return true;
  }

  /** Reset to the initial state (full arena, no warnings, timer zeroed). */
  reset(): void {
    this.collapseIndex = 0;
    this.collapseTimer = 0;
    this.currentRadius = this.maxRadius;
    this.warnings.length = 0;
  }
}
