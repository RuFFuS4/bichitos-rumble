// ---------------------------------------------------------------------------
// DevApi — internal control layer for /tools.html
// ---------------------------------------------------------------------------
//
// Wraps the Game instance + renderer with a single narrow surface the
// lab UI can use. Keeps `Game` from growing a pile of debug* methods by
// centralising new inspection and mutation capabilities here.
//
// Design rules:
//   - READ operations return plain value snapshots (no live references
//     to engine internals). If the UI wants to display live data, it
//     polls. This avoids leaking mutable handles.
//   - WRITE operations are explicit, scoped, and reversible where
//     possible. No bulk "reset everything" that could nuke state.
//   - Event capture is done by polling state transitions, not by
//     patching the game. Zero coupling back into engine code.
//   - Nothing in this file is ever imported by the normal game entry
//     (`src/main.ts`). It's consumed only by /tools.html.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import type { Game } from '../game';
import type { Critter, BotBehaviourTag } from '../critter';
import type { AbilityType } from '../abilities';
import {
  clearAllHeldInputs,
  getHeldActionsSnapshot,
  getHeldKeyCodes,
  getMoveVector,
} from '../input';

export type { BotBehaviourTag } from '../critter';

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

export interface PlayerSnapshot {
  name: string;
  role: string;
  pos: { x: number; z: number };
  vel: { x: number; z: number };
  alive: boolean;
  lives: number;
  falling: boolean;
  immunityLeft: number;
  headbuttCooldown: number;
  abilities: AbilitySnapshot[];
}

export interface AbilitySnapshot {
  name: string;
  type: AbilityType;
  ready: boolean;
  active: boolean;
  cooldownLeft: number;
  windUpLeft: number;
  durationLeft: number;
  cooldown: number;       // full cooldown from the def (for progress bars)
}

export interface BotSnapshot {
  index: number;      // index in game.critters (player is 0, bots start at 1)
  name: string;
  alive: boolean;
  behaviour: BotBehaviourTag;
  pos: { x: number; z: number };
}

export interface PerfSnapshot {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  critters: number;
  arenaFragmentsAlive: number;
  arenaFragmentsTotal: number;
}

export interface InputSnapshot {
  keyboard: { code: string }[];            // currently held key codes
  move: { x: number; z: number };          // last reported move vector
  held: { headbutt: boolean; ability1: boolean; ability2: boolean; ultimate: boolean };
  gamepads: { index: number; id: string; connected: boolean }[];
}

export type EventType =
  | 'headbutt'
  | 'ability_cast'
  | 'ability_end'
  | 'fall'
  | 'respawn'
  | 'eliminate'
  | 'collapse_warn'
  | 'collapse_batch'
  | 'match_started'
  | 'match_ended';

export interface GameplayEvent {
  t: number;             // performance.now() at emit
  type: EventType;
  actor?: string;        // critter name or 'arena'
  details?: string;      // free-form
}

// ---------------------------------------------------------------------------
// DevApi
// ---------------------------------------------------------------------------

export class DevApi {
  private botOverrides = new Map<number, BotBehaviourTag>();
  private eventLog: GameplayEvent[] = [];
  private readonly MAX_EVENTS = 60;

  // Edge-detection memory for event polling
  private lastHeadbutt = new WeakMap<Critter, boolean>();
  private lastFalling = new WeakMap<Critter, boolean>();
  private lastAlive = new WeakMap<Critter, boolean>();
  private lastAbilityActive = new WeakMap<Critter, boolean[]>();
  private lastCollapseLevel = -1;
  private lastWarningBatch = -2;
  private lastServerPhase = '';

  // Perf sampling
  private fpsSamples: number[] = [];
  private readonly FPS_WINDOW = 30; // samples (~0.5s at 60fps)
  private lastPerf: PerfSnapshot = {
    fps: 0, frameMs: 0, drawCalls: 0, triangles: 0,
    geometries: 0, textures: 0, critters: 0,
    arenaFragmentsAlive: 0, arenaFragmentsTotal: 0,
  };

