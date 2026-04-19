// ---------------------------------------------------------------------------
// BrawlRoom — authoritative multiplayer brawl instance
// ---------------------------------------------------------------------------
//
// Current scope (4P online + bot-fill):
//   - Up to 4 players per room (maxClients: 4).
//   - Waiting flow: the room waits up to WAITING_TIMEOUT seconds to fill up
//     with humans. If 4 humans arrive, the countdown starts immediately.
//     If the timer hits 0 and there is at least 1 human in the room, the
//     remaining slots are filled with server-controlled bots.
//   - Server simulates everything: movement, headbutt, collisions, knockback,
//     falloff, respawn, match timer, win/lose, charge_rush ability (generic
//     arch ready for more).
//   - Humans send 'input' messages each client frame. Bots get their input
//     from sim/bot.ts every server tick — gameplay is byte-identical
//     regardless of input source, so no branch on bot-ness in the sim.
//   - On human leave mid-match: if the remaining alive count is ≥ 2 we
//     convert the leaver's critter into a bot (bot-takeover), keeping the
//     match alive. Otherwise the match ends with opponent_left.
// ---------------------------------------------------------------------------

import { Client, Room } from 'colyseus';
import { GameState } from './state/GameState.js';
import { PlayerSchema } from './state/PlayerSchema.js';
import { SIM, SPAWN_POSITIONS, isPlayableCritter, DEFAULT_CRITTER, CRITTER_CONFIGS } from './sim/config.js';
import { resolveCollisions, checkFalloff, updateFalling, effectiveSpeed } from './sim/physics.js';
import { createAbilityStates, tickPlayerAbilities } from './sim/abilities.js';
import { ArenaSim } from './sim/arena.js';
import { computeBotInput } from './sim/bot.js';

