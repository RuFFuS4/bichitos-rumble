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
// Recording — exhaustive session log for post-match analysis
// ---------------------------------------------------------------------------
//
// One session covers one match from start to end (or until the user hits
// Download). Snapshots are sampled every SNAPSHOT_INTERVAL_MS; every event
// is captured uncapped (the sidebar event log is still a 60-slot circular
// buffer, but the recording keeps ALL of them). Lab actions (force ability,
// teleport, bot behaviour changes, etc.) are also logged so the recording
// is a complete reproducible trace.

export type LabActionType =
  | 'force_ability'
  | 'teleport_player'
  | 'teleport_bots'
  | 'set_bot_behaviour'
  | 'set_all_bots_behaviour'
  | 'reset_cooldowns'
  | 'force_seed'
  | 'set_speed'
  | 'end_match';

export interface LabAction {
  t: number;
  matchTime: number;                  // seconds since match start
  type: LabActionType;
  details: Record<string, unknown>;
}

export interface CritterFrame {
  index: number;
  name: string;
  role: string;
  alive: boolean;
  lives: number;
  pos: { x: number; z: number };
  vel: { x: number; z: number };
  falling: boolean;
  immunityLeft: number;
  headbuttCooldown: number;
  isHeadbutting: boolean;
  abilities: Array<{
    name: string;
    type: AbilityType;
    active: boolean;
    cooldownLeft: number;
    windUpLeft: number;
    durationLeft: number;
  }>;
  /** Only set for bots — the currently active behaviour tag. */
  behaviour?: BotBehaviourTag;
}

export interface RecordingSnapshot {
  t: number;                           // ms since recording.startedAt
  matchTime: number;                   // seconds since match start
  critters: CritterFrame[];
  arena: {
    collapseLevel: number;
    warningBatch: number;
    radius: number;
  };
  perf: {
    fps: number;
    frameMs: number;
    drawCalls: number;
    triangles: number;
  };
}

export interface RecordingMeta {
  playerName: string;
  botNames: string[];
  seed: number | null;
  arenaPattern: string;
  startedAt: number;                   // performance.now()
  startedAtIso: string;                // ISO wall clock
  endedAt: number | null;
  endedAtIso: string | null;
  durationSec: number | null;
}

export interface RecordingOutcome {
  survivor: string | null;
  reason: 'last_standing' | 'match_timeout' | 'user_stopped' | null;
}

export interface RecordingSession {
  version: 1;
  meta: RecordingMeta;
  events: GameplayEvent[];
  actions: LabAction[];
  snapshots: RecordingSnapshot[];
  outcome: RecordingOutcome;
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

  // Recording state (one session at a time; a new match auto-starts a new
  // session, overwriting any previous one that wasn't downloaded).
  private recording: RecordingSession | null = null;
  private recordingElapsedMs = 0;        // drives snapshot sampling
  private readonly SNAPSHOT_INTERVAL_MS = 200;   // 5 snapshots/sec
  private lastSnapshotAt = 0;
  private matchStartMs = 0;              // performance.now() at match start

  constructor(public readonly game: Game, private readonly renderer: THREE.WebGLRenderer) {}

  // -------------------------------------------------------------------------
  // Match control — thin wrappers over Game's existing debug* methods.
  // Bot overrides reset on a new match so each run starts clean.
  // -------------------------------------------------------------------------

  startMatch(player: string, bots: string[], opts: { seed?: number } = {}): void {
    this.game.debugStartOfflineMatch(player, bots, opts);
    this.botOverrides.clear();
    this.resetEventMemory();
    this.matchStartMs = performance.now();

    // Auto-start a new recording. Any previous session that wasn't
    // downloaded is overwritten — the sidebar shows a "unsaved recording"
    // warning when this would happen.
    const info = this.getArenaInfo();
    this.startRecording({
      playerName: player,
      botNames: bots,
      seed: info?.seed ?? null,
      arenaPattern: info?.patternLabel ?? 'unknown',
    });

    this.pushEvent('match_started', 'lab', `${player} vs ${bots.join(', ') || '(solo)'}`);
  }

  endMatch(): void {
    this.game.debugEndMatchImmediately();
    this.botOverrides.clear();
    this.logAction('end_match', {});
    this.pushEvent('match_ended', 'lab', 'ended by user');
    this.finaliseRecording('user_stopped');
  }

