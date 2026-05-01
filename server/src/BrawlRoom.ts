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
import { resolveCollisions, checkFalloff, updateFalling, effectiveSpeed, isOnSlipperyZone, type ActiveZoneSnapshot } from './sim/physics.js';
import { createAbilityStates, tickPlayerAbilities, getAbilityKit } from './sim/abilities.js';
import { ArenaSim } from './sim/arena.js';
import { computeBotInput } from './sim/bot.js';
import {
  verifyPlayer, recordMatchResult,
  getAllBeltHolders, diffBeltHolders,
} from './db.js';

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
  /** Online identity from src/online-identity.ts (optional — guests can
   *  still play online, they just don't earn Online Belts). */
  playerId?: string;
  playerToken?: string;
  nickname?: string;
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
  // Online-belt identity (only set for human players who registered a
  // nickname via the REST API and passed verifyPlayer on join). Null for
  // bots and for humans who skipped the nickname modal.
  onlinePlayerId: string | null;
  /** Kills this match that were humans (not bots). TODO(belts-v2): wire
   *  headbutt last-hitter tracking to credit the actual slayer. For now
   *  stays at 0 — Slayer Belt will need a follow-up. */
  killsVsHumansThisMatch: number;
  /** 2026-04-30 final-L — Cheeto Cone Pulse pulse-accumulator.
   *  Counts elapsed seconds since the last pulse fired so the L
   *  can drain it in `pulseInterval` chunks regardless of variable
   *  tick spacing. */
  pulseAccum?: number;
  /** 2026-05-01 microfix — Cone Pulse counter for the per-pulse
   *  force ramp. First pulse uses base force; each subsequent pulse
   *  scales by 1 + (count - 1) × 0.5 so a target the first pulse
   *  shoved out of the cone radius still gets caught by the next.
   *  Reset on rising edge of conePulseL active.
   *  `pulseLastActive` mirrors the offline `lastActive` flag for
   *  edge detection. */
  pulseCount?: number;
  pulseLastActive?: boolean;
  /** 2026-04-30 final-L — Sebastian All-in cached starting facing
   *  (set on activation, consumed on resolution). The dash uses
   *  the rotationY at FIRE-TIME so the lateral slide is locked
   *  even if the pre-resolve frenzy buff happens to reorient. */
  allInDirX?: number;
  allInDirZ?: number;
  allInActive?: boolean;
  /** 2026-05-01 final block — Sebastian hold-to-fire L state.
   *  `lHoldCharging` mirrors the client flag and is set on the
   *  rising edge of `inputUltimate`. While charging the player is
   *  rooted (effectiveSpeed → 0 via the same critter-side gate)
   *  and the trajectory preview is painted client-side. On the
   *  falling edge of `inputUltimate` (or when the auto-release
   *  timer elapses) we set `allInActive = true` so step 2.g
   *  resolves the dash. `lHoldChargeTime` is the server's safety
   *  timer; `lHoldPrevInput` provides the rising-edge detection. */
  lHoldCharging?: boolean;
  lHoldChargeTime?: number;
  lHoldPrevInput?: boolean;
}