  constructor(public readonly game: Game, private readonly renderer: THREE.WebGLRenderer) {}

  // -------------------------------------------------------------------------
  // Match control — thin wrappers over Game's existing debug* methods.
  // Bot overrides reset on a new match so each run starts clean.
  // -------------------------------------------------------------------------

  startMatch(player: string, bots: string[], opts: { seed?: number } = {}): void {
    this.game.debugStartOfflineMatch(player, bots, opts);
    this.botOverrides.clear();
    this.resetEventMemory();
    this.pushEvent('match_started', 'lab', `${player} vs ${bots.join(', ') || '(solo)'}`);
  }

  endMatch(): void {
    this.game.debugEndMatchImmediately();
    this.botOverrides.clear();
  }

  forceSeed(seed: number): void {
    this.game.debugForceArenaSeed(seed);
  }

  setSpeed(scale: number): void {
    this.game.debugSpeedScale = scale;
  }

  getSpeed(): number {
    return this.game.debugSpeedScale;
  }

  // -------------------------------------------------------------------------
  // Read-only snapshots
  // -------------------------------------------------------------------------

  getArenaInfo() { return this.game.debugGetArenaInfo(); }

  getPlayerSnapshot(): PlayerSnapshot | null {
    const p = this.game.player;
    if (!p) return null;
    return {
      name: p.config.name,
      role: p.config.role,
      pos: { x: p.x, z: p.z },
      vel: { x: p.vx, z: p.vz },
      alive: p.alive,
      lives: p.lives,
      falling: p.falling,
      immunityLeft: p.immunityTimer,
      headbuttCooldown: p.headbuttCooldown,
      abilities: p.abilityStates.map(s => ({
        name: s.def.name,
        type: s.def.type,
        ready: s.cooldownLeft <= 0 && !s.active,
        active: s.active,
        cooldownLeft: s.cooldownLeft,
        windUpLeft: s.windUpLeft,
        durationLeft: s.durationLeft,
        cooldown: s.def.cooldown,
      })),
    };
  }

