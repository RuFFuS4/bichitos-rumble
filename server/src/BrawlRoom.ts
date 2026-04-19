// ---------------------------------------------------------------------------
// BrawlRoom — authoritative multiplayer brawl instance
// ---------------------------------------------------------------------------
//
// Bloque A scope:
//   - 2 players max (maxClients: 2)
//   - Both play as Sergei (fixed)
//   - Server simulates: movement, headbutt, collisions, knockback, falloff,
//     respawn, match timer, win/lose
//   - Server simulates: charge_rush ability (generic arch ready for more)
//   - Client sends 'input' each frame with movement + held flags
//   - Client receives state automatically via Colyseus patches + 'abilityFired'
//     event for visual effect triggers
// ---------------------------------------------------------------------------

import { Client, Room } from 'colyseus';
import { GameState } from './state/GameState.js';
import { PlayerSchema } from './state/PlayerSchema.js';
import { SIM, SPAWN_POSITIONS, isPlayableCritter, DEFAULT_CRITTER } from './sim/config.js';
import { resolveCollisions, checkFalloff, updateFalling, effectiveSpeed } from './sim/physics.js';
import { createAbilityStates, tickPlayerAbilities } from './sim/abilities.js';
import { ArenaSim } from './sim/arena.js';

interface InputMessage {
  moveX: number;      // -1..1
  moveZ: number;      // -1..1
  headbutt: boolean;
  ability1: boolean;  // charge_rush
  ability2: boolean;  // ground_pound
  ultimate: boolean;  // frenzy / other (character-dependent)
}

interface JoinOptions {
  critterName?: string;
}

/**
 * Per-player non-synced state. Lives OUTSIDE the schema to avoid polluting
 * the MapSchema<PlayerSchema> with mutations that don't need to be broadcast.
 * In Colyseus schema v3, mixing synced and non-synced fields in the same
 * class can interfere with binary patch propagation over real proxies.
 */
interface InternalPlayerData {
  // Client input (set from onMessage, read by sim)
  inputMoveX: number;
  inputMoveZ: number;
  inputHeadbutt: boolean;
  inputAbility1: boolean;
  inputAbility2: boolean;
  inputUltimate: boolean;
  // Sim-only timers
  respawnTimer: number;
  anticipationTimer: number;
  headbuttTimer: number;
  hasInput: boolean;
}

function newInternal(): InternalPlayerData {
  return {
    inputMoveX: 0, inputMoveZ: 0,
    inputHeadbutt: false, inputAbility1: false, inputAbility2: false, inputUltimate: false,
    respawnTimer: 0, anticipationTimer: 0, headbuttTimer: 0, hasInput: false,
  };
}

export class BrawlRoom extends Room<GameState> {
  maxClients = 2;
  state = new GameState();

  private tickInterval: number = 0;
  private tickHandle: NodeJS.Timeout | null = null;
  private internal = new Map<string, InternalPlayerData>();
  private arenaSim!: ArenaSim;