function newInternal(): InternalPlayerData {
  return {
    inputMoveX: 0, inputMoveZ: 0,
    inputHeadbutt: false, inputAbility1: false, inputAbility2: false, inputUltimate: false,
    respawnTimer: 0, anticipationTimer: 0, headbuttTimer: 0, hasInput: false,
    onlinePlayerId: null,
    killsVsHumansThisMatch: 0,
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
  /** Epoch ms at the moment 'playing' started — used for durationMs in
   *  the Online Belts recorded stats. Set in transitionFromCountdown and
   *  read once on endMatch. Null until the match actually starts. */
  private playingStartedAtMs: number | null = null;
  /** Authoritative slow-zone tracker (Kermit Poison Cloud, Kowalski
   *  Arctic Burst). Each zone is consulted by `effectiveSpeed` for
   *  every player and its `ttl` decremented once per tick. Zones
   *  emit a one-shot `zoneSpawned` broadcast to clients on creation,
   *  which is enough to render the matching VFX with the same
   *  duration — the room doesn't keep streaming updates. */
  private activeZones: Array<ActiveZoneSnapshot & { ttl: number; ownerSid: string }> = [];
  /** Authoritative projectile tracker (Kowalski Snowball — 2026-04-29
   *  K-session). Each projectile carries its own velocity, ttl,
   *  impact radius + status payload. Server integrates position,
   *  sweeps collision against every alive non-owner player each tick,
   *  applies knockback + slowTimer on hit, and broadcasts
   *  spawn/hit/expire events so clients render the same beat. */
  private activeProjectiles: Array<{
    id: number; ownerSid: string; ownerCritter: string;
    x: number; z: number; vx: number; vz: number;
    ttl: number; radius: number; impulse: number; slowDuration: number;
  }> = [];
  private projectileCounter = 0;

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

    // 2026-04-29 identity refinement — in-room duplicate detection.
    // Two browser tabs sharing the same localStorage will pass the
    // /api/player auth (same token + identityId), but we don't want
    // both connections counting as the SAME player in the same room
    // (would double-credit match results). If the candidate player
    // is verified AND another connection in this room is already
    // logged in with the same playerId, reject the second tab.
    //
    // 2026-04-29 final-K — switched from `client.send+leave` to
    // throwing during onJoin. Throwing is the supported Colyseus
    // way to reject a candidate: the message bubbles up to
    // `joinOrCreate` on the client as a real error so the catch
    // handler can show a meaningful overlay instead of the generic
    // "Could not connect" alert. The send+leave pattern raced the
    // socket closing before the typed message arrived, which is
    // exactly what surfaced as the connection failure Rafa saw.
    const incomingPlayerId = options.playerId && options.playerToken
      && verifyPlayer(options.playerId, options.playerToken)
      ? options.playerId
      : null;
    if (incomingPlayerId) {
      for (const data of this.internal.values()) {
        if (data.onlinePlayerId === incomingPlayerId) {
          console.log(`[BrawlRoom] rejected ${client.sessionId}: nickname already active in this room`);
          throw new Error('nickname_active_in_room');
        }
      }
    }

    const p = this.buildPlayerSchema(client.sessionId, critterName, spawn, /*isBot*/ false);
    this.state.players.set(client.sessionId, p);
    // 2026-05-01 final block — write the verified nickname onto
    // PlayerSchema so the cliente waiting room + future spectator
    // UI can show "Rafa (Trunk)" instead of just the critter name.
    // Guests (no verified identity) get an empty string and the
    // cliente falls back to the critter name display.
    if (typeof options.nickname === 'string') {
      const n = options.nickname.trim().slice(0, 16);
      if (n.length >= 3) p.nickname = n;
    }
    const internal = newInternal();
    // Verify the online identity if the client supplied one. Only a
    // verified identity gets credited on match-end; guests (no identity
    // or failed verification) play normally but earn nothing for belts.
    if (incomingPlayerId) {
      internal.onlinePlayerId = incomingPlayerId;
      console.log(`[BrawlRoom] ${client.sessionId} online identity verified (${options.nickname ?? options.playerId})`);
    } else if (options.playerId) {
      console.log(`[BrawlRoom] ${client.sessionId} failed identity verification — playing as guest`);
    }
    this.internal.set(client.sessionId, internal);
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
    // Cosmetic pack. Clients derive skybox + fog + ground + props from
    // this. Server picks uniformly so every match looks different. No
    // import dependency on client code — the list is small and stable,
    // duplicated here on purpose.
    const ARENA_PACK_IDS = [
      'jungle', 'frozen_tundra', 'desert_dunes', 'coral_beach', 'kitsune_shrine',
    ];
    const packId = ARENA_PACK_IDS[Math.floor(Math.random() * ARENA_PACK_IDS.length)]!;
    this.state.arenaPackId = packId;

    this.state.phase = 'countdown';
    this.state.countdownLeft = SIM.match.countdown;
    this.state.matchTimer = SIM.match.duration;
    this.state.waitingTimeLeft = 0;
    console.log(`[BrawlRoom] waiting → countdown (${this.state.players.size} players, seed=${seed}, pack=${packId})`);

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

    this.recordOnlineBeltStats(winnerSessionId);
  }

  /**
   * Persist per-player match stats for the Online Belts feature. Called
   * once at endMatch. Only players with a VERIFIED online identity
   * (nickname + token validated on join) get credited; guests are
   * ignored so they don't pollute leaderboards.
   *
   * Also detects belt changes: snapshots all 5 belt holders before the
   * match-result writes and again after, and broadcasts a 'beltChanged'
   * message to every client in the room for each belt whose holder is
   * now a different player than before. The cliente muestra un toast
   * tipo "X has taken the Throne Belt!".
   *
   * killsVsHumans is tracked via internal.killsVsHumansThisMatch, which
   * is 0 en v1 — se rellena cuando Fase 6 (last-hitter tracking in
   * physics.ts) lande; entonces el Slayer Belt tendrá datos reales.
   */
  private recordOnlineBeltStats(winnerSessionId: string): void {
    const durationMs = this.playingStartedAtMs !== null
      ? Date.now() - this.playingStartedAtMs
      : 0;

    // Snapshot BEFORE so we can diff belt changes afterwards.
    let beltsBefore: ReturnType<typeof getAllBeltHolders> | null = null;
    try {
      beltsBefore = getAllBeltHolders();
    } catch (err) {
      console.error('[Belts] failed to snapshot pre-match holders:', err);
    }

    let anyWriteSucceeded = false;
    for (const [sid, p] of this.state.players) {
      const internal = this.internal.get(sid);
      if (!internal?.onlinePlayerId) continue;      // guest or bot → skip
      if (p.isBot) continue;                        // bot-takeover edge case

      const won = sid === winnerSessionId;
      const livesLeft = Math.max(0, p.lives);
      try {
        recordMatchResult({
          playerId: internal.onlinePlayerId,
          won,
          durationMs,
          livesLeft,
          killsVsHumans: internal.killsVsHumansThisMatch,
          critterName: p.critterName,
        });
        anyWriteSucceeded = true;
        console.log(
          `[Belts] recorded ${won ? 'WIN' : 'loss'} for ${internal.onlinePlayerId} ` +
          `(${p.critterName}, lives=${livesLeft}, ms=${durationMs})`,
        );
      } catch (err) {
        console.error('[Belts] failed to record match result:', err);
      }
    }

    // Diff against the post-match snapshot only if at least one write
    // actually landed — pointless otherwise.
    if (anyWriteSucceeded && beltsBefore) {
      try {
        const beltsAfter = getAllBeltHolders();
        const changes = diffBeltHolders(beltsBefore, beltsAfter);
        for (const change of changes) {
          console.log(
            `[Belts] CHANGE ${change.belt}: ` +
            `new holder ${change.holder.nickname} (${change.holder.playerId})`,
          );
          this.broadcast('beltChanged', {
            belt: change.belt,
            nickname: change.holder.nickname,
            playerId: change.holder.playerId,
            value: change.holder.value,
          });
        }
      } catch (err) {
        console.error('[Belts] failed to diff holders post-match:', err);
      }
    }

    // Reset the stamp so a subsequent re-countdown starts fresh.
    this.playingStartedAtMs = null;
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
          // Stamp the real-clock start so Online Belts can report a
          // meaningful durationMs even if simulation ticks get throttled.
          this.playingStartedAtMs = Date.now();
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

      // 2026-04-30 final-L — Toxic Touch confused: invert the
      // movement axis on the affected player. Cliente already
      // sees their own input flipped via Critter.confusedTimer
      // (mirrored from this schema field). Server-side mirror
      // here makes sure bots also experience the inversion since
      // bot input is computed independently of cliente.
      if (p.confusedTimer > 0) { mx = -mx; mz = -mz; }

      // 2026-04-30 final-L — slippery acceleration penalty.
      const slipperyHere = isOnSlipperyZone(p, this.activeZones);
      const accelMul = slipperyHere ? 0.35 : 1.0;
      let speed = effectiveSpeed(p, this.activeZones);
      // 2026-05-01 final block — Sebastian holding the L is rooted.
      if (data.lHoldCharging) speed = 0;
      const accel = speed * SIM.movement.accelerationScale * accelMul;
      p.vx += mx * accel * dt;
      p.vz += mz * accel * dt;
    }

    // 2026-05-01 final block — Sebastian hold-to-fire L state machine.
    // Runs BEFORE tickPlayerAbilities so we can intercept the
    // `inputUltimate` flag and prevent the standard activation
    // path while charging (the dash fires on RELEASE, not press).
    for (const p of players) {
      if (!p.alive || p.falling) continue;
      const data = this.internal.get(p.sessionId);
      if (!data) continue;
      const kit = getAbilityKit(p.critterName);
      const lDef = kit[2];
      const lState = p.abilities[2];
      if (!lDef || !lState || !lDef.holdToFireL) {
        data.lHoldPrevInput = !!data.inputUltimate;
        continue;
      }
      const ultDown = !!data.inputUltimate;
      const ultPrev = !!data.lHoldPrevInput;
      const risingEdge = ultDown && !ultPrev;
      const fallingEdge = !ultDown && ultPrev;
      data.lHoldPrevInput = ultDown;
      if (data.lHoldCharging) {
        data.lHoldChargeTime = (data.lHoldChargeTime ?? 0) + dt;
        const maxSec = (lDef.holdToFireMaxMs ?? 3000) / 1000;
        if (fallingEdge || (data.lHoldChargeTime ?? 0) >= maxSec) {
          // Release → trigger resolution. Step 2.g picks it up.
          data.lHoldCharging = false;
          data.lHoldChargeTime = 0;
          data.allInActive = true;
          // Cooldown applied here so tickPlayerAbilities doesn't
          // try to re-activate next tick.
          lState.cooldownLeft = lDef.cooldown;
        }
        // Suppress activation while charging — tickPlayerAbilities
        // would otherwise activate the L on input=true.
        data.inputUltimate = false;
      } else if (risingEdge && lState.cooldownLeft <= 0 && !lState.active) {
        // Start charging. Cache lateral direction now so the dash
        // commits to the side that's closer to the rim from THIS
        // facing — same algorithm as the cliente preview.
        data.lHoldCharging = true;
        data.lHoldChargeTime = 0;
        const range = lDef.allInDashRange ?? 9.0;
        const right: [number, number] = [Math.cos(p.rotationY), -Math.sin(p.rotationY)];
        const left: [number, number] = [-right[0], -right[1]];
        const radEnd = (dx: number, dz: number) => Math.sqrt(
          (p.x + dx * range) ** 2 + (p.z + dz * range) ** 2,
        );
        const dir = radEnd(right[0], right[1]) >= radEnd(left[0], left[1]) ? right : left;
        data.allInDirX = dir[0];
        data.allInDirZ = dir[1];
        // Suppress activation: standard flow would set lState.active
        // and start the windup; we want the L to stay inactive
        // while the user holds the input.
        data.inputUltimate = false;
        // Broadcast charge-start so remote viewers can paint the
        // same trajectory preview their local Sebastian sees.
        this.broadcast('lChargeStart', {
          sessionId: p.sessionId,
          x: p.x, z: p.z,
          dirX: dir[0], dirZ: dir[1],
          range,
          maxMs: lDef.holdToFireMaxMs ?? 3000,
        });
      } else if (data.lHoldCharging && !ultDown) {
        // Defensive: suppress in case the rising-edge clause
        // didn't run but we somehow ended up in charging without
        // input — release immediately.
        data.lHoldCharging = false;
        data.allInActive = true;
        lState.cooldownLeft = lDef.cooldown;
        data.inputUltimate = false;
      }
    }

    // 2. Tick abilities (generic dispatcher) and broadcast fire events
    //    + new lingering slow zones.
    for (const p of players) {
      if (!p.alive || p.falling) continue;
      const data = this.internal.get(p.sessionId);
      if (!data) continue;
      const out = tickPlayerAbilities(p, players, dt, {
        ability1: data.inputAbility1,
        ability2: data.inputAbility2,
        ultimate: data.inputUltimate,
      });
      for (const ev of out.events) {
        this.broadcast('abilityFired', ev);
      }
      for (const z of out.zoneSpawns) {
        // Authoritative state: track on the room so effectiveSpeed
        // applies the slow until the zone expires.
        this.activeZones.push({
          x: z.x, z: z.z,
          radius: z.radius,
          slowMultiplier: z.slowMultiplier,
          ttl: z.duration,
          ownerSid: z.ownerSid,
          slippery: z.slippery,
          sinkhole: z.sinkhole,
          pullForce: z.pullForce,
        });
        // Visual mirror: clients render the matching ground ring +
        // disc with the same duration. Single one-shot — clients
        // drive their own lifetime locally, no streaming updates.
        this.broadcast('zoneSpawned', {
          x: z.x, z: z.z,
          radius: z.radius,
          duration: z.duration,
          slowMultiplier: z.slowMultiplier,
          ownerSid: z.ownerSid,
          slippery: !!z.slippery,
          sinkhole: !!z.sinkhole,
        });
        // 2026-04-30 final-polish — Sihans Sinkhole knocks out real
        // arena fragments under the hole disc. Server-authoritative:
        // pick indices, kill them in the simulation (so isOnArena
        // returns false on next tick → players standing there fall),
        // and broadcast the indices so clients can knock out the
        // matching meshes and play the fall animation.
        if (z.sinkhole) {
          const candidates = this.arenaSim.getAliveFragmentsInDisc(z.x, z.z, z.radius);
          const killed = this.arenaSim.killFragmentIndices(candidates);
          if (killed.length > 0) {
            this.broadcast('arenaFragmentsKilled', { indices: killed });
          }
        }
      }
      // 2026-04-29 K-session — Kowalski Snowball projectile spawns.
      // Same one-shot broadcast pattern as zones: each projectile
      // gets a unique server-generated id; clients run the same
      // straight-line integration locally and despawn on `projectileHit`
      // / `projectileExpired` events.
      for (const p of out.projectileSpawns) {
        this.projectileCounter++;
        const id = this.projectileCounter;
        this.activeProjectiles.push({
          id,
          ownerSid: p.ownerSid,
          ownerCritter: p.ownerCritter,
          x: p.x, z: p.z, vx: p.vx, vz: p.vz,
          ttl: p.ttl, radius: p.radius,
          impulse: p.impulse, slowDuration: p.slowDuration,
        });
        this.broadcast('projectileSpawned', {
          id,
          ownerSid: p.ownerSid,
          ownerCritter: p.ownerCritter,
          x: p.x, z: p.z, vx: p.vx, vz: p.vz,
          ttl: p.ttl, radius: p.radius,
        });
      }
    }
    // 2.b. Tick zone TTLs — drop expired ones.
    for (let i = this.activeZones.length - 1; i >= 0; i--) {
      this.activeZones[i].ttl -= dt;
      if (this.activeZones[i].ttl <= 0) this.activeZones.splice(i, 1);
    }
    // 2.c. Tick projectiles — integrate, sweep collision against
    // alive non-owner players (skip owner + immune + falling), apply
    // knockback + slowTimer on hit, despawn on hit OR ttl OR
    // out-of-arena. Each terminal state emits a single broadcast so
    // clients can despawn in lockstep.
    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const pr = this.activeProjectiles[i];
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;
      pr.ttl -= dt;
      let consumed = false;
      let hitVictim: PlayerSchema | null = null;
      // Sweep
      for (const target of players) {
        if (target.sessionId === pr.ownerSid) continue;
        if (!target.alive || target.falling) continue;
        if (target.immunityTimer > 0) continue;
        const dx = target.x - pr.x;
        const dz = target.z - pr.z;
        const reach = pr.radius + 0.55; // critter capsule radius is 0.55
        if (dx * dx + dz * dz <= reach * reach) {
          hitVictim = target;
          break;
        }
      }
      if (hitVictim) {
        const speedMag = Math.sqrt(pr.vx * pr.vx + pr.vz * pr.vz) || 1;
        hitVictim.vx += (pr.vx / speedMag) * pr.impulse;
        hitVictim.vz += (pr.vz / speedMag) * pr.impulse;
        hitVictim.slowTimer = Math.max(hitVictim.slowTimer, pr.slowDuration);
        this.broadcast('projectileHit', {
          id: pr.id,
          victimSid: hitVictim.sessionId,
          x: pr.x, z: pr.z,
        });
        consumed = true;
      } else if (pr.ttl <= 0) {
        this.broadcast('projectileExpired', { id: pr.id, x: pr.x, z: pr.z });
        consumed = true;
      } else {
        // Out-of-arena clamp: snowball flies past the lethal radius
        // → expire silently. Uses arenaRadius approximation; not
        // perfect for irregular fragments but cheap enough.
        const r = Math.sqrt(pr.x * pr.x + pr.z * pr.z);
        if (r > this.arenaSim.currentRadius + 4) {
          this.broadcast('projectileExpired', { id: pr.id, x: pr.x, z: pr.z });
          consumed = true;
        }
      }
      if (consumed) this.activeProjectiles.splice(i, 1);
    }
    // 2.d. Decrement slowTimer for every player.
    for (const p of players) {
      if (p.slowTimer > 0) p.slowTimer = Math.max(0, p.slowTimer - dt);
    }

    // 2.e. 2026-04-30 final-L — per-tick L mechanics (Cone Pulse,
    // Saw Shell contact, Sinkhole pull, All-in resolution). The
    // frenzy slot is index 2 by convention; we read its def via
    // the kit and branch on flags.
    for (const p of players) {
      if (!p.alive || p.falling) continue;
      const kit = getAbilityKit(p.critterName);
      const lDef = kit[2];
      const lState = p.abilities[2];
      if (!lDef || !lState) continue;
      // Decrement confused/stun timers up here so they expire
      // exactly once per tick regardless of which L touches them.
      // (slowTimer / immunityTimer already decremented elsewhere.)
      if (p.confusedTimer > 0) p.confusedTimer = Math.max(0, p.confusedTimer - dt);
      if (p.stunTimer > 0) p.stunTimer = Math.max(0, p.stunTimer - dt);

      // 2026-05-01 microfix — Cone Pulse rising-edge detection runs
      // BEFORE the active gate so the per-pulse counter resets even
      // after the L falls off. Without this, the second activation
      // of conePulseL inherits stale pulseLastActive=true and the
      // ramp counter never resets.
      if (lDef.conePulseL) {
        const isActive = lState.active && lState.windUpLeft <= 0;
        const data = this.internal.get(p.sessionId);
        if (data) {
          if (isActive && !data.pulseLastActive) {
            data.pulseAccum = 0;
            data.pulseCount = 0;
          }
          data.pulseLastActive = isActive;
        }
      }

      if (!lState.active || lState.windUpLeft > 0) continue;

      // --- Cone Pulse (Cheeto) ---
      // 2026-05-01 microfix — Per-pulse force RAMP: pulse N uses
      // baseForce × (1 + (N - 1) × 0.5). Pre-fix the first pulse
      // shoved the target out of the 5.5 u radius and every later
      // pulse missed; the ramp catches up.
      if (lDef.conePulseL) {
        const data = this.internal.get(p.sessionId);
        if (data) {
          if (data.pulseAccum === undefined) data.pulseAccum = 0;
          if (data.pulseCount === undefined) data.pulseCount = 0;
          data.pulseAccum += dt;
          const interval = lDef.pulseInterval ?? 0.30;
          while (data.pulseAccum >= interval) {
            data.pulseAccum -= interval;
            data.pulseCount++;
            // 2026-05-01 final block — rolling wave model. Each
            // pulse is a forward-moving band, force pushes targets
            // along facing (not radial). Doubling ramp capped at 8.
            const ramp = Math.min(Math.pow(2, data.pulseCount - 1), 8);
            const halfCone = ((lDef.pulseAngleDeg ?? 45) * Math.PI) / 180;
            const cosCone = Math.cos(halfCone);
            const facingX = Math.sin(p.rotationY);
            const facingZ = Math.cos(p.rotationY);
            const baseForce = lDef.pulseForce ?? 28;
            const effectiveForce = baseForce * ramp;
            const waveStep = 1.4;
            const waveThickness = 2.0;
            const waveCenter = data.pulseCount * waveStep;
            const waveMin = Math.max(0.3, waveCenter - waveThickness * 0.5);
            const waveMax = waveCenter + waveThickness * 0.5;
            for (const other of players) {
              if (other === p || !other.alive || other.falling) continue;
              if (other.immunityTimer > 0) continue;
              const dx = other.x - p.x;
              const dz = other.z - p.z;
              const d = Math.sqrt(dx * dx + dz * dz);
              if (d < waveMin || d > waveMax || d < 0.01) continue;
              const nx = dx / d;
              const nz = dz / d;
              if (nx * facingX + nz * facingZ < cosCone) continue;
              const fall = 1 - Math.abs(d - waveCenter) / (waveThickness * 0.5);
              other.vx += facingX * effectiveForce * fall;
              other.vz += facingZ * effectiveForce * fall;
            }
            this.broadcast('lPulse', {
              sessionId: p.sessionId,
              x: p.x, z: p.z, rotationY: p.rotationY,
              radius: lDef.pulseRadius ?? 4.5,
              angleDeg: lDef.pulseAngleDeg ?? 45,
              waveCenter,
              waveThickness,
              count: data.pulseCount,
            });
          }
        }
      }

      // --- Stampede ramming (Trunk) — same shape as Saw Shell but
      //     with a different impulse value. 2026-05-01 microfix.
      if (lDef.rammingL) {
        const reach = 0.55 + 0.55 + 0.10;
        const impulse = lDef.ramContactImpulse ?? 50;
        for (const other of players) {
          if (other === p || !other.alive || other.falling) continue;
          if (other.immunityTimer > 0) continue;
          const dx = other.x - p.x;
          const dz = other.z - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > reach * reach || d2 < 0.0001) continue;
          const d = Math.sqrt(d2);
          other.vx += (dx / d) * impulse;
          other.vz += (dz / d) * impulse;
        }
      }

      // --- Saw Shell (Shelly) — contact knockback against any
      //     non-immune non-falling enemy in collision range.
      if (lDef.sawL) {
        const reach = 0.55 + 0.55 + 0.10; // both critter radii + small margin
        const impulse = lDef.sawContactImpulse ?? 32;
        for (const other of players) {
          if (other === p || !other.alive || other.falling) continue;
          if (other.immunityTimer > 0) continue;
          const dx = other.x - p.x;
          const dz = other.z - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > reach * reach || d2 < 0.0001) continue;
          const d = Math.sqrt(d2);
          other.vx += (dx / d) * impulse;
          other.vz += (dz / d) * impulse;
        }
      }

      // --- Sinkhole (Sihans) — the zone is already broadcast at
      //     fire time; the per-tick PULL is applied by the zone
      //     loop in step 2.f below for any sinkhole zone.

      // --- All-in (Sebastian) windup tracking — cache facing on
      //     the rising edge so the lateral dash uses the direction
      //     Sebastian was facing AT FIRE TIME, not whatever the
      //     post-windup orientation happens to be.
      if (lDef.allInL) {
        const data = this.internal.get(p.sessionId);
        if (data && !data.allInActive) {
          data.allInActive = true;
          // Lateral = facing rotated +90° (right-hand). The fixed
          // direction stays cached until resolution.
          data.allInDirX = Math.cos(p.rotationY);
          data.allInDirZ = -Math.sin(p.rotationY);
        }
      }

      // --- Toxic Touch (Kermit) — apply confused on contact.
      if (lDef.toxicTouchL) {
        const reach = 0.55 + 0.55 + 0.10;
        const dur = lDef.confusedDuration ?? 3.0;
        for (const other of players) {
          if (other === p || !other.alive || other.falling) continue;
          if (other.immunityTimer > 0) continue;
          const dx = other.x - p.x;
          const dz = other.z - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > reach * reach || d2 < 0.0001) continue;
          other.confusedTimer = Math.max(other.confusedTimer, dur);
        }
      }
    }

    // 2.f. 2026-04-30 final-L — sinkhole zone pull. Continuous
    // inward velocity nudge on every critter inside a sinkhole
    // zone they don't own.
    for (const z of this.activeZones) {
      if (!z.sinkhole) continue;
      const force = z.pullForce ?? 14;
      for (const p of players) {
        if (!p.alive || p.falling) continue;
        if (z.ownerSid !== undefined && z.ownerSid === p.sessionId) continue;
        if (p.immunityTimer > 0) continue;
        const dx = z.x - p.x;
        const dz = z.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > z.radius || d < 0.01) continue;
        // Stronger pull near the centre.
        const fall = 1 - d / z.radius;
        p.vx += (dx / d) * force * fall * dt;
        p.vz += (dz / d) * force * fall * dt;
      }
    }

    // 2.g. 2026-04-30 final-L — All-in resolution. Falling-edge
    // detect: if the player WAS in an all-in windup last tick and
    // the L just ended this tick, run the lateral dash + hit
    // check. On hit: huge knockback to target, ability ends. On
    // miss: Sebastian gets a self-knockback toward the cached
    // dash direction (high-risk read).
    for (const p of players) {
      if (!p.alive || p.falling) continue;
      const data = this.internal.get(p.sessionId);
      if (!data || !data.allInActive) continue;
      const lState = p.abilities[2];
      if (lState && lState.active) continue; // still windup
      // Resolution time.
      const kit = getAbilityKit(p.critterName);
      const lDef = kit[2];
      if (!lDef || !lDef.allInL) {
        data.allInActive = false;
        continue;
      }
      const range = lDef.allInDashRange ?? 5.5;
      const cachedX = data.allInDirX ?? Math.cos(p.rotationY);
      const cachedZ = data.allInDirZ ?? -Math.sin(p.rotationY);
      const altX = -cachedX;
      const altZ = -cachedZ;
      const radEnd = (ex: number, ez: number) => Math.sqrt(ex * ex + ez * ez);
      const cachedEnd = radEnd(p.x + cachedX * range, p.z + cachedZ * range);
      const altEnd = radEnd(p.x + altX * range, p.z + altZ * range);
      const dx = cachedEnd >= altEnd ? cachedX : altX;
      const dz = cachedEnd >= altEnd ? cachedZ : altZ;
      // 2026-05-01 — sweep + record hitT so the caster can teleport
      // INTO the resolution. Without this, the dash was just a
      // remote-effect knockback while Sebastian stood still.
      // 2026-05-01 last-minute — SAMPLES 12 → 18 + reach margin
      // 0 → 0.55 to make the slash hittable. Mirrors offline.
      let hitVictim: PlayerSchema | null = null;
      let hitT = 0;
      const SAMPLES = 18;
      for (let i = 1; i <= SAMPLES && !hitVictim; i++) {
        const t = (i / SAMPLES) * range;
        const sx = p.x + dx * t;
        const sz = p.z + dz * t;
        for (const other of players) {
          if (other === p || !other.alive || other.falling) continue;
          if (other.immunityTimer > 0) continue;
          const odx = other.x - sx;
          const odz = other.z - sz;
          const reach = 0.55 + 0.55 + 0.55;
          if (odx * odx + odz * odz <= reach * reach) {
            hitVictim = other;
            hitT = t;
            break;
          }
        }
      }
      if (hitVictim) {
        // HIT — teleport Sebastian to just-before the victim so the
        // slash reads as "I sprinted there and caught you", not the
        // previous remote effect. Hard-stop velocity returns
        // control instantly.
        const arrivalT = Math.max(0, hitT - 0.55 * 0.7);
        p.x += dx * arrivalT;
        p.z += dz * arrivalT;
        p.vx = 0;
        p.vz = 0;
        const force = lDef.allInHitForce ?? 100;
        hitVictim.vx += dx * force;
        hitVictim.vz += dz * force;
      } else {
        // MISS — Sebastian commits all the way past the rim.
        // Teleport to the dash endpoint × 1.5 (guarantees we're
        // outside arena maxRadius even if he started inside) +
        // outward velocity so the server's `isOnArena` check next
        // tick triggers `falling` (no manual void check needed;
        // existing collapse logic handles it).
        p.x += dx * range * 1.5;
        p.z += dz * range * 1.5;
        const sf = lDef.allInMissSelfForce ?? 130;
        p.vx = dx * sf;
        p.vz = dz * sf;
      }
      this.broadcast('lAllInResolve', {
        sessionId: p.sessionId,
        x: p.x, z: p.z,
        dirX: dx, dirZ: dz,
        hit: !!hitVictim,
      });
      data.allInActive = false;
      data.allInDirX = undefined;
      data.allInDirZ = undefined;
    }

    // 3. Integrate position + friction + dead zone + max speed cap + facing
    for (const p of players) {
      if (!p.alive || p.falling) continue;
      const data = this.internal.get(p.sessionId);
      if (!data) continue;

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      // 2026-04-30 final-L — slippery zones (Kowalski Frozen Floor)
      // increase the friction half-life ~5×, so velocity decays MUCH
      // slower → critters keep sliding even without input.
      const slippery = isOnSlipperyZone(p, this.activeZones);
      let halfLife = data.hasInput ? SIM.movement.frictionHalfLife : SIM.movement.idleFrictionHalfLife;
      if (slippery) halfLife *= 5;
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

    // 4. Collisions + knockback (player vs player).
    // `this.internal` is passed so headbutt hits can be attributed for
    // Online Belts Slayer credit when the defender eventually falls.
    resolveCollisions(players, this.internal);

    // 5. Falloff detection — uses the authoritative fragment layout
    checkFalloff(players, this.internal, (x, z) => this.arenaSim.isOnArena(x, z));

    // 6. Falling animation + respawn countdown
    const fallResult = updateFalling(players, this.internal, dt);
    // Credit Slayer-Belt kills: every `death` carries the sessionId of
    // the last-attacker (if the hit was recent enough). If that attacker
    // is a human with a verified online identity, bump their per-match
    // counter — BrawlRoom.recordOnlineBeltStats reads it on endMatch.
    for (const death of fallResult.deaths) {
      const killerSid = death.attackerSid;
      if (!killerSid) continue;
      const killer = this.state.players.get(killerSid);
      if (!killer || killer.isBot) continue;            // bot → no credit
      const killerInternal = this.internal.get(killerSid);
      if (!killerInternal?.onlinePlayerId) continue;    // guest → no credit
      const victim = this.state.players.get(death.victimSid);
      if (!victim || victim.isBot) continue;            // killed a bot → skip (Slayer is vs HUMANS only)
      killerInternal.killsVsHumansThisMatch += 1;
    }
    for (const sid of fallResult.toRespawn) {
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
