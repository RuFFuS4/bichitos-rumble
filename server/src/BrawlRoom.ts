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
import { SIM, SPAWN_POSITIONS } from './sim/config.js';
import { resolveCollisions, checkFalloff, updateFalling, effectiveSpeed } from './sim/physics.js';
import { createAbilityStates, tickPlayerAbilities } from './sim/abilities.js';

interface InputMessage {
  moveX: number;      // -1..1
  moveZ: number;      // -1..1
  headbutt: boolean;
  ability1: boolean;  // charge_rush
  ability2: boolean;  // ground_pound (Bloque B)
  ultimate: boolean;  // frenzy (Bloque B)
}

export class BrawlRoom extends Room<GameState> {
  maxClients = 2;
  state = new GameState();

  private tickInterval: number = 0;
  private tickHandle: NodeJS.Timeout | null = null;

  onCreate(_options: unknown) {
    this.tickInterval = 1000 / SIM.tickRate;

    this.onMessage('input', (client, msg: InputMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.inputMoveX = clamp(msg.moveX ?? 0, -1, 1);
      p.inputMoveZ = clamp(msg.moveZ ?? 0, -1, 1);
      p.inputHeadbutt = !!msg.headbutt;
      p.inputAbility1 = !!msg.ability1;
      p.inputAbility2 = !!msg.ability2;
      p.inputUltimate = !!msg.ultimate;
    });

    // Ignore any client request to restart for Bloque A (server drives flow)
    this.onMessage('ready', () => { /* no-op */ });

    this.setSimulationInterval(() => this.tick(this.tickInterval / 1000), this.tickInterval);
    console.log(`[BrawlRoom] created, tickRate=${SIM.tickRate}Hz`);
  }

  onJoin(client: Client, _options: unknown) {
    const idx = this.state.players.size; // 0 or 1
    const spawn = SPAWN_POSITIONS[idx % SPAWN_POSITIONS.length];
    const p = new PlayerSchema();
    p.sessionId = client.sessionId;
    p.critterName = 'Sergei';
    p.x = spawn[0];
    p.z = spawn[1];
    p.rotationY = Math.atan2(-spawn[0], -spawn[1]); // face arena center
    p.lives = SIM.lives.default;
    p.alive = true;

    const abilities = createAbilityStates();
    for (const a of abilities) p.abilities.push(a);

    this.state.players.set(client.sessionId, p);
    console.log(`[BrawlRoom] ${client.sessionId} joined (${this.state.players.size}/${this.maxClients})`);

    // Start countdown once both players are in
    if (this.state.players.size >= 2 && this.state.phase === 'waiting') {
      this.state.phase = 'countdown';
      this.state.countdownLeft = SIM.match.countdown;
      this.state.matchTimer = SIM.match.duration;
    }
  }

  onLeave(client: Client, _consented: boolean) {
    this.state.players.delete(client.sessionId);
    console.log(`[BrawlRoom] ${client.sessionId} left (${this.state.players.size} remaining)`);

    // If a player leaves mid-match, end it (Bloque A: no reconnection)
    if (this.state.phase === 'playing' || this.state.phase === 'countdown') {
      this.state.phase = 'ended';
      this.state.endReason = 'opponent_left';
      const remaining = [...this.state.players.values()][0];
      this.state.winnerSessionId = remaining?.sessionId ?? '';
    }
  }

  onDispose() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    console.log(`[BrawlRoom] disposed`);
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
          p.inputHeadbutt = false;
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

    // 1. Process per-player input → intent (movement, headbutt trigger)
    for (const p of players) {
      if (!p.alive || p.falling) continue;

      // Immunity countdown
      if (p.immunityTimer > 0) p.immunityTimer = Math.max(0, p.immunityTimer - dt);

      // Headbutt cooldown
      if (p.headbuttCooldown > 0) p.headbuttCooldown = Math.max(0, p.headbuttCooldown - dt);

      // Headbutt state machine
      if (p.headbuttAnticipating) {
        p.anticipationTimer -= dt;
        if (p.anticipationTimer <= 0) {
          p.headbuttAnticipating = false;
          p.isHeadbutting = true;
          p.headbuttTimer = SIM.headbutt.lunge;
          const a = p.rotationY;
          p.vx += Math.sin(a) * SIM.headbutt.velocityBoost;
          p.vz += Math.cos(a) * SIM.headbutt.velocityBoost;
        }
      } else if (p.isHeadbutting) {
        p.headbuttTimer -= dt;
        if (p.headbuttTimer <= 0) {
          p.isHeadbutting = false;
          p.headbuttCooldown = SIM.headbutt.cooldown;
        }
      } else if (p.inputHeadbutt && p.headbuttCooldown <= 0 && p.immunityTimer <= 0) {
        p.headbuttAnticipating = true;
        p.anticipationTimer = SIM.headbutt.anticipation;
      }

      // Movement: apply input → velocity
      const inputMag = Math.sqrt(p.inputMoveX * p.inputMoveX + p.inputMoveZ * p.inputMoveZ);
      let mx = p.inputMoveX;
      let mz = p.inputMoveZ;
      if (inputMag > 1) { mx /= inputMag; mz /= inputMag; }
      p.hasInput = inputMag > 0.01;

      const speed = effectiveSpeed(p);
      const accel = speed * SIM.movement.accelerationScale;
      p.vx += mx * accel * dt;
      p.vz += mz * accel * dt;
    }

    // 2. Tick abilities (generic dispatcher) and broadcast fire events
    for (const p of players) {
      if (!p.alive || p.falling) continue;
      const events = tickPlayerAbilities(p, players, dt);
      for (const ev of events) {
        this.broadcast('abilityFired', ev);
      }
    }

    // 3. Integrate position + friction + dead zone + max speed cap + facing
    for (const p of players) {
      if (!p.alive || p.falling) continue;

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      const halfLife = p.hasInput ? SIM.movement.frictionHalfLife : SIM.movement.idleFrictionHalfLife;
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

    // 5. Falloff detection
    checkFalloff(players);

    // 6. Falling animation + respawn countdown
    const toRespawn = updateFalling(players, dt);
    for (const sid of toRespawn) {
      const p = this.state.players.get(sid);
      if (!p) continue;
      // Respawn at arena center-ish (match client's pickRespawnPos logic)
      const angle = Math.random() * Math.PI * 2;
      const r = SIM.arena.radius * 0.4;
      p.x = Math.cos(angle) * r;
      p.z = Math.sin(angle) * r;
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
      this.state.phase = 'ended';
      this.state.endReason = winner ? 'eliminated' : 'draw';
      this.state.winnerSessionId = winner?.sessionId ?? '';
    } else if (this.state.matchTimer <= 0) {
      this.state.phase = 'ended';
      const alive = players.filter(p => p.alive);
      if (alive.length === 1) {
        this.state.endReason = 'timeout';
        this.state.winnerSessionId = alive[0].sessionId;
      } else {
        this.state.endReason = 'draw';
        this.state.winnerSessionId = '';
      }
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