  onCreate(_options: unknown) {
    this.tickInterval = 1000 / SIM.tickRate;

    this.onMessage('input', (client, msg: InputMessage) => {
      const data = this.internal.get(client.sessionId);
      if (!data) return;
      data.inputMoveX = clamp(msg.moveX ?? 0, -1, 1);
      data.inputMoveZ = clamp(msg.moveZ ?? 0, -1, 1);
      data.inputHeadbutt = !!msg.headbutt;
      data.inputAbility1 = !!msg.ability1;
      data.inputAbility2 = !!msg.ability2;
      data.inputUltimate = !!msg.ultimate;
    });

    // Ignore any client request to restart for Bloque A (server drives flow)
    this.onMessage('ready', () => { /* no-op */ });

    // Voluntary forfeit: player walked into a Vibe Jam portal. Treat as an
    // immediate, authoritative retirement. The player is marked dead (not
    // "falling") so no respawn countdown runs and no ghost lingers in the
    // sim. If only one player remains alive, the match ends with that
    // player as winner. The leaving client does its own redirect locally.
    this.onMessage('portal', (client) => {
      // Guards: only valid mid-match, only for alive players
      if (this.state.phase !== 'playing') return;
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;

      p.alive = false;
      p.falling = false;
      p.isHeadbutting = false;
      p.headbuttAnticipating = false;
      console.log(`[BrawlRoom] ${client.sessionId} forfeited via portal`);

      // Re-evaluate win condition immediately (don't wait for next tick)
      const alive = [...this.state.players.values()].filter(pl => pl.alive);
      if (alive.length <= 1) {
        this.endMatch(
          alive.length === 1 ? 'opponent_left' : 'draw',
          alive[0]?.sessionId ?? '',
        );
      }
    });

    this.setSimulationInterval(() => this.tick(this.tickInterval / 1000), this.tickInterval);
    console.log(`[BrawlRoom] created, tickRate=${SIM.tickRate}Hz`);
  }

  onJoin(client: Client, options: JoinOptions = {}) {
    const idx = this.state.players.size; // 0 or 1
    const spawn = SPAWN_POSITIONS[idx % SPAWN_POSITIONS.length];

    // Validate critterName against the playable table; fall back on unknown.
    const requested = options.critterName ?? DEFAULT_CRITTER;
    const critterName = isPlayableCritter(requested) ? requested : DEFAULT_CRITTER;
    if (requested !== critterName) {
      console.log(`[BrawlRoom] ${client.sessionId} requested unknown critter "${requested}", using ${critterName}`);
    }

    const p = new PlayerSchema();
    p.sessionId = client.sessionId;
    p.critterName = critterName;
    p.x = spawn[0];
    p.z = spawn[1];
    p.rotationY = Math.atan2(-spawn[0], -spawn[1]); // face arena center
    p.lives = SIM.lives.default;
    p.alive = true;

    const abilities = createAbilityStates(critterName);
    for (const a of abilities) p.abilities.push(a);

    this.state.players.set(client.sessionId, p);
    this.internal.set(client.sessionId, newInternal());
    console.log(`[BrawlRoom] ${client.sessionId} joined roomId=${this.roomId} (${this.state.players.size}/${this.maxClients})`);

    // Start countdown once both players are in
    if (this.state.players.size >= 2 && this.state.phase === 'waiting') {
      // Generate deterministic arena seed — clients use this to build
      // the identical fragment layout. Seed set BEFORE phase change so
      // the value is included in the same patch that transitions to countdown.
      const seed = (Math.random() * 0xFFFFFFFF) | 0;
      this.arenaSim = new ArenaSim(seed);
      this.state.arenaSeed = seed;
      this.state.arenaRadius = this.arenaSim.currentRadius;

      this.state.phase = 'countdown';
      this.state.countdownLeft = SIM.match.countdown;
      this.state.matchTimer = SIM.match.duration;
    }
  }

  onLeave(client: Client, _consented: boolean) {
    this.state.players.delete(client.sessionId);
    this.internal.delete(client.sessionId);
    console.log(`[BrawlRoom] ${client.sessionId} left (${this.state.players.size} remaining)`);

    // If a player leaves mid-match, end it (Bloque A: no reconnection)
    if (this.state.phase === 'playing' || this.state.phase === 'countdown') {
      const remaining = [...this.state.players.values()][0];
      this.endMatch('opponent_left', remaining?.sessionId ?? '');
    }
  }