/** Seconds of open waiting before the server fills empty slots with bots. */
const WAITING_TIMEOUT = 60;
/** Hard cap on humans+bots in one room — matches `maxClients`. */
const MAX_PLAYERS = 4;

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
  maxClients = MAX_PLAYERS;
  state = new GameState();

  private tickInterval: number = 0;
  private tickHandle: NodeJS.Timeout | null = null;
  private internal = new Map<string, InternalPlayerData>();
  private arenaSim!: ArenaSim;
  /** Monotonic counter for bot sessionIds (bot_1, bot_2, …). */
  private botCounter = 0;

  onCreate(_options: unknown) {
    this.tickInterval = 1000 / SIM.tickRate;
    // Waiting-room countdown starts the moment the first client joins, not
    // on room creation — see onJoin. The initial value here is a visible
    // default in case a client attaches before anyone else.
    this.state.waitingTimeLeft = WAITING_TIMEOUT;

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
    // Only accept humans in 'waiting' — once we're in countdown/playing the
    // room is locked via maxClients + seat count, but Colyseus can still
    // race a join before lock takes effect. This guard rejects late humans
    // cleanly instead of injecting them mid-match.
    if (this.state.phase !== 'waiting') {
      console.log(`[BrawlRoom] rejected ${client.sessionId}: phase=${this.state.phase}`);
      client.leave();
      return;
    }

    // Reset the waiting timer ONLY the first time someone joins. That way a
    // burst of joins doesn't keep resetting it back to 60 — we always give
    // the first human 60s to see the room fill.
    if (this.state.players.size === 0) {
      this.state.waitingTimeLeft = WAITING_TIMEOUT;
    }

    const idx = this.state.players.size;
    const spawn = SPAWN_POSITIONS[idx % SPAWN_POSITIONS.length];

    const requested = options.critterName ?? DEFAULT_CRITTER;
    const critterName = isPlayableCritter(requested) ? requested : DEFAULT_CRITTER;
    if (requested !== critterName) {
      console.log(`[BrawlRoom] ${client.sessionId} requested unknown critter "${requested}", using ${critterName}`);
    }

    const p = this.buildPlayerSchema(client.sessionId, critterName, spawn, /*isBot*/ false);
    this.state.players.set(client.sessionId, p);
    this.internal.set(client.sessionId, newInternal());
    console.log(`[BrawlRoom] ${client.sessionId} joined roomId=${this.roomId} (${this.state.players.size}/${this.maxClients})`);

    // 4 humans: start the match NOW, no need to wait out the timer.
    if (this.state.players.size >= MAX_PLAYERS) {
      this.transitionToCountdown();
    }
  }

  onLeave(client: Client, _consented: boolean) {
    const sid = client.sessionId;
    const phase = this.state.phase;

    // Waiting / ended: simple delete, no further logic. A human leaving
    // during waiting just frees the slot; the bot-fill timer handles the
    // rest once it expires.
    if (phase === 'waiting' || phase === 'ended') {
      this.state.players.delete(sid);
      this.internal.delete(sid);
      console.log(`[BrawlRoom] ${sid} left during ${phase} (${this.state.players.size} remaining)`);
      return;
    }

    // Countdown / playing: the leaver's critter is potentially still on the
    // arena with lives left. Two options:
    //   a) alive human+bot count after the leave is >= 2 → bot-takeover.
    //      Keep the PlayerSchema, flip isBot=true, reset held-input flags so
    //      the bot AI can cleanly take over from this tick on.
    //   b) < 2 → end the match as opponent_left (legacy behaviour for 2P).
    const leaver = this.state.players.get(sid);
    if (!leaver) {
      // Shouldn't happen, but be defensive.
      this.state.players.delete(sid);
      this.internal.delete(sid);
      return;
    }

    const remainingAlive = [...this.state.players.values()].filter(
      p => p.sessionId !== sid && p.alive,
    );

    if (remainingAlive.length >= 2 && leaver.alive) {
      leaver.isBot = true;
      const data = this.internal.get(sid);
      if (data) {
        data.inputMoveX = 0;
        data.inputMoveZ = 0;
        data.inputHeadbutt = false;
        data.inputAbility1 = false;
        data.inputAbility2 = false;
        data.inputUltimate = false;
      }
      console.log(`[BrawlRoom] ${sid} left during ${phase} → bot takeover (${remainingAlive.length} humans remain)`);
      return;
    }

    // Not enough players to keep the match alive: delete + end.
    this.state.players.delete(sid);
    this.internal.delete(sid);
    const survivor = remainingAlive[0];
    console.log(`[BrawlRoom] ${sid} left during ${phase} → ending match (${remainingAlive.length} remaining alive)`);
    this.endMatch('opponent_left', survivor?.sessionId ?? '');
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
   * Construct a fresh PlayerSchema for a human or a bot. Positions use the
   * spawn table; kit comes from the shared ability factory so everything
   * downstream treats bots and humans identically.
   */
  private buildPlayerSchema(
    sessionId: string,
    critterName: string,
    spawn: readonly [number, number],
    isBot: boolean,
  ): PlayerSchema {
    const p = new PlayerSchema();
    p.sessionId = sessionId;
    p.critterName = critterName;
    p.isBot = isBot;
    p.x = spawn[0];
    p.z = spawn[1];
    p.rotationY = Math.atan2(-spawn[0], -spawn[1]); // face arena centre
    p.lives = SIM.lives.default;
    p.alive = true;
    const abilities = createAbilityStates(critterName);
    for (const a of abilities) p.abilities.push(a);
    return p;
  }

  /**
   * Spawn ONE bot into the room. Uses a free spawn position (one not
   * currently occupied by a humano index), picks a critter different from
   * the humans already in the room when possible, and wires the same
   * internal data block a human would have.
   */
  private spawnBot(): void {
    const takenSlots = new Set<number>();
    for (const p of this.state.players.values()) {
      const i = SPAWN_POSITIONS.findIndex(s => s[0] === p.x && s[1] === p.z);
      if (i >= 0) takenSlots.add(i);
    }
    let spawnIdx = 0;
    for (let i = 0; i < SPAWN_POSITIONS.length; i++) {
      if (!takenSlots.has(i)) { spawnIdx = i; break; }
    }
    const spawn = SPAWN_POSITIONS[spawnIdx];

    // Prefer a critter no other player is using. If all 9 are unique, this
    // always finds a free one (size of humans + bots ≤ 4 < 9).
    const used = new Set<string>();
    for (const p of this.state.players.values()) used.add(p.critterName);
    const candidates = Object.keys(CRITTER_CONFIGS).filter(n => !used.has(n));
    const critterName = candidates.length > 0
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : DEFAULT_CRITTER;

    this.botCounter++;
    const sessionId = `bot_${this.botCounter}`;
    const bot = this.buildPlayerSchema(sessionId, critterName, spawn, /*isBot*/ true);
    this.state.players.set(sessionId, bot);
    this.internal.set(sessionId, newInternal());
    console.log(`[BrawlRoom] spawned bot ${sessionId} as ${critterName} (${this.state.players.size}/${MAX_PLAYERS})`);
  }

  /**
   * Moves the room from 'waiting' → 'countdown'. Generates a deterministic
   * arena seed so the clients build identical fragment layouts. Seed is
   * set BEFORE the phase change so the seed and the phase transition
   * arrive in the same Colyseus patch.
   */
  private transitionToCountdown(): void {
    if (this.state.phase !== 'waiting') return;
    const seed = (Math.random() * 0xFFFFFFFF) | 0;
    this.arenaSim = new ArenaSim(seed);
    this.state.arenaSeed = seed;
    this.state.arenaRadius = this.arenaSim.currentRadius;

    this.state.phase = 'countdown';
    this.state.countdownLeft = SIM.match.countdown;
    this.state.matchTimer = SIM.match.duration;
    this.state.waitingTimeLeft = 0;
    console.log(`[BrawlRoom] waiting → countdown (${this.state.players.size} players, seed=${seed})`);

    // Once we're in countdown, nobody else can join. Colyseus maxClients
    // already caps that but we also lock the room explicitly to avoid any
    // race where joinOrCreate finds this room during the transition.
    this.lock().catch(() => { /* already locked or disposing */ });
  }

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
        this.tickWaiting(dt);
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

  /**
   * Waiting-phase tick. Counts down the public waitingTimeLeft and, when it
   * hits zero with at least one human in the room, fills the remaining slots
   * with bots and kicks off the countdown. An empty room just holds the
   * timer indefinitely (keeps showing 60s — there's nobody to watch it
   * anyway until someone joins and triggers a reset via onJoin).
   */
  private tickWaiting(dt: number): void {
    if (this.state.players.size === 0) {
      // Hold the timer — nobody to count down for. Next onJoin resets it.
      this.state.waitingTimeLeft = WAITING_TIMEOUT;
      return;
    }
    this.state.waitingTimeLeft = Math.max(0, this.state.waitingTimeLeft - dt);
    if (this.state.waitingTimeLeft > 0) return;

    // Timer expired: fill up to MAX_PLAYERS with bots, then start.
    const slotsToFill = MAX_PLAYERS - this.state.players.size;
    for (let i = 0; i < slotsToFill; i++) this.spawnBot();
    this.transitionToCountdown();
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

    // 0. Bot AI — inject synthetic inputs for every bot BEFORE the human
    //    input path runs. Because everything downstream reads from
    //    `internal[sid].input*`, bots and humans go through the same
    //    physics/ability pipeline below. Only the input source differs.
    for (const p of players) {
      if (!p.isBot) continue;
      const data = this.internal.get(p.sessionId);
      if (!data) continue;
      const input = computeBotInput(p, players);
      data.inputMoveX = input.moveX;
      data.inputMoveZ = input.moveZ;
      data.inputHeadbutt = input.headbutt;
      data.inputAbility1 = input.ability1;
      data.inputAbility2 = input.ability2;
      data.inputUltimate = input.ultimate;
    }

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