  getBotSnapshots(): BotSnapshot[] {
    const out: BotSnapshot[] = [];
    for (let i = 0; i < this.game.critters.length; i++) {
      if (i === 0) continue; // skip player (assume playerIndex=0)
      const c = this.game.critters[i];
      out.push({
        index: i,
        name: c.config.name,
        alive: c.alive,
        behaviour: this.botOverrides.get(i) ?? c.debugBotBehaviour,
        pos: { x: c.x, z: c.z },
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Bot behaviour control — writes directly to Critter.debugBotBehaviour.
  // That field is read each frame inside bot.ts without any other hooks.
  // -------------------------------------------------------------------------

  setBotBehaviour(index: number, b: BotBehaviourTag): void {
    const c = this.game.critters[index];
    if (!c) return;
    c.debugBotBehaviour = b;
    this.botOverrides.set(index, b);
  }

  setAllBotsBehaviour(b: BotBehaviourTag): void {
    for (let i = 1; i < this.game.critters.length; i++) {
      this.setBotBehaviour(i, b);
    }
  }

  // -------------------------------------------------------------------------
  // Gameplay helpers
  // -------------------------------------------------------------------------

  /** Reset the local player's cooldowns (headbutt + all abilities). */
  resetPlayerCooldowns(): void {
    const p = this.game.player;
    if (!p) return;
    p.headbuttCooldown = 0;
    for (const s of p.abilityStates) s.cooldownLeft = 0;
  }

  /**
   * Force the local player to fire an ability RIGHT NOW.
   * Bypasses cooldown. Uses the existing updateAbilities tick to fire the
   * effect on the next frame (needs scene, which only that tick has).
   */
  forceAbility(slotIndex: number): void {
    const p = this.game.player;
    if (!p) return;
    const s = p.abilityStates[slotIndex];
    if (!s) return;
    s.cooldownLeft = 0;
    s.active = true;
    s.windUpLeft = s.def.windUp;
    s.durationLeft = s.def.duration;
    s.effectFired = false;
    this.pushEvent('ability_cast', p.config.name, `forced: ${s.def.name}`);
  }

  teleportPlayer(x: number, z: number): void {
    const p = this.game.player;
    if (!p) return;
    p.x = x;
    p.z = z;
    p.vx = 0;
    p.vz = 0;
    clearAllHeldInputs();
  }

  /** Scatter the bots to a preset layout. Useful to reproduce specific
   *  spatial configurations. */
  teleportBotsPreset(preset: 'center' | 'corners' | 'line' | 'bunch'): void {
    const bots = this.game.critters.filter((_, i) => i !== 0 && this.game.critters[i].alive);
    if (bots.length === 0) return;
    const positions = this.computePresetPositions(preset, bots.length);
    bots.forEach((b, i) => {
      const p = positions[i];
      b.x = p.x;
      b.z = p.z;
      b.vx = 0;
      b.vz = 0;
    });
  }

  private computePresetPositions(preset: 'center' | 'corners' | 'line' | 'bunch', n: number) {
    switch (preset) {
      case 'center':
        return Array.from({ length: n }, (_, i) => ({
          x: Math.cos((i / n) * Math.PI * 2) * 0.6,
          z: Math.sin((i / n) * Math.PI * 2) * 0.6,
        }));
      case 'corners':
        return [
          { x:  8, z:  8 }, { x: -8, z:  8 },
          { x:  8, z: -8 }, { x: -8, z: -8 },
        ].slice(0, n);
      case 'line':
        return Array.from({ length: n }, (_, i) => ({
          x: -6 + i * (12 / Math.max(1, n - 1)),
          z: 0,
        }));
      case 'bunch':
        return Array.from({ length: n }, (_, i) => ({
          x: (i % 2 === 0 ? -0.6 : 0.6),
          z: (i < 2 ? -0.6 : 0.6),
        }));
    }
  }

  // -------------------------------------------------------------------------
  // Event log — pushed by DevApi.tick() polling + by explicit actions above.
  // UI reads with getEventLog(). No live references escape.
  // -------------------------------------------------------------------------

  pushEvent(type: EventType, actor?: string, details?: string): void {
    const e: GameplayEvent = { t: performance.now(), type, actor, details };
    this.eventLog.push(e);
    if (this.eventLog.length > this.MAX_EVENTS) this.eventLog.shift();
  }

  getEventLog(): GameplayEvent[] {
    return this.eventLog.slice();
  }

  clearEventLog(): void {
    this.eventLog.length = 0;
  }

  private resetEventMemory(): void {
    this.lastHeadbutt = new WeakMap();
    this.lastFalling = new WeakMap();
    this.lastAlive = new WeakMap();
    this.lastAbilityActive = new WeakMap();
    this.lastCollapseLevel = -1;
    this.lastWarningBatch = -2;
  }

  // -------------------------------------------------------------------------
  // Per-frame tick — polling for event edges + perf sampling.
  // Called from tools/main.ts inside the render loop.
  // -------------------------------------------------------------------------

  tick(dt: number): void {
    this.sampleFrame(dt);
    this.pollGameplayEvents();
    this.pollArenaEvents();
  }

  private sampleFrame(dt: number): void {
    const fps = 1 / Math.max(dt, 0.0001);
    this.fpsSamples.push(fps);
    if (this.fpsSamples.length > this.FPS_WINDOW) this.fpsSamples.shift();
    const avgFps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;

    const info = this.renderer.info;
    const arena = this.getArenaInfo();
    // Fragment accounting:
    //   - Each batch owns N fragments (batch.size).
    //   - arena.collapseLevel is the number of batches that have ALREADY
    //     collapsed, so summing batch sizes for [0..collapseLevel) gives us
    //     the count already dropped.
    //   - The central islet is a single fragment that never collapses, so
    //     it's always +1 alive and +1 total on top of the batches.
    let fragsAlive = 0;
    let fragsTotal = 0;
    if (arena) {
      const totalBatched = arena.batches.reduce((s, b) => s + b.size, 0);
      const collapsed = arena.batches
        .slice(0, arena.collapseLevel)
        .reduce((s, b) => s + b.size, 0);
      fragsTotal = totalBatched + 1;        // +1 islet
      fragsAlive = (totalBatched - collapsed) + 1;
    }
    this.lastPerf = {
      fps: avgFps,
      frameMs: dt * 1000,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      critters: this.game.critters.length,
      arenaFragmentsAlive: fragsAlive,
      arenaFragmentsTotal: fragsTotal,
    };
  }

  getPerf(): PerfSnapshot { return this.lastPerf; }

  private pollGameplayEvents(): void {
    for (const c of this.game.critters) {
      // Headbutt edge
      const hb = c.isHeadbutting;
      const prevHb = this.lastHeadbutt.get(c) ?? false;
      if (hb && !prevHb) this.pushEvent('headbutt', c.config.name);
      this.lastHeadbutt.set(c, hb);

      // Falling edge
      const fl = c.falling;
      const prevFl = this.lastFalling.get(c) ?? false;
      if (fl && !prevFl) this.pushEvent('fall', c.config.name);
      if (!fl && prevFl && c.alive) this.pushEvent('respawn', c.config.name);
      this.lastFalling.set(c, fl);

      // Elimination edge
      const al = c.alive;
      const prevAl = this.lastAlive.get(c) ?? true;
      if (!al && prevAl) this.pushEvent('eliminate', c.config.name, 'no lives left');
      this.lastAlive.set(c, al);

      // Ability active transitions
      const prev = this.lastAbilityActive.get(c) ?? c.abilityStates.map(() => false);
      const curr = c.abilityStates.map(s => s.active);
      for (let i = 0; i < curr.length; i++) {
        if (curr[i] && !prev[i]) {
          this.pushEvent('ability_cast', c.config.name, c.abilityStates[i].def.name);
        } else if (!curr[i] && prev[i]) {
          this.pushEvent('ability_end', c.config.name, c.abilityStates[i].def.name);
        }
      }
      this.lastAbilityActive.set(c, curr);
    }
  }

  private pollArenaEvents(): void {
    const info = this.getArenaInfo();
    if (!info) return;
    if (info.collapseLevel !== this.lastCollapseLevel && info.collapseLevel > 0) {
      this.pushEvent('collapse_batch', 'arena', `level=${info.collapseLevel}`);
    }
    if (info.warningBatch !== this.lastWarningBatch && info.warningBatch >= 0) {
      this.pushEvent('collapse_warn', 'arena', `batch ${info.warningBatch}`);
    }
    this.lastCollapseLevel = info.collapseLevel;
    this.lastWarningBatch = info.warningBatch;
  }

  // -------------------------------------------------------------------------
  // Input snapshot — aggregates keyboard + gamepad state for the Input panel.
  // -------------------------------------------------------------------------

  getInputSnapshot(): InputSnapshot {
    const mv = getMoveVector();
    const held = getHeldActionsSnapshot();
    const keyboard = getHeldKeyCodes().map(code => ({ code }));

    const gps = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const gamepads: InputSnapshot['gamepads'] = [];
    for (const g of gps) {
      if (!g) continue;
      gamepads.push({ index: g.index, id: g.id, connected: g.connected });
    }

    return {
      keyboard,
      move: { x: mv.x, z: mv.z },
      held,
      gamepads,
    };
  }
}

// ---------------------------------------------------------------------------
// Safety note — tools.html public page
// ---------------------------------------------------------------------------
// This module is ONLY imported from tools.html via src/tools/main.ts.
// tools.html is a lab, NOT a production surface:
//   - <meta name="robots" content="noindex"> keeps it off search engines.
//   - Not linked from the game UI at any point.
//   - No write paths into online/server state are exposed here. All
//     mutations target the LOCAL game instance.
// If future work adds online debug tools, they MUST NOT allow manipulating
// real-player state. The online panel should be read-only by default and
// require an explicit "Connect as debug observer" toggle before any writes.