  onDispose() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    console.log(`[BrawlRoom] disposed`);
  }

  /**
   * Finalise the match and lock the room so new joinOrCreate calls never
   * match an already-finished room. Idempotent — safe to call multiple
   * times (e.g. both from tick win-check and onLeave opponent-left).
   */
  /**
   * Pick a respawn position GUARANTEED to be on solid ground. Up to 12
   * attempts with a radius that shrinks per try so fallbacks converge
   * toward the immune islet at the centre, which never collapses.
   */
  private pickRespawnPos(): [number, number] {
    const maxR = Math.max(2.0, this.arenaSim.currentRadius * 0.4);
    for (let i = 0; i < 12; i++) {
      const r = maxR * (1 - i / 12) + 0.5;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      if (this.arenaSim.isOnArena(x, z)) return [x, z];
    }
    return [0, 0];
  }

  private endMatch(reason: string, winnerSessionId: string = ''): void {
    if (this.state.phase === 'ended') return;
    this.state.phase = 'ended';
    this.state.endReason = reason;
    this.state.winnerSessionId = winnerSessionId;
    this.lock().catch(() => { /* already locked or disposing */ });
    console.log(`[BrawlRoom] match ended reason=${reason} winner=${winnerSessionId} (locked)`);
  }

  // -------------------------------------------------------------------------
  // Simulation tick (called at SIM.tickRate Hz)
  // -------------------------------------------------------------------------

  private tick(dt: number) {
    switch (this.state.phase) {
      case 'waiting':
        // Idle — players just joined, no sim yet
        break;

      case 'countdown':
        this.state.countdownLeft -= dt;
        if (this.state.countdownLeft <= 0) {
          this.state.phase = 'playing';
          this.state.matchTimer = SIM.match.duration;
        }
        // During countdown: freeze positions but still apply friction to zero any residual velocity
        for (const p of this.state.players.values()) {
          p.vx = 0;
          p.vz = 0;
          const data = this.internal.get(p.sessionId);
          if (data) data.inputHeadbutt = false;
        }
        break;

      case 'playing':
        this.simulatePlaying(dt);
        break;

      case 'ended':
        // Match is over — continue accepting inputs but do nothing
        break;
    }
  }

  private simulatePlaying(dt: number) {
    this.state.matchTimer -= dt;
    const players = [...this.state.players.values()];

    // Arena collapse simulation (authoritative). Tick first so falloff
    // checks below use the freshly updated fragments, then mirror into
    // state for clients to render identical visuals.
    this.arenaSim.tick(dt);
    this.state.arenaRadius = this.arenaSim.currentRadius;
    this.state.arenaCollapseLevel = this.arenaSim.collapseLevel;
    this.state.arenaWarningBatch = this.arenaSim.warningBatch;

    // 1. Process per-player input → intent (movement, headbutt trigger)
    for (const p of players) {
      if (!p.alive || p.falling) continue;
      const data = this.internal.get(p.sessionId);
      if (!data) continue;

      // Immunity countdown
      if (p.immunityTimer > 0) p.immunityTimer = Math.max(0, p.immunityTimer - dt);

      // Headbutt cooldown
      if (p.headbuttCooldown > 0) p.headbuttCooldown = Math.max(0, p.headbuttCooldown - dt);

      // Headbutt state machine
      if (p.headbuttAnticipating) {
        data.anticipationTimer -= dt;
        if (data.anticipationTimer <= 0) {
          p.headbuttAnticipating = false;
          p.isHeadbutting = true;
          data.headbuttTimer = SIM.headbutt.lunge;
          const a = p.rotationY;
          p.vx += Math.sin(a) * SIM.headbutt.velocityBoost;
          p.vz += Math.cos(a) * SIM.headbutt.velocityBoost;
        }
      } else if (p.isHeadbutting) {
        data.headbuttTimer -= dt;
        if (data.headbuttTimer <= 0) {
          p.isHeadbutting = false;
          p.headbuttCooldown = SIM.headbutt.cooldown;
        }
      } else if (data.inputHeadbutt && p.headbuttCooldown <= 0 && p.immunityTimer <= 0) {
        p.headbuttAnticipating = true;
        data.anticipationTimer = SIM.headbutt.anticipation;
      }

      // Movement: apply input → velocity
      const inputMag = Math.sqrt(data.inputMoveX * data.inputMoveX + data.inputMoveZ * data.inputMoveZ);
      let mx = data.inputMoveX;
      let mz = data.inputMoveZ;
      if (inputMag > 1) { mx /= inputMag; mz /= inputMag; }
      data.hasInput = inputMag > 0.01;

      const speed = effectiveSpeed(p);
      const accel = speed * SIM.movement.accelerationScale;
      p.vx += mx * accel * dt;
      p.vz += mz * accel * dt;
    }

    // 2. Tick abilities (generic dispatcher) and broadcast fire events
    for (const p of players) {
      if (!p.alive || p.falling) continue;
      const data = this.internal.get(p.sessionId);
      if (!data) continue;
      const events = tickPlayerAbilities(p, players, dt, {
        ability1: data.inputAbility1,
        ability2: data.inputAbility2,
        ultimate: data.inputUltimate,
      });
      for (const ev of events) {
        this.broadcast('abilityFired', ev);
      }
    }

    // 3. Integrate position + friction + dead zone + max speed cap + facing
    for (const p of players) {
      if (!p.alive || p.falling) continue;
      const data = this.internal.get(p.sessionId);
      if (!data) continue;

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      const halfLife = data.hasInput ? SIM.movement.frictionHalfLife : SIM.movement.idleFrictionHalfLife;
      const friction = Math.pow(0.5, dt / halfLife);
      p.vx *= friction;
      p.vz *= friction;

      const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
      if (speed < SIM.movement.velocityDeadZone) {
        p.vx = 0;
        p.vz = 0;
      } else if (speed > SIM.movement.maxSpeed) {
        p.vx = (p.vx / speed) * SIM.movement.maxSpeed;
        p.vz = (p.vz / speed) * SIM.movement.maxSpeed;
      }

      if (Math.abs(p.vx) > 0.1 || Math.abs(p.vz) > 0.1) {
        p.rotationY = Math.atan2(p.vx, p.vz);
      }
    }

    // 4. Collisions + knockback (player vs player)
    resolveCollisions(players);

    // 5. Falloff detection — uses the authoritative fragment layout
    checkFalloff(players, this.internal, (x, z) => this.arenaSim.isOnArena(x, z));

    // 6. Falling animation + respawn countdown
    const toRespawn = updateFalling(players, this.internal, dt);
    for (const sid of toRespawn) {
      const p = this.state.players.get(sid);
      if (!p) continue;
      // Pick a position GUARANTEED to be on solid ground. With the irregular
      // fragment layout (esp. Pattern B axis-split), a naive angle × 0.4·r
      // draw can land the player in the void half of the arena. We retry up
      // to 12 times with a shrinking radius and finally fall back to the
      // immune islet at (0, 0), which never collapses.
      const [rx, rz] = this.pickRespawnPos();
      p.x = rx;
      p.z = rz;
      // Face the centre after respawn — consistent with initial spawn
      // so the player never re-enters the arena staring at the void.
      p.rotationY = Math.atan2(-p.x, -p.z);
      p.vx = 0;
      p.vz = 0;
      p.fallY = 0;
      p.falling = false;
      p.immunityTimer = SIM.lives.immunityDuration;
      p.isHeadbutting = false;
      p.headbuttAnticipating = false;
      p.headbuttCooldown = 0;
    }

    // 7. Win/lose detection
    const aliveCount = players.filter(p => p.alive).length;
    if (aliveCount <= 1 && players.length >= 2 && !players.some(p => p.falling)) {
      const winner = players.find(p => p.alive);
      this.endMatch(winner ? 'eliminated' : 'draw', winner?.sessionId ?? '');
    } else if (this.state.matchTimer <= 0) {
      const alive = players.filter(p => p.alive);
      if (alive.length === 1) {
        this.endMatch('timeout', alive[0].sessionId);
      } else {
        this.endMatch('draw', '');
      }
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