  forceSeed(seed: number): void {
    this.game.debugForceArenaSeed(seed);
    this.logAction('force_seed', { seed });
  }

  setSpeed(scale: number): void {
    this.game.debugSpeedScale = scale;
    this.logAction('set_speed', { scale });
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
    this.logAction('set_bot_behaviour', { index, behaviour: b, name: c.config.name });
  }

  setAllBotsBehaviour(b: BotBehaviourTag): void {
    for (let i = 1; i < this.game.critters.length; i++) {
      const c = this.game.critters[i];
      if (!c) continue;
      c.debugBotBehaviour = b;
      this.botOverrides.set(i, b);
    }
    this.logAction('set_all_bots_behaviour', { behaviour: b });
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
    this.logAction('reset_cooldowns', {});
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
    this.logAction('force_ability', { slotIndex, name: s.def.name });
  }

  teleportPlayer(x: number, z: number): void {
    const p = this.game.player;
    if (!p) return;
    p.x = x;
    p.z = z;
    p.vx = 0;
    p.vz = 0;
    clearAllHeldInputs();
    this.logAction('teleport_player', { x, z });
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
    this.logAction('teleport_bots', { preset, count: bots.length });
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
    // Recording keeps every event uncapped — the live panel is a separate
    // circular buffer just for display.
    if (this.recording) {
      this.recording.events.push({ ...e });
    }
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
    this.tickRecording(dt);
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
  // Recording — exhaustive match trace + JSON/MD export
  // -------------------------------------------------------------------------

  /** Start a fresh recording. Any previous session is discarded — if the UI
   *  hasn't downloaded it, it's gone. */
  startRecording(meta: Omit<RecordingMeta, 'startedAt' | 'startedAtIso' | 'endedAt' | 'endedAtIso' | 'durationSec'>): void {
    const now = performance.now();
    this.recording = {
      version: 1,
      meta: {
        ...meta,
        startedAt: now,
        startedAtIso: new Date().toISOString(),
        endedAt: null,
        endedAtIso: null,
        durationSec: null,
      },
      events: [],
      actions: [],
      snapshots: [],
      outcome: { survivor: null, reason: null },
    };
    this.recordingElapsedMs = 0;
    this.lastSnapshotAt = -this.SNAPSHOT_INTERVAL_MS; // force a snapshot on tick 0
  }

  /** Mark the recording as closed (still downloadable). */
  stopRecording(): void {
    this.finaliseRecording('user_stopped');
  }

  isRecording(): boolean {
    return this.recording !== null && this.recording.meta.endedAt === null;
  }

  hasRecording(): boolean {
    return this.recording !== null;
  }

  getRecording(): RecordingSession | null {
    return this.recording;
  }

  clearRecording(): void {
    this.recording = null;
  }

  /** Record a lab-side action (force ability, teleport, etc). No-op if not
   *  currently recording. Each mutating DevApi method calls this internally. */
  private logAction(type: LabActionType, details: Record<string, unknown>): void {
    if (!this.recording || this.recording.meta.endedAt !== null) return;
    this.recording.actions.push({
      t: performance.now() - this.recording.meta.startedAt,
      matchTime: this.currentMatchTime(),
      type,
      details,
    });
  }

  private currentMatchTime(): number {
    if (this.matchStartMs === 0) return 0;
    return (performance.now() - this.matchStartMs) / 1000;
  }

  private tickRecording(dt: number): void {
    if (!this.recording || this.recording.meta.endedAt !== null) return;
    this.recordingElapsedMs += dt * 1000;
    if (this.recordingElapsedMs - this.lastSnapshotAt < this.SNAPSHOT_INTERVAL_MS) return;
    this.lastSnapshotAt = this.recordingElapsedMs;
    this.recording.snapshots.push(this.buildSnapshot());

    // Auto-detect last-survivor end condition. We look at the current
    // alive count; if we go from >1 to exactly 1, mark outcome immediately
    // (before the user restarts).
    const alive = this.game.critters.filter(c => c.alive);
    if (alive.length === 1 && this.recording.outcome.survivor === null
        && this.game.critters.length > 1) {
      this.recording.outcome.survivor = alive[0].config.name;
      this.recording.outcome.reason = 'last_standing';
    }
  }

  private buildSnapshot(): RecordingSnapshot {
    const rec = this.recording!;
    const critters: CritterFrame[] = this.game.critters.map((c, i) => ({
      index: i,
      name: c.config.name,
      role: c.config.role,
      alive: c.alive,
      lives: c.lives,
      pos: { x: +c.x.toFixed(3), z: +c.z.toFixed(3) },
      vel: { x: +c.vx.toFixed(3), z: +c.vz.toFixed(3) },
      falling: c.falling,
      immunityLeft: +c.immunityTimer.toFixed(3),
      headbuttCooldown: +c.headbuttCooldown.toFixed(3),
      isHeadbutting: c.isHeadbutting,
      abilities: c.abilityStates.map(s => ({
        name: s.def.name,
        type: s.def.type,
        active: s.active,
        cooldownLeft: +s.cooldownLeft.toFixed(3),
        windUpLeft: +s.windUpLeft.toFixed(3),
        durationLeft: +s.durationLeft.toFixed(3),
      })),
      ...(i === 0 ? {} : { behaviour: c.debugBotBehaviour }),
    }));
    const arenaInfo = this.getArenaInfo();
    return {
      t: performance.now() - rec.meta.startedAt,
      matchTime: this.currentMatchTime(),
      critters,
      arena: {
        collapseLevel: arenaInfo?.collapseLevel ?? 0,
        warningBatch: arenaInfo?.warningBatch ?? -1,
        radius: arenaInfo?.currentRadius ?? 0,
      },
      perf: {
        fps: +this.lastPerf.fps.toFixed(1),
        frameMs: +this.lastPerf.frameMs.toFixed(2),
        drawCalls: this.lastPerf.drawCalls,
        triangles: this.lastPerf.triangles,
      },
    };
  }

  private finaliseRecording(reason: RecordingOutcome['reason']): void {
    if (!this.recording || this.recording.meta.endedAt !== null) return;
    const endMs = performance.now();
    this.recording.meta.endedAt = endMs;
    this.recording.meta.endedAtIso = new Date().toISOString();
    this.recording.meta.durationSec = +((endMs - this.recording.meta.startedAt) / 1000).toFixed(2);
    if (this.recording.outcome.reason === null) {
      // Derive survivor if not already set (e.g. match timeout or manual end).
      const alive = this.game.critters.filter(c => c.alive);
      if (alive.length === 1) {
        this.recording.outcome.survivor = alive[0].config.name;
      }
      this.recording.outcome.reason = reason;
    }
  }

  /** Trigger a browser download of the current recording as raw JSON. */
  downloadRecordingJSON(): void {
    const rec = this.recording;
    if (!rec) return;
    const name = this.recordingFilename(rec, 'json');
    const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
    this.triggerDownload(blob, name);
  }

  /** Trigger a browser download of a human-readable MD summary. */
  downloadRecordingMD(): void {
    const rec = this.recording;
    if (!rec) return;
    const name = this.recordingFilename(rec, 'md');
    const md = buildRecordingSummaryMD(rec);
    const blob = new Blob([md], { type: 'text/markdown' });
    this.triggerDownload(blob, name);
  }

  private recordingFilename(rec: RecordingSession, ext: 'json' | 'md'): string {
    const stamp = rec.meta.startedAtIso.replace(/[:.]/g, '-').slice(0, 19);
    const lineup = [rec.meta.playerName, ...rec.meta.botNames].slice(0, 4).join('-');
    return `bichitos-${stamp}-${lineup}.${ext}`;
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      a.remove();
      URL.revokeObjectURL(url);
    });
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
// Recording summary — turns a session into a readable Markdown report
// ---------------------------------------------------------------------------

export function buildRecordingSummaryMD(rec: RecordingSession): string {
  const lines: string[] = [];
  const { meta, events, actions, snapshots, outcome } = rec;

  lines.push(`# Match recording — ${meta.startedAtIso}`);
  lines.push('');
  lines.push('## Setup');
  lines.push(`- **Seed**: ${meta.seed ?? '(unknown)'}`);
  lines.push(`- **Arena pattern**: ${meta.arenaPattern}`);
  lines.push(`- **Player**: ${meta.playerName}`);
  lines.push(`- **Bots**: ${meta.botNames.join(', ') || '(none)'}`);
  lines.push(`- **Started**: ${meta.startedAtIso}`);
  lines.push(`- **Ended**: ${meta.endedAtIso ?? '(still recording)'}`);
  lines.push(`- **Duration**: ${meta.durationSec !== null ? `${meta.durationSec.toFixed(2)}s` : '(running)'}`);
  lines.push('');
  lines.push('## Outcome');
  lines.push(`- **Survivor**: ${outcome.survivor ?? '(unresolved)'}`);
  lines.push(`- **Reason**: ${outcome.reason ?? '(unresolved)'}`);
  lines.push('');

  // Event counts by type
  const evtCounts = new Map<string, number>();
  for (const e of events) evtCounts.set(e.type, (evtCounts.get(e.type) ?? 0) + 1);
  lines.push('## Events summary');
  lines.push(`Total: ${events.length}`);
  lines.push('');
  lines.push('| Type | Count |');
  lines.push('|------|-------|');
  for (const [t, n] of [...evtCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${t} | ${n} |`);
  }
  lines.push('');

  // Per-critter aggregates
  interface CritterStats {
    name: string;
    headbutts: number;
    abilityCasts: number;
    falls: number;
    respawns: number;
    eliminatedAt: number | null;
  }
  const stats = new Map<string, CritterStats>();
  const ensure = (name: string): CritterStats => {
    let s = stats.get(name);
    if (!s) {
      s = { name, headbutts: 0, abilityCasts: 0, falls: 0, respawns: 0, eliminatedAt: null };
      stats.set(name, s);
    }
    return s;
  };
  for (const e of events) {
    if (!e.actor || e.actor === 'arena' || e.actor === 'lab') continue;
    const s = ensure(e.actor);
    if (e.type === 'headbutt') s.headbutts++;
    else if (e.type === 'ability_cast') s.abilityCasts++;
    else if (e.type === 'fall') s.falls++;
    else if (e.type === 'respawn') s.respawns++;
    else if (e.type === 'eliminate' && s.eliminatedAt === null) {
      s.eliminatedAt = +((e.t - meta.startedAt) / 1000).toFixed(2);
    }
  }
  if (stats.size > 0) {
    lines.push('## Per-critter stats');
    lines.push('');
    lines.push('| Critter | Headbutts | Abilities | Falls | Respawns | Eliminated at |');
    lines.push('|---------|-----------|-----------|-------|----------|---------------|');
    for (const s of stats.values()) {
      const elim = s.eliminatedAt !== null ? `${s.eliminatedAt}s` : '—';
      lines.push(`| ${s.name} | ${s.headbutts} | ${s.abilityCasts} | ${s.falls} | ${s.respawns} | ${elim} |`);
    }
    lines.push('');
  }

  // Lab actions
  if (actions.length > 0) {
    lines.push('## Lab actions');
    lines.push('');
    lines.push('| t (s) | matchTime | type | details |');
    lines.push('|-------|-----------|------|---------|');
    for (const a of actions) {
      const tSec = (a.t / 1000).toFixed(2);
      const det = JSON.stringify(a.details);
      lines.push(`| ${tSec} | ${a.matchTime.toFixed(2)} | ${a.type} | \`${det}\` |`);
    }
    lines.push('');
  }

  // Arena collapse timeline
  const collapses = events.filter(e => e.type === 'collapse_batch' || e.type === 'collapse_warn');
  if (collapses.length > 0) {
    lines.push('## Arena collapse timeline');
    lines.push('');
    for (const e of collapses) {
      const tSec = ((e.t - meta.startedAt) / 1000).toFixed(2);
      lines.push(`- t=${tSec}s · ${e.type} · ${e.details ?? ''}`);
    }
    lines.push('');
  }

  // Sampling stats
  lines.push('## Sampling');
  lines.push(`- Snapshots: ${snapshots.length} (every ~200ms)`);
  lines.push(`- Events captured: ${events.length}`);
  lines.push(`- Lab actions: ${actions.length}`);
  if (snapshots.length > 0) {
    const fps = snapshots.map(s => s.perf.fps).filter(v => v > 0);
    const avg = fps.length ? (fps.reduce((a, b) => a + b, 0) / fps.length) : 0;
    const min = fps.length ? Math.min(...fps) : 0;
    lines.push(`- FPS avg: ${avg.toFixed(1)} · min: ${min.toFixed(1)}`);
  }

  return lines.join('\n');
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
