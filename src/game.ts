import * as THREE from 'three';
import { Arena } from './arena';
import { Critter, CRITTER_PRESETS, type CritterConfig } from './critter';
import { updatePlayer } from './player';
import { consumeMenuAction, clearMenuActions } from './input';
import { updateBot } from './bot';
import { updateAbilities } from './abilities';
import { resolveCollisions, checkFalloff, updateFalling } from './physics';
import {
  updateHUD, showOverlay, hideOverlay,
  initAbilityHUD, updateAbilityHUD,
  initAllLivesHUD, updateAllLivesHUD,
  showTitleScreen, hideTitleScreen,
  showCharacterSelect, updateCharacterSelect, hideCharacterSelect,
  showEndScreen, hideEndScreen,
  showMatchHud,
  setSlotClickHandler, setTitleModeHandlers, updateTitleModeSelection, isOnlineModeAvailable, setEndTapHandler,
  setPortalLegend, setPortalToggleHandler,
  showWaitingScreen, hideWaitingScreen, updateWaitingScreen,
  showSpectatorPrompt, hideSpectatorPrompt,
  setEndMatchStats, clearEndMatchStats,
  type EndResult, type WaitingScreenData,
} from './hud';
import { applyHitStop, FEEL } from './gamefeel';
import { showPreview, swapPreviewCritter, hidePreview } from './preview';
import { play as playSound, playMusic, preloadMusic } from './audio';
import {
  recordPick, recordOutcome, recordFall, recordWin,
  addUnlockedBadges, getStats,
} from './stats';
import { checkBadgeUnlocks } from './badges';
import { maybeShowBadgeToast } from './badge-toast';
import { getDisplayRoster, getRosterEntry, getPlayableNames, getIdlePreloadNames, type RosterEntry } from './roster';
import { preloadModels } from './model-loader';
import {
  isFromPortal, resolvePortalCharacter, setPortalPlayerInfo,
  initPortals, updatePortals, disposePortals,
  getPortalExitUrl, getPortalReturnUrl, clearPortalContext,
  togglePortalExpanded, hasStartPortal,
} from './portal';
import type { Room } from 'colyseus.js';
import { getStateCallbacks } from 'colyseus.js';
import { sendInput, onAbilityFired, onBeltChanged, onZoneSpawned, type AbilityFiredEvent } from './network';
import { showOnlineBeltToast } from './online-belt-toast';
import { ensureOnlineIdentity } from './hud/nickname-modal';
import { type OnlineIdentity } from './online-identity';
import { getMoveVector, isHeld } from './input';
import { triggerCameraShake, triggerHitStop, applyDashFeedback } from './gamefeel';
import { play as playSoundEffect } from './audio';
import { spawnShockwaveRing, spawnFrenzyBurst, getCritterVfxPalette, clearActiveZones, pushNetworkZone, spawnZoneRing } from './abilities';
import { spawnDustPuff, clearDustPuffs } from './dust-puff';
import { getRandomPackId, isArenaPackId, type ArenaPackId } from './arena-decorations';
import { getPreviewPackId } from './arena-decor-layouts';

type Phase = 'title' | 'character_select' | 'countdown' | 'playing' | 'ended' | 'online';

const SPAWN_POSITIONS: [number, number][] = [
  [0, -6],
  [0, 6],
  [-6, 0],
  [6, 0],
];
const MAX_CRITTERS_PER_MATCH = SPAWN_POSITIONS.length;

/**
 * Maximum players per online room. Must match `MAX_PLAYERS` in the server
 * (`server/src/BrawlRoom.ts`). Used to size the waiting-screen slot grid
 * and the "needed to start" display. Offline matches use the same 4-cap
 * via SPAWN_POSITIONS.length.
 */
const ONLINE_MAX_PLAYERS = 4;

/**
 * Build the match roster: player config first, then bots drawn from the
 * REAL playable critters (the 9-character roster), never the legacy
 * internal Rojo/Azul/Verde/Morado placeholders. Shuffled per match so
 * two consecutive matches don't produce the same bot lineup.
 *
 * If the pool has fewer uniques than the requested botCount, we wrap
 * around. That's only possible in degenerate configurations (<=1
 * playable); not a concern with the current 9-critter roster.
 */
function buildMatchRoster(
  playerConfig: CritterConfig,
  botCount: number,
): CritterConfig[] {
  const roster: CritterConfig[] = [playerConfig];

  // Real-roster pool: CRITTER_PRESETS entries whose name is in the
  // playable roster list, minus the player's own critter so they
  // never mirror-match themselves when other options exist.
  const playable = new Set(getPlayableNames());
  const pool = CRITTER_PRESETS.filter(
    c => playable.has(c.name) && c.name !== playerConfig.name,
  );

  if (pool.length === 0) return roster;

  // Fisher-Yates shuffle for visible match-to-match variety.
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (let i = 0; i < botCount; i++) {
    roster.push(shuffled[i % shuffled.length]);
  }
  return roster;
}

/** Create a minimal CritterConfig for preview-only (WIP characters without gameplay). */
function previewConfigFromRoster(entry: RosterEntry): CritterConfig {
  return {
    name: entry.displayName,
    color: entry.baseColor,
    speed: 10,
    mass: 1.0,
    headbuttForce: 14,
    role: entry.role,
    tagline: entry.tagline,
  };
}

export class Game {
  scene: THREE.Scene;
  arena: Arena;
  critters: Critter[] = [];
  player!: Critter;
  private playerIndex = 0;
  // Start on the first playable entry in the display roster
  private selectedIdx = getDisplayRoster().findIndex(e => e.status === 'playable');

  private phase: Phase = 'title';
  private phaseTimer = 0;
  private matchTimer = FEEL.match.duration;
  /** performance.now() of the frame where phase transitioned to 'playing'.
   *  Used to measure match duration for the Speedrun Belt badge. 0 while
   *  in menus. */
  private matchStartMs = 0;

  /** Per-critter drop-from-sky state during the 3-2-1 countdown. When a
   *  critter's y crosses 0, we play a thud + spawn a dust puff and drop
   *  it from the map so subsequent frames don't re-fire. Cleared at the
   *  start of every countdown. */
  /** Per-critter drop state during the countdown entrance. `delay` staggers
   *  the fall so the roster doesn't land in sync; `fallStarted` gates the
   *  skeletal 'fall' clip so we only trigger it once when gravity kicks in. */
  private countdownDrops = new Map<Critter, {
    y: number; vy: number; delay: number; fallStarted: boolean;
  }>();
  private displayRoster: RosterEntry[] = getDisplayRoster();

  // --- Online mode state (null when offline) ---
  private room: Room | null = null;
  private onlineCritters = new Map<string, Critter>(); // sessionId → visual
  private lastServerPhase: string = '';                 // for transition detection
  /** When true, confirming the character select connects to server instead
   *  of starting a local match. Set by enterOnlineCharacterSelect(). */
  private selectForOnline: boolean = false;
  /** Guard so the online portal hit only triggers once per match. */
  private portalRedirecting: boolean = false;
  /** Prevents double-fire of the async restart flow (R pressed twice fast). */
  private restartInProgress: boolean = false;
  /** True while connectOnlineWith is awaiting server join. Prevents
   *  second SPACE from spawning a parallel connect and leaving the
   *  client with two half-initialised rooms. */
  private connectInProgress: boolean = false;
  /** Currently highlighted mode on the title screen (keyboard navigation). */
  private titleMode: 'bots' | 'online' = 'bots';
  /** Offline-only pause flag. When true, the 'playing' branch of update()
   *  short-circuits (no input, no bot AI, no physics) and the DOM pause
   *  menu overlay is shown. Toggled by ESC and the pause buttons. */
  private paused: boolean = false;
  /** Set after the nickname modal resolves (or from localStorage cache)
   *  when the player enters online mode. Sent with match-result writes so
   *  the server can credit stats to the right player row. Null offline. */
  private onlineIdentity: OnlineIdentity | null = null;


  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.arena = new Arena(scene);

    // Initial "background" roster for the title and character select phases.
    // These critters are disposed and rebuilt at enterCountdown with the
    // actual match roster. Keeps 4 placeholders bobbing in the background
    // while the player is in menus, without any special-casing.
    this.rebuildCritters(CRITTER_PRESETS.slice(0, MAX_CRITTERS_PER_MATCH));

    // Wire up tap/click handlers for menu UX (desktop click + mobile tap)
    setSlotClickHandler((idx: number) => {
      if (this.phase !== 'character_select') return;
      const entry = this.displayRoster[idx];
      if (!entry || entry.status === 'locked') return;
      if (idx === this.selectedIdx && entry.status === 'playable') {
        // Tap on already-selected playable slot → confirm
        if (this.selectForOnline) {
          this.connectOnlineWith(entry.displayName);
        } else {
          this.enterCountdown();
        }
      } else {
        // Tap on different slot → select it for preview (playable or WIP)
        this.selectedIdx = idx;
        updateCharacterSelect(this.selectedIdx);
        this.swapPreviewForEntry(entry);
      }
    });

    // Title screen mode buttons — click directly confirms that mode.
    // Hover/arrow keys only HIGHLIGHT; Enter confirms the highlighted one.
    setTitleModeHandlers(
      (mode) => {
        if (this.phase !== 'title') return;
        this.titleMode = mode;
        updateTitleModeSelection(mode);
      },
      (mode) => {
        if (this.phase !== 'title') return;
        // Block click-confirm while a previous connect/restart is still in flight.
        if (this.connectInProgress || this.restartInProgress) return;
        if (mode === 'online') this.enterOnlineCharacterSelect();
        else this.enterCharacterSelect();
      },
    );

    setEndTapHandler(() => {
      // Fires from the end-screen DOM click. Works in both offline
      // ('ended' phase) and online (phase 'online' + server phase 'ended').
      // restartMatch itself decides offline-vs-online reconnect flow.
      if (this.restartInProgress || this.connectInProgress) return;
      if (this.phase === 'ended') {
        this.restartMatch();
        return;
      }
      if (this.phase === 'online') {
        const serverPhase = (this.room?.state as any)?.phase;
        if (serverPhase === 'ended') this.restartMatch();
      }
    });

    this.initPortalKeys();

    // Mobile portal toggle button → same toggle as desktop P key
    setPortalToggleHandler(() => togglePortalExpanded());

    // Pause menu wiring — ESC toggles pause in offline vs-bots while
    // in 'playing'. The menu's three buttons resume / restart / quit.
    this.initPauseMenu();

    // Portal entry: skip title + character select, go straight to match
    if (isFromPortal()) {
      this.selectedIdx = resolvePortalCharacter();
      console.debug('[Game] portal entry → direct to match, character idx:', this.selectedIdx);
      this.enterCountdown();
    } else {
      this.enterTitle();
    }

    // Warm the model cache in browser idle time so character-select
    // swaps are instant and `enterCountdown`'s preload is a cache hit.
    // Only the playable critters (internal Rojo/Azul/Verde/Morado
    // don't ship GLBs) AND not flagged `heavyAsset` (Kermit) — heavy
    // assets stay on-demand to avoid background traffic on every
    // visitor. Scheduled AFTER enterTitle() so the title paints
    // first — the user never sees this blocking.
    this.scheduleIdlePreload();
  }

  /**
   * Kick off a background fetch of every preload-eligible critter's
   * GLB during browser idle time. Uses `requestIdleCallback` where
   * available, falls back to `setTimeout`. Failures are swallowed
   * by `preloadModels` (Promise.allSettled). Cache hits on subsequent
   * loads eliminate the character-select → countdown fetch spike.
   *
   * The list comes from `getIdlePreloadNames()` (playable AND not
   * `heavyAsset`). Kermit is currently the only heavy entry; he is
   * still fully playable but his GLB is fetched on-demand the first
   * time the player previews / confirms his slot, not in the
   * background for every visitor.
   */
  private scheduleIdlePreload(): void {
    const paths = getIdlePreloadNames()
      .map((n) => getRosterEntry(n)?.glbPath)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length === 0) return;
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    const fire = () => {
      void preloadModels(paths);
    };
    if (ric) ric(fire, { timeout: 5000 });
    else setTimeout(fire, 1200);
  }

  // -------------------------------------------------------------------------
  // Pause menu (offline vs-bots only)
  // -------------------------------------------------------------------------

  private pauseMenuEl: HTMLElement | null = null;

  private initPauseMenu(): void {
    this.pauseMenuEl = document.getElementById('pause-menu');
    if (!this.pauseMenuEl) {
      console.warn('[Game] #pause-menu not found — pause unavailable');
      return;
    }

    // ESC toggle during offline gameplay. We capture the event at the
    // window level with `capture: true` so the menu opens even if some
    // other handler later calls preventDefault.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || e.repeat) return;
      // Only offline. Online has no pause (authoritative server).
      if (this.phase !== 'playing' || this.room) return;
      this.setPaused(!this.paused);
      e.preventDefault();
    });

    document.getElementById('btn-pause-resume')
      ?.addEventListener('click', () => this.setPaused(false));
    document.getElementById('btn-pause-restart')
      ?.addEventListener('click', () => {
        this.setPaused(false);
        if (!this.restartInProgress) this.restartMatch();
      });
    document.getElementById('btn-pause-quit')
      ?.addEventListener('click', () => {
        this.setPaused(false);
        this.enterTitle();
      });
  }

  private setPaused(v: boolean): void {
    this.paused = v;
    if (this.pauseMenuEl) {
      this.pauseMenuEl.classList.toggle('hidden', !v);
    }
    // ESC also pushes a 'back' menu action via input.ts. Drop it so the
    // title phase doesn't see a stale back-press on the next transition.
    clearMenuActions();
  }

  /**
   * Public read-only pause probe. Used by the outer game loop in main.ts
   * to skip per-frame ambient visual tickers (dust puffs, camera shake)
   * while the offline pause menu is up — otherwise an in-flight puff
   * animation would keep expanding behind the menu, and a lingering
   * camera shake would tremble the frozen frame.
   *
   * Only the offline pause branch sets `this.paused = true`; online
   * matches stay on false because the server is authoritative and no
   * pause concept exists. So callers can treat this as "freeze offline
   * ambient visuals" safely.
   */
  public isPaused(): boolean {
    return this.paused;
  }

  // -------------------------------------------------------------------------
  // Phase transitions
  // -------------------------------------------------------------------------

  private enterTitle(): void {
    clearMenuActions();
    this.phase = 'title';
    this.selectForOnline = false;
    // A quit-to-title from the pause menu leaves this.paused still true;
    // clear here so the next match doesn't start frozen.
    this.setPaused(false);
    document.body.classList.remove('match-active');
    document.body.classList.remove('online-mode');
    disposePortals();
    clearPortalContext(); // exit portal mode: no start portal, no P/B prompts

    // Music: title/menu loop. No-op until the user has interacted with the
    // page (browsers block autoplay without a gesture). The HUD 🎶 button
    // lets players mute if they prefer silence.
    playMusic('intro');
    // Warm up the in-game buffer while we're sitting on the title so the
    // crossfade into countdown is instant.
    preloadMusic('ingame');

    // Clear any lingering arena/critters from a previous match. Without
    // this, returning from a finished match (online or offline) leaves
    // the previous fragments painted under the title overlay for a
    // frame or two — "dirty transition" feel.
    this.arena.reset();
    this.onlineCritters.forEach(c => c.dispose());
    this.onlineCritters.clear();
    // Purge any drop-state or dust-puff leftovers — same anti-flicker
    // reason as the arena reset above.
    this.countdownDrops.clear();
    clearDustPuffs();
    clearActiveZones();
    // Rebuild the idle background critters the title expects. enterOnline
    // disposes them, so we must restore them when returning to title.
    if (this.critters.length === 0) {
      this.rebuildCritters(CRITTER_PRESETS.slice(0, MAX_CRITTERS_PER_MATCH));
    }

    showTitleScreen();
    hideCharacterSelect();
    hideEndScreen();
    // Online path: if we come back from a waiting room (T → leave), the
    // waiting-screen overlay would stay on top of the title and block all
    // clicks. Defensive hide here covers every way to reach the title.
    hideWaitingScreen();
    hideSpectatorPrompt();
    clearEndMatchStats();
    hideOverlay();
    hidePreview();
    // Ensure the mode highlight matches the current state (default: bots)
    // If online isn't available (no server URL), force-select bots.
    if (!isOnlineModeAvailable() && this.titleMode === 'online') {
      this.titleMode = 'bots';
    }
    updateTitleModeSelection(this.titleMode);
  }

  private enterCharacterSelect(): void {
    clearMenuActions();
    this.phase = 'character_select';
    document.body.classList.remove('match-active');
    hideTitleScreen();
    hideEndScreen();
    showCharacterSelect(this.displayRoster, CRITTER_PRESETS, this.selectedIdx);
    // showPreview resets rotation; swapPreviewForEntry handles config resolution
    const entry = this.displayRoster[this.selectedIdx];
    const config = CRITTER_PRESETS.find(p => p.name === entry?.displayName)
      ?? (entry ? previewConfigFromRoster(entry) : CRITTER_PRESETS[0]);
    showPreview(config);
  }

  private enterCountdown(): void {
    clearMenuActions();
    document.body.classList.add('match-active');
    hideCharacterSelect();
    hidePreview();
    hideEndScreen();
    showMatchHud();
    this.phase = 'countdown';
    this.phaseTimer = FEEL.match.countdown;
    this.matchTimer = FEEL.match.duration;

    // Music: swap to the in-game loop. Crossfades from 'intro' if it was
    // playing. The special track (win) preloads once we see that we might
    // need it, not here — keeps title→countdown lean.
    playMusic('ingame');

    // Resolve player config from the display roster selection
    const entry = this.displayRoster[this.selectedIdx];
    const playerConfig = CRITTER_PRESETS.find(p => p.name === entry?.displayName)
      ?? CRITTER_PRESETS[0]; // safety fallback

    // Rebuild the arena with a fresh random seed (offline). The pack
    // (jungle / frozen_tundra / desert_dunes / coral_beach / kitsune_shrine)
    // is also rolled randomly — skybox, fog, ground texture and decorative
    // props are swapped per match to keep the look varied across
    // consecutive runs without any menu knob.
    this.arena.reset();
    // Drop every lingering ability slow-zone from the previous match
    // (Kermit Poison Cloud, Kowalski Arctic Burst). The zone tracker
    // is module-scoped so without this an end-of-match cloud could
    // still slow the new match's countdown drops.
    clearActiveZones();
    // Pack selection in offline matches: random by default, but the
    // /decor-editor.html "Preview in game" button can pin a specific
    // pack via the ?arenaPack=<id>&decorPreview=1 URL params, which
    // arena-decor-layouts captured at module load. Honour that pin so
    // the editor preview lands on the user's expected pack instead of
    // a random roll.
    const offlinePack = getPreviewPackId() ?? getRandomPackId();
    this.arena.buildFromSeed((Math.random() * 0xFFFFFFFF) | 0, offlinePack);
    const roster = buildMatchRoster(
      playerConfig,
      MAX_CRITTERS_PER_MATCH - 1,
    );
    this.rebuildCritters(roster);

    // Preload GLB models for all match participants (async, non-blocking)
    const glbPaths = roster
      .map(c => getRosterEntry(c.name)?.glbPath)
      .filter((p): p is string => p !== null && p !== undefined);
    if (glbPaths.length > 0) {
      preloadModels(glbPaths);
    }

    // Portals
    initPortals(this.scene);
    setPortalPlayerInfo(
      this.player.config.name,
      this.player.config.color,
      this.player.config.speed,
    );
    setPortalLegend(hasStartPortal());

    initAbilityHUD(
      this.player.abilityStates,
      getRosterEntry(this.player.config.name)?.id ?? null,
    );
    initAllLivesHUD(this.critters, this.playerIndex);
    showOverlay('Get Ready!');

    // Drop-from-sky entrance: before the "3" shows, hoist every critter
    // to a random altitude between 12 and 15 units with a small initial
    // downward nudge. The countdown tick (updateCountdownDrops) integrates
    // gravity, spawns a dust puff + plays a thud when each one lands.
    this.initCountdownDrops();

    // Stats: the player just committed to a critter for this match.
    recordPick(this.player.config.name);
  }

  /**
   * Replace the live critter array with fresh instances from the given
   * configs. Disposes GPU resources from the old critters and positions
   * the new ones at SPAWN_POSITIONS. The roster is clipped to the number
   * of spawn slots. Player is always critters[0] after this call.
   */
  private rebuildCritters(roster: CritterConfig[]): void {
    // Dispose and drop existing critters
    for (const c of this.critters) c.dispose();
    this.critters = [];

    // Instantiate fresh critters from the roster, clipped to spawn slots.
    // Each critter is rotated to face the arena centre so they spawn
    // oriented "inward" regardless of which cardinal slot they land on
    // (fixes bots that were facing the void at +Z/−X/+X spawns).
    const count = Math.min(roster.length, SPAWN_POSITIONS.length);
    for (let i = 0; i < count; i++) {
      const critter = new Critter(roster[i], this.scene);
      const [sx, sz] = SPAWN_POSITIONS[i];
      critter.x = sx;
      critter.z = sz;
      // atan2(-x, -z) produces the angle whose forward (+Z after rotation)
      // points from (sx, sz) toward the origin. Matches Critter.update()'s
      // atan2(vx, vz) convention.
      critter.mesh.rotation.y = Math.atan2(-sx, -sz);
      this.critters.push(critter);
    }

    // Player is always the first critter of the roster
    this.playerIndex = 0;
    this.player = this.critters[0];
  }

  /**
   * Start the drop-from-sky animation for every critter in the match.
   * Called once at countdown entry. Critters are lifted 10..16 units
   * above the arena and EACH is staggered by a small per-index delay
   * so the roster lands asynchronously (feels like actual falling from
   * the sky instead of a synchronized rain). Each critter plays its
   * skeletal 'fall' clip the instant its delay expires and gravity
   * takes over; they snap to 'idle' the moment they touch the floor.
   */
  private initCountdownDrops(): void {
    this.countdownDrops.clear();
    const n = this.critters.length;
    for (let i = 0; i < n; i++) {
      const c = this.critters[i];
      const h = 10 + Math.random() * 6;                  // 10..16
      // Staggered delay: every critter starts 0.15..0.35s after the
      // previous one (plus jitter). Player (index 0) always starts
      // immediately so the local experience doesn't feel sluggish.
      const baseDelay = i === 0 ? 0 : 0.15 + Math.random() * 0.2;
      const delay = i === 0 ? 0 : (baseDelay * i);
      c.mesh.position.y = h;
      this.countdownDrops.set(c, { y: h, vy: 0, delay, fallStarted: false });
    }
  }

  /**
   * Integrate gravity on every live drop. Each critter waits for its
   * own `delay` to run out before gravity kicks in and the 'fall' clip
   * plays. On landing: snap to ground, spawn a dust puff, play impact
   * SFX, and swap the skeletal state back to 'idle'.
   */
  private updateCountdownDrops(dt: number): void {
    if (this.countdownDrops.size === 0) return;
    const G = 22; // gravity, world units / s²
    for (const [c, state] of this.countdownDrops) {
      if (state.delay > 0) {
        state.delay -= dt;
        // Hold altitude + keep feet-tucked pose (use idle clip so the
        // critter is not frozen in bind pose while it waits).
        continue;
      }
      if (!state.fallStarted) {
        c.playSkeletal('fall', { fallback: 'idle' });
        state.fallStarted = true;
      }
      state.vy -= G * dt;
      state.y += state.vy * dt;
      if (state.y <= 0) {
        state.y = 0;
        c.mesh.position.y = 0;
        spawnDustPuff(this.scene, c.x, 0, c.z);
        playSoundEffect('headbuttHit');
        // Force the idle clip to take over — fall has clampWhenFinished
        // so without an explicit swap the critter would freeze in its
        // last fall-pose frame forever.
        c.playSkeletal('idle', { force: true });
        this.countdownDrops.delete(c);
      } else {
        c.mesh.position.y = state.y;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Online mode
  // -------------------------------------------------------------------------

  /**
   * Enter character select in "online" mode. Reuses the offline select UI.
   * Confirming a playable character connects to the server with that name.
   *
   * Gated by the nickname modal: if no local identity is cached, we
   * prompt for a nickname + register it before showing the select. On
   * cancel, we stay on the title screen.
   */
  public async enterOnlineCharacterSelect(): Promise<void> {
    try {
      const identity = await ensureOnlineIdentity();
      this.onlineIdentity = identity;
    } catch (_err) {
      // User cancelled the nickname modal → stay on title screen.
      return;
    }
    this.selectForOnline = true;
    this.enterCharacterSelect();
  }

  /**
   * Restart from the end screen.
   * - Offline: start a new local countdown against bots (same roster)
   * - Online: leave the current room, WAIT for the leave to propagate
   *   (otherwise joinOrCreate matches the old locked room and we're
   *   stuck), then re-queue with the same critter.
   */
  private async restartMatch(): Promise<void> {
    if (this.portalRedirecting) return;
    if (this.restartInProgress) return;
    this.restartInProgress = true;

    try {
      if (this.room) {
        const critterName = this.player?.config.name ?? '';
        const prevRoom = this.room;
        this.room = null;

        // Clean visual state BEFORE we start waiting on the network so
        // the user sees a clean "Connecting..." screen instead of the
        // previous match's arena/critters.
        for (const c of this.onlineCritters.values()) c.dispose();
        this.onlineCritters.clear();
        this.arena.reset();
        showOverlay('Connecting...');

        // Properly await leave so the server fully removes us before we
        // matchmake again. Server also calls lock() on match end, so
        // joinOrCreate will never match the finished room — but waiting
        // here also avoids a brief double-connection on the client.
        try {
          await prevRoom.leave();
        } catch (_e) { /* server may have already disposed */ }

        if (!critterName) {
          this.enterTitle();
          return;
        }
        await this.connectOnlineWith(critterName);
      } else {
        this.enterCountdown();
      }
    } finally {
      this.restartInProgress = false;
    }
  }

  /**
   * Connect to the multiplayer server using the given character and jump
   * into the online match. Called from the character-select confirm flow
   * when selectForOnline is true.
   */
  private async connectOnlineWith(critterName: string): Promise<void> {
    if (this.connectInProgress) return;
    this.connectInProgress = true;
    try {
      hideCharacterSelect();
      hidePreview();
      // Dispose background idle critters + clear the arena BEFORE the
      // network await. Otherwise the "Connecting..." overlay shows over
      // the lingering title-screen placeholders for ~100-500ms — that
      // "flicker of placeholders" the user reported.
      for (const c of this.critters) c.dispose();
      this.critters = [];
      this.onlineCritters.forEach(c => c.dispose());
      this.onlineCritters.clear();
      this.arena.reset();
      showOverlay('Connecting...');

      const { connectToBrawl, getDefaultServerUrl } = await import('./network');
      // Pass playerId+token if we have an online identity — the server
      // uses this to credit match stats to the right row for the Online
      // Belts (Fase 3 wires the room handler; for now we just attach it
      // to the join options so the handshake carries it).
      const joinOpts: Record<string, unknown> = { critterName };
      if (this.onlineIdentity) {
        const { getDeviceToken } = await import('./online-identity');
        joinOpts.playerId = this.onlineIdentity.playerId;
        joinOpts.playerToken = getDeviceToken();
        joinOpts.nickname = this.onlineIdentity.nickname;
      }
      const room = await connectToBrawl(getDefaultServerUrl(), joinOpts);
      this.enterOnline(room);
    } catch (err) {
      console.error('[Game] online connect failed:', err);
      hideOverlay();
      this.selectForOnline = false;
      this.enterTitle();
      alert('Could not connect to multiplayer server.\n\n' +
            'In dev: make sure the server is running (cd server && npm run dev).\n' +
            'In prod: contact the site owner.');
    } finally {
      this.connectInProgress = false;
    }
  }

  /**
   * Switch to online mode. Disposes local critters, hooks network listeners,
   * and starts rendering remote state. The room must already be connected.
   */
  public enterOnline(room: Room): void {
    console.log('[Game] entering online mode');
    clearMenuActions();
    this.room = room;
    this.phase = 'online';
    this.lastServerPhase = '';
    this.portalRedirecting = false;
    document.body.classList.add('match-active');
    document.body.classList.add('online-mode'); // CSS hides unavailable touch buttons

    // Hide offline UI
    hideTitleScreen();
    hideCharacterSelect();
    hideEndScreen();
    hidePreview();
    showMatchHud();

    // Clear offline critters; online critters are driven by server state
    for (const c of this.critters) c.dispose();
    this.critters = [];
    this.onlineCritters.clear();

    // Reset arena — fragment layout will be built once the server sends the seed
    this.arena.reset();

    // Portals: individual per-client. Using the exit portal in online mode
    // sends a 'portal' message to the server (authoritative forfeit) and
    // then redirects locally. Using a portal does NOT pause the other
    // players — they keep playing until alive count drops to 1.
    initPortals(this.scene);
    setPortalLegend(hasStartPortal());
    // Player info for the portal redirect query params is set after the
    // local critter spawns (needs config). See spawnOnlineCritter.

    showOverlay('Waiting for opponent...');

    // Colyseus schema v3: use getStateCallbacks to register listeners.
    // $ (root callback proxy) mirrors the state tree and supports onAdd/onRemove
    // that also fires for items ALREADY present when the callback is attached.
    const $ = getStateCallbacks(room);
    $(room.state).players.onAdd((playerState: any, sessionId: string) => {
      this.spawnOnlineCritter(sessionId, playerState);
    });
    $(room.state).players.onRemove((_playerState: any, sessionId: string) => {
      const c = this.onlineCritters.get(sessionId);
      if (c) {
        c.dispose();
        this.onlineCritters.delete(sessionId);
      }
    });

    // Ability fire events → trigger client-side VFX + audio
    onAbilityFired(room, (ev: AbilityFiredEvent) => this.handleAbilityFired(ev));

    // Slow-zone broadcasts → render the persistent ground hazard +
    // register the zone in the client-side tracker so `effectiveSpeed`
    // applies the slow on the local prediction path. Server is still
    // the authority, but mirroring locally avoids a state-sync wobble
    // when the player's input drives them into a zone they "see"
    // before the next position patch arrives.
    onZoneSpawned(room, (ev) => {
      pushNetworkZone({
        x: ev.x, z: ev.z, radius: ev.radius,
        slowMultiplier: ev.slowMultiplier,
        ttl: ev.duration,
      });
      // Render — colour comes from the caster's pound palette so
      // online and offline match visually.
      const caster = this.onlineCritters.get(ev.ownerSid);
      const palette = caster ? getCritterVfxPalette(caster.config.name) : undefined;
      spawnZoneRing(this.scene, ev.x, ev.z, ev.radius, ev.duration,
        palette?.pound?.color, palette?.pound?.secondary);
    });

    // Online Belts: if the server detects a belt changed hands after this
    // match, it broadcasts `beltChanged` to the whole room. Toast it so
    // everyone sees who just took what.
    onBeltChanged(room, (ev) => showOnlineBeltToast(ev));

    // Attach leave handler — if the server drops us unexpectedly we
    // surface it. Intentional leaves (restartMatch, back-to-title)
    // set this.restartInProgress / this.room=null first, so those
    // paths don't flash the Disconnected overlay.
    room.onLeave(() => {
      console.log('[Game] disconnected from room');
      if (this.phase === 'online' && this.room === room && !this.restartInProgress) {
        showOverlay('Disconnected', 'Press T to return to title');
      }
    });
  }

  private spawnOnlineCritter(sessionId: string, playerState: any): void {
    // Resolve the character from server-authoritative state. If unknown
    // (shouldn't happen — server validates before sending), fall back to
    // the first playable from the roster.
    const critterName: string = playerState.critterName ?? 'Sergei';
    const config = CRITTER_PRESETS.find(p => p.name === critterName)
      ?? CRITTER_PRESETS.find(p => p.name === 'Sergei')
      ?? CRITTER_PRESETS[0];
    const critter = new Critter(config, this.scene);
    critter.skipPhysics = true;  // server is authoritative
    critter.x = playerState.x ?? 0;
    critter.z = playerState.z ?? 0;
    critter.isBot = !!playerState.isBot;  // 4P bot-fill or takeover
    this.onlineCritters.set(sessionId, critter);
    console.log('[Game] spawned online critter for', sessionId, 'as', critterName, critter.isBot ? '(bot)' : '');

    // Local-player-only HUD init (abilities + HUD/win-check compat)
    if (this.room && sessionId === this.room.sessionId) {
      this.player = critter;
      this.critters = [critter];
      // Bloque B: all 3 abilities are live (charge_rush + ground_pound + frenzy)
      initAbilityHUD(
        this.player.abilityStates,
        getRosterEntry(this.player.config.name)?.id ?? null,
      );
      // Portal redirect params — name/color/speed come from the resolved config
      setPortalPlayerInfo(config.name, config.color, config.speed);
    }

    // Lives HUD: rebuild every spawn with ALL critters currently known.
    // Local may spawn before remote or vice-versa; rebuilding ensures both
    // rows exist once both players are in. Without this, only 1 row is
    // created and the second player's lives never appear in the HUD.
    initAllLivesHUD([...this.onlineCritters.values()], this.onlineLocalIndex());
  }

  /** Index of the local player inside the onlineCritters Map's insertion order.
   *  Used to highlight the correct life-corner. Returns -1 if unknown. */
  private onlineLocalIndex(): number {
    const localSid = this.room?.sessionId;
    if (!localSid) return -1;
    let i = 0;
    for (const sid of this.onlineCritters.keys()) {
      if (sid === localSid) return i;
      i++;
    }
    return -1;
  }

  /**
   * Apply server state to local critters + drive phase UI (countdown, end).
   * Called each frame while phase === 'online'.
   */
  private updateOnline(dt: number): void {
    if (!this.room) return;

    // P key toggles portal minimize/expand (same UX as offline)
    if (this.portalKeyPressed('KeyP')) {
      togglePortalExpanded();
    }

    // Portal check: if the local player walks into an expanded portal, send
    // the server a 'portal' forfeit message and redirect. The server marks
    // us dead authoritatively; the remaining player gets a proper victory.
    if (this.player && this.player.alive && !this.portalRedirecting) {
      const hit = updatePortals(this.player.x, this.player.z, dt);
      if (hit) {
        this.triggerOnlinePortalExit(hit);
        return; // skip further state processing this tick
      }
    }

    // Gameplay input only while the server is actually playing. During
    // waiting/countdown/ended the server ignores inputs anyway, but
    // sending them is noise and risks side-effects when the local
    // critter isn't ready (e.g. before first spawn patch arrives).
    const phaseForInput = (this.room.state as any)?.phase;
    const inputsActive = phaseForInput === 'playing' && !!this.player;
    if (inputsActive) {
      const move = getMoveVector();
      sendInput(this.room, {
        moveX: move.x,
        moveZ: move.z,
        headbutt: isHeld('headbutt'),
        ability1: isHeld('ability1'),
        ability2: isHeld('ability2'),
        ultimate: isHeld('ultimate'),
      });
    }

    // Apply server state to each critter. Every access is guarded because
    // Colyseus schema v3 can deliver partial snapshots during join: a player
    // may be present but some fields (rotationY, abilities[]) may not have
    // their patch applied yet on this client tick.
    //
    // IMPORTANT: on the first frame(s) after join, state.players may exist
    // as a plain object before the MapSchema instance is reconstructed.
    // Skip the tick rather than crash — next frame will likely have it.
    const state = this.room.state as any;
    if (!state || typeof state.players?.forEach !== 'function') return;

    // Mirror the authoritative arena collapse state. The seed triggers
    // fragment layout generation on first call; subsequent calls drive
    // visibility and warning blink from server collapse level.
    const seed = state.arenaSeed;
    if (typeof seed === 'number' && seed !== 0) {
      // arenaPackId ships as a string; verify before passing so a
      // mismatched server (older build missing the field) just falls back
      // to the procedural default instead of breaking the sync path.
      const rawPack = state.arenaPackId;
      const packId: ArenaPackId | undefined = isArenaPackId(rawPack) ? rawPack : undefined;
      this.arena.syncFromServer(
        seed,
        state.arenaCollapseLevel ?? 0,
        state.arenaWarningBatch ?? -1,
        packId,
      );
      // Tick the falling-fragment tumble animation every frame. We use
      // tickVisuals (not update) because `update` also drives the offline
      // collapse timeline — the server is authoritative in online mode.
      this.arena.tickVisuals(dt);
    }

    const allPlayers: Array<{ sessionId: string; alive: boolean }> = [];
    state.players.forEach((p: any, sid: string) => {
      if (!p) return; // defensive: shouldn't happen but some schema edges do this
      allPlayers.push({ sessionId: sid, alive: !!p.alive });
      const c = this.onlineCritters.get(sid);
      if (!c) return;
      // Position — snap local, lerp remote
      const px = p.x ?? c.x;
      const pz = p.z ?? c.z;
      if (sid === this.room?.sessionId) {
        c.x = px;
        c.z = pz;
      } else {
        c.x += (px - c.x) * Math.min(1, dt * 15);
        c.z += (pz - c.z) * Math.min(1, dt * 15);
      }
      if (typeof p.rotationY === 'number') c.mesh.rotation.y = p.rotationY;
      c.vx = p.vx ?? 0;
      c.vz = p.vz ?? 0;
      // Alive edge detection — online matches mark `alive=false` from
      // server state, they don't call Critter.eliminate(), so we mirror
      // the defeat skeletal hook here. No-op for critters without clips.
      const wasAlive = c.alive;
      c.alive = p.alive ?? true;
      if (wasAlive && !c.alive) {
        c.playSkeletal('defeat', { fallback: 'defeat' });
      }
      c.falling = p.falling ?? false;
      c.mesh.position.y = p.fallY ?? 0;
      c.mesh.visible = c.alive;
      c.immunityTimer = p.immunityTimer ?? 0;
      c.isHeadbutting = !!p.isHeadbutting;
      (c as any).headbuttAnticipating = !!p.headbuttAnticipating;
      c.lives = p.lives ?? 3;
      // Bot-fill + takeover: server flips isBot mid-match when a human
      // disconnects and we have enough survivors. Reflect it every frame so
      // the HUD badge appears/disappears live.
      const wasBot = c.isBot;
      c.isBot = !!p.isBot;
      if (wasBot !== c.isBot) {
        // Lives HUD shows a 🤖 badge per bot — rebuild so it appears.
        initAllLivesHUD([...this.onlineCritters.values()], this.onlineLocalIndex());
      }
      // Update ability states from server (for HUD) — guard ArraySchema access
      if (p.abilities && typeof p.abilities.length === 'number') {
        const count = Math.min(p.abilities.length, c.abilityStates.length);
        for (let i = 0; i < count; i++) {
          const src = p.abilities[i];
          const dst = c.abilityStates[i];
          if (!src || !dst) continue;
          dst.active = !!src.active;
          dst.cooldownLeft = src.cooldownLeft ?? 0;
          dst.durationLeft = src.durationLeft ?? 0;
          dst.windUpLeft = src.windUpLeft ?? 0;
          dst.effectFired = !!src.effectFired;
        }
      }
      // Run visual updates
      c.update(dt);
    });

    // Handle server phase transitions
    const serverPhase = state.phase as string;
    if (serverPhase !== this.lastServerPhase) {
      console.log('[Game] server phase:', this.lastServerPhase, '→', serverPhase);
      this.lastServerPhase = serverPhase;
      // Always drop the waiting screen when leaving waiting.
      if (serverPhase !== 'waiting') hideWaitingScreen();

      if (serverPhase === 'playing') {
        hideOverlay();
        // Stamp match start for badge duration tracking (Speedrun Belt).
        // Mirrors the offline countdown→playing transition.
        this.matchStartMs = performance.now();
      } else if (serverPhase === 'countdown') {
        // Online countdown: switch to the in-game loop so by the time the
        // "GO!" pops the music is already at full volume.
        playMusic('ingame');
      } else if (serverPhase === 'waiting') {
        // New 4P waiting room — the old "Waiting for opponent..." text is
        // replaced by the full waiting-screen overlay (countdown + slots).
        hideOverlay();
        showWaitingScreen();
        // Chill title loop while we wait. Also preloads ingame for the
        // moment the countdown kicks in.
        playMusic('intro');
        preloadMusic('ingame');
      } else if (serverPhase === 'ended') {
        const winnerSid = state.winnerSessionId;
        const localSid = this.room.sessionId;
        const reason = state.endReason;
        // Figure out if the winner is a bot — influences the subtitle copy.
        let winnerIsBot = false;
        let winnerCritterName = '';
        if (winnerSid) {
          const w = state.players?.get?.(winnerSid);
          if (w) {
            winnerIsBot = !!w.isBot;
            winnerCritterName = w.critterName ?? '';
          }
        }

        let title = 'DRAW';
        let subtitle = 'No winner';
        let result: EndResult = 'draw';
        if (winnerSid === localSid) {
          result = 'win'; title = 'VICTORY'; subtitle = 'You won';
          playSoundEffect('victory');
          playMusic('special');
        } else if (winnerSid && winnerSid !== localSid) {
          result = 'lose'; title = 'DEFEATED';
          if (reason === 'opponent_left') {
            subtitle = 'You won by default';
          } else if (winnerIsBot) {
            subtitle = `Bot ${winnerCritterName || ''} won`.trim();
          } else {
            subtitle = `${winnerCritterName || 'Opponent'} won`.trim();
          }
          playMusic('intro');
        } else {
          // Draw — no survivor. Also back to the title loop.
          playMusic('intro');
        }
        hideOverlay();
        showEndScreen(result, title, subtitle, false);

        // Skeletal: surviving critters celebrate. Losers already locked
        // into 'defeat' via the alive-edge hook above. No-op for critters
        // without clips.
        for (const c of this.onlineCritters.values()) {
          if (c.alive) c.playSkeletal('victory', { fallback: 'victory' });
        }

        // End-screen stats — local player's counters. this.player on
        // online points at the local critter in onlineCritters.
        if (this.player) {
          setEndMatchStats({
            headbutts: this.player.matchStats.headbutts,
            abilitiesUsed: this.player.matchStats.abilitiesUsed,
            falls: this.player.matchStats.falls,
            respawns: this.player.matchStats.respawns,
          });
        }

        // Badge aggregation — mirrors the offline win path. recordOutcome
        // first (feeds byCritter.wins / totalWins), then recordWin for
        // the Speedrun/IronWill/Untouchable/ArenaApex signals, then check
        // unlocks and show the toast. Only fires for wins + losses — the
        // 'draw' branch skips both.
        if (this.player && (result === 'win' || result === 'lose')) {
          recordOutcome(this.player.config.name, result);
        }
        if (this.player && result === 'win' && this.matchStartMs > 0) {
          const durationSecs = (performance.now() - this.matchStartMs) / 1000;
          recordWin(
            this.player.config.name,
            durationSecs,
            this.player.lives,
            this.player.matchStats.hitsReceived,
          );
          const newly = checkBadgeUnlocks(getStats());
          if (newly.length > 0) {
            addUnlockedBadges(newly);
            console.debug('[Badges] unlocked (online):', newly.join(', '));
          }
          maybeShowBadgeToast();
        }
        // Reset so the next 'playing' transition re-stamps cleanly.
        this.matchStartMs = 0;
      }
    }

    // Live waiting-screen update — countdown + slots every frame.
    if (serverPhase === 'waiting') {
      updateWaitingScreen(this.buildWaitingScreenData(state));
    }

    // Spectator prompt: the local player has lost all lives but the match
    // is still running (other humans / bots are finishing). Offer them a
    // one-key escape to the title so they aren't held hostage to the
    // timer. Hidden in every other situation.
    const showSpectator =
      serverPhase === 'playing' &&
      this.player !== null &&
      !this.player.alive;
    if (showSpectator) {
      showSpectatorPrompt();
    } else {
      hideSpectatorPrompt();
    }

    // Overlay for countdown
    if (serverPhase === 'countdown') {
      const sec = Math.max(0, Math.ceil(state.countdownLeft));
      showOverlay(`${sec > 0 ? sec : 'GO!'}`);
    }

    // HUD updates — active during countdown + playing, not waiting/ended
    if (this.player && (serverPhase === 'countdown' || serverPhase === 'playing')) {
      const alive = allPlayers.filter(p => p.alive).length;
      updateHUD(alive, Math.max(0, state.matchTimer ?? 0));
      updateAbilityHUD(this.player.abilityStates);
      updateAllLivesHUD([...this.onlineCritters.values()]);
    }
  }

  /**
   * Online portal hit: forfeit via server, then redirect locally.
   *
   * Flow:
   *   1. Mark the local guard so the detection doesn't re-trigger
   *   2. Send 'portal' to server — it marks our PlayerSchema.alive=false
   *      synchronously in the handler and re-evaluates win condition.
   *      Patch is broadcast to the remaining client in the same tick.
   *   3. Show a brief "Leaving..." overlay (cosmetic, avoids a frozen
   *      unresponsive frame between send and redirect)
   *   4. Short wait (~120ms) to give the server's broadcast time to reach
   *      the other client BEFORE our WebSocket close frame lands. Without
   *      this the other player might see a disconnect instead of a victory.
   *   5. Redirect using the same exit/ref URL as offline portals.
   */
  private triggerOnlinePortalExit(which: 'exit' | 'start'): void {
    if (!this.room || this.portalRedirecting) return;
    this.portalRedirecting = true;

    console.log('[Game] online portal exit via', which);
    try {
      this.room.send('portal');
    } catch (err) {
      console.warn('[Game] portal send failed:', err);
    }

    showOverlay('Leaving...');

    const redirectUrl = which === 'start'
      ? (getPortalReturnUrl() ?? getPortalExitUrl())
      : getPortalExitUrl();

    // Small delay lets the server broadcast alive=false to the opponent
    // before our WS close frame arrives. 120ms is well under any sane
    // Colyseus patch rate (default 50ms patches).
    setTimeout(() => {
      window.location.href = redirectUrl;
    }, 120);
  }

  private handleAbilityFired(ev: AbilityFiredEvent): void {
    const c = this.onlineCritters.get(ev.sessionId);
    if (!c) return;
    // Reuse offline VFX primitives for consistency
    const palette = getCritterVfxPalette(c.config.name);
    if (ev.type === 'charge_rush') {
      applyDashFeedback(c);
      triggerCameraShake(0.15);
      playSoundEffect('abilityFire');
    } else if (ev.type === 'blink') {
      // Cheeto Shadow Step (and any future blink) — origin afterimage
      // ring at the broadcast position. The server has already moved
      // the player; the next state patch teleports them visually.
      // Tinted with the caster's pound palette so the blink reads as
      // the same identity colour as their other K-slot VFX would.
      spawnShockwaveRing(this.scene, ev.x, ev.z, 1.4, palette?.pound);
      applyDashFeedback(c);
      playSoundEffect('abilityFire');
      // 2026-04-29 K-session — Sihans Burrow Rush online lectura.
      // The server doesn't carry an "isBurrow" flag in the event,
      // but the broadcast position (ev.x, ev.z) is the ORIGIN of
      // the blink, and only Sihans uses a blink with zone-at-origin.
      // We mirror the offline path: ghost the critter for 0.30 s
      // and spawn extra dust at the broadcast origin so the
      // online viewer sees the same "se hundió aquí" beat. The
      // destination dust is implicit — `spawnShockwaveRing`
      // already paints a ring at the origin; the next state patch
      // teleports the visible mesh to the new position.
      if (c.config.name === 'Sihans') {
        c.invisibilityTimer = Math.max(c.invisibilityTimer, 0.30);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          spawnDustPuff(this.scene, ev.x + Math.cos(a) * 0.5, 0, ev.z + Math.sin(a) * 0.5);
        }
      }
    } else if (ev.type === 'ground_pound') {
      // Shockwave ring at the caster's position + shake + hit stop + sound.
      // Victims' knockback comes via state sync (server applied velocity).
      // Per-critter tint mirrors the offline `fireGroundPound` path so
      // a Kowalski Arctic Burst reads as ice in BOTH offline and online.
      spawnShockwaveRing(this.scene, ev.x, ev.z, FEEL.groundPound.radius, palette?.pound);
      triggerCameraShake(FEEL.shake.groundPound);
      triggerHitStop(FEEL.hitStop.groundPound);
      playSoundEffect('groundPound');
    } else if (ev.type === 'frenzy') {
      // Frenzy entry burst — server only emits this event when the buff
      // ACTIVATES, so we get one ring per ult activation, same cadence
      // as offline. The pulsing emissive glow is still driven by the
      // synced `c.abilityStates[2].active` flag in updateVisuals().
      spawnFrenzyBurst(this.scene, ev.x, ev.z, palette?.frenzy);
      triggerCameraShake(FEEL.shake.groundPound * 0.55);
      playSoundEffect('abilityFire');
    }
  }

  private enterEnded(result: EndResult, title: string, subtitle: string): void {
    clearMenuActions();
    this.phase = 'ended';
    // Record the result for the camera framing pipeline — win/lose/
    // draw drives different end-screen camera poses (see
    // getEndScreenCameraPose). Reset implicit on next enterEnded
    // call; explicit reset on phase exit is unnecessary because
    // the public getter gates on `phase === 'ended'` first.
    this.lastEndResult = result;
    document.body.classList.remove('match-active');
    hideOverlay();
    showEndScreen(result, title, subtitle, isFromPortal());
    if (result === 'win') {
      playSound('victory');
      // Music: celebratory track on victory. Preload already covers the
      // normal case (fast swap) via the warm-up in enterTitle → ingame.
      playMusic('special');
    } else {
      // Loss or draw: drop back to the title loop so the end-screen feels
      // a beat less aggressive and matches the "returning to menu" vibe.
      playMusic('intro');
    }

    // Skeletal hook: any critter still alive performs their victory
    // animation (fallback: loop so they keep celebrating on the end
    // screen). Eliminated critters already locked into 'defeat' via
    // Critter.eliminate(). No-op for critters without animation clips.
    for (const c of this.critters) {
      if (c.alive) c.playSkeletal('victory', { fallback: 'victory' });
    }

    // End-screen stats block — the LOCAL player's per-match counters.
    // Online calls a separate path (see updateOnline 'ended' branch).
    if (this.player) {
      setEndMatchStats({
        headbutts: this.player.matchStats.headbutts,
        abilitiesUsed: this.player.matchStats.abilitiesUsed,
        falls: this.player.matchStats.falls,
        respawns: this.player.matchStats.respawns,
      });
    }

    // Stats: record the match outcome for the player's critter. Draws are
    // not recorded (no current code path produces 'draw', but the type
    // allows it — guarded here so future tie logic doesn't inflate counts).
    if (result === 'win' || result === 'lose') {
      recordOutcome(this.player.config.name, result);
    }

    // Badge aggregation — wins only. `recordWin` captures the duration +
    // lives-left + hits-received needed by Speedrun / Iron Will / Arena
    // Apex / Untouchable / Pain Tolerance conditions. Then we diff against
    // already-unlocked badges to log new unlocks. UI surfacing (end-screen
    // toast) will wire into `stats.recentlyUnlocked` in BADGES Phase 3.
    if (result === 'win' && this.matchStartMs > 0) {
      const durationSecs = (performance.now() - this.matchStartMs) / 1000;
      recordWin(
        this.player.config.name,
        durationSecs,
        this.player.lives,
        this.player.matchStats.hitsReceived,
      );
      const newly = checkBadgeUnlocks(getStats());
      if (newly.length > 0) {
        addUnlockedBadges(newly);
        console.debug('[Badges] unlocked:', newly.join(', '));
      }
      // Show the end-screen toast for the most recent unlock (if any).
      // No-op when `stats.recentlyUnlocked === null`.
      maybeShowBadgeToast();
    }
    // Reset start timestamp so a stray post-match tick can't re-fire.
    this.matchStartMs = 0;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private get activeCount(): number {
    return this.critters.filter((c) => c.alive).length;
  }

  /**
   * Camera pose to lerp the main camera toward when the match has
   * ended. Branches on `lastEndResult`:
   *
   *   · win   → close-up half-shot on the local player critter
   *             (winners read with their celebration anim front and
   *             centre).
   *   · lose  → wide 3/4 shot framing the surviving critter (the
   *             "winner" the local player just lost to). Fallback
   *             to arena-centre wide if no survivor is on the surface
   *             (timeout / mass elimination edge cases).
   *   · draw  → arena-centre wide. Nobody owns the victory beat.
   *
   * Returns null in any phase other than 'ended' or when no result
   * has been recorded yet (defensive — should always have a value
   * after enterEnded but the gate keeps invariants tight).
   *
   * Edge case — focus target fell through the void: any candidate
   * critter with `y < 0` or `!alive` is treated as ineligible, the
   * pose falls through to the arena-centre wide. Avoids the camera
   * chasing a corpse below the world or staring at a dead pose.
   */
  public getEndScreenCameraPose(): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null {
    if (this.phase !== 'ended') return null;
    switch (this.lastEndResult) {
      case 'win':  return this.poseVictoryCloseUp() ?? this.poseWideArena();
      case 'lose': return this.poseDefeatWide()    ?? this.poseWideArena();
      case 'draw': return this.poseWideArena();
      default:     return this.poseWideArena();
    }
  }

  /** Close-up half-shot on the local player. Returns null if the
   *  player isn't on the arena surface (use a wider fallback). */
  private poseVictoryCloseUp(): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null {
    if (!this.player) return null;
    const p = this.player;
    if (!p.alive || p.mesh.position.y < 0) return null;
    // Camera approaches from the critter's FRONT (so we see its face,
    // not its back). 4.5 m back, 2.5 m elevated, lookAt at chest
    // height — keeps head in upper-mid frame so the DOM title block
    // doesn't overlap the face.
    const fwdX = Math.sin(p.mesh.rotation.y);
    const fwdZ = Math.cos(p.mesh.rotation.y);
    return {
      position: new THREE.Vector3(p.x + fwdX * 4.5, 2.5, p.z + fwdZ * 4.5),
      lookAt: new THREE.Vector3(p.x, 1.2, p.z),
    };
  }

  /** Wide 3/4 shot on the surviving critter (the de-facto "winner"
   *  the player lost to). Returns null when no eligible survivor
   *  exists — timeout / multi-elimination edge cases — so the caller
   *  falls back to the centred wide shot. */
  private poseDefeatWide(): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null {
    const survivor = this.critters.find(
      (c) => c !== this.player && c.alive && c.mesh.position.y >= 0,
    );
    if (!survivor) return null;
    // Diagonal wide — 7 m back along the survivor's facing, 5 m up.
    // No close-up; we want the arena context (surrounding fragments
    // collapsed, etc.) to read in the same frame for the loss beat.
    const fwdX = Math.sin(survivor.mesh.rotation.y);
    const fwdZ = Math.cos(survivor.mesh.rotation.y);
    return {
      position: new THREE.Vector3(
        survivor.x + fwdX * 7,
        5,
        survivor.z + fwdZ * 7,
      ),
      lookAt: new THREE.Vector3(survivor.x, 1, survivor.z),
    };
  }

  /** Generic wide centred shot. Used for draws, defeats with no
   *  surviving critter, and as the "we couldn't compose anything
   *  better" fallback for victory. Diagonal frame so the arena
   *  fragments + skybox both read. */
  private poseWideArena(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    return {
      position: new THREE.Vector3(8, 7, 12),
      lookAt: new THREE.Vector3(0, 1, 0),
    };
  }

  /** Last enterEnded `result`, used by `getEndScreenCameraPose` to
   *  pick win/lose/draw framing. Set in `enterEnded`; gates on
   *  `phase === 'ended'` so a stale value from a previous match
   *  can't leak into a new pose computation (see early return at
   *  the top of `getEndScreenCameraPose`). */
  private lastEndResult: EndResult | null = null;

  /** Show the correct preview model for a roster entry (playable or WIP). */
  private swapPreviewForEntry(entry: RosterEntry | undefined): void {
    if (!entry) return;
    const config = CRITTER_PRESETS.find(p => p.name === entry.displayName)
      ?? previewConfigFromRoster(entry);
    swapPreviewCritter(config);
  }

  // Edge-detected key check for portal redirects. Self-contained listener,
  // not part of the input abstraction (portal is a jam feature, not gameplay).
  private portalFreshKeys = new Set<string>();
  private portalKeyPressed(code: string): boolean {
    if (this.portalFreshKeys.has(code)) {
      this.portalFreshKeys.delete(code);
      return true;
    }
    return false;
  }
  private initPortalKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || e.code === 'KeyB') {
        if (!e.repeat) this.portalFreshKeys.add(e.code);
      }
    });
  }

  /**
   * Build the waiting-screen snapshot from the current server state. The
   * MapSchema is iterated via its Colyseus `forEach`; each player becomes
   * a slot with critter name + colour. Empty slots are padded to reach
   * ONLINE_MAX_PLAYERS so the layout always shows the full room.
   */
  private buildWaitingScreenData(state: any): WaitingScreenData {
    const slots: WaitingScreenData['slots'] = [];
    state.players?.forEach?.((p: any) => {
      if (!p) return;
      const config = CRITTER_PRESETS.find(c => c.name === p.critterName);
      slots.push({
        kind: p.isBot ? 'bot' : 'human',
        name: p.critterName || '',
        color: config?.color ?? 0xffffff,
      });
    });
    while (slots.length < ONLINE_MAX_PLAYERS) {
      slots.push({ kind: 'empty', name: '', color: 0 });
    }
    return {
      secondsLeft: state.waitingTimeLeft ?? 0,
      slots,
      maxPlayers: ONLINE_MAX_PLAYERS,
    };
  }

  /**
   * Pick a respawn position that is GUARANTEED to be on solid ground.
   *
   * Previously we just picked a random angle within `currentRadius * 0.4`,
   * which works for concentric-ring arenas but breaks on irregular fragment
   * layouts (especially Pattern B / axis-split, where half the arena can
   * be fully collapsed). Critters would respawn in the void and fall again
   * on the same frame.
   *
   * Strategy: up to 12 tries with a radius that SHRINKS per attempt so the
   * first picks prefer room to breathe but fallbacks converge toward the
   * centre, which always sits on the immune islet (never collapses).
   * Last-resort fallback is (0, 0) — the islet guarantees ground there.
   */
  private pickRespawnPos(): [number, number] {
    const arena = this.arena;
    const maxR = Math.max(2.0, arena.currentRadius * 0.4);
    for (let i = 0; i < 12; i++) {
      const r = maxR * (1 - i / 12) + 0.5;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      if (arena.isOnArena(x, z)) return [x, z];
    }
    // Immune islet — guaranteed on-arena for the whole match.
    return [0, 0];
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------

  update(dt: number): void {
    switch (this.phase) {
      case 'title':
        // Let critters idle (bob animation, no input)
        for (const c of this.critters) c.update(dt);
        // Arrow left/right toggles mode highlight. If online isn't
        // available, left/right are ignored (only one mode exists).
        if (consumeMenuAction('left') || consumeMenuAction('right')) {
          if (isOnlineModeAvailable()) {
            this.titleMode = this.titleMode === 'bots' ? 'online' : 'bots';
            updateTitleModeSelection(this.titleMode);
          }
        }
        if (consumeMenuAction('confirm') && !this.connectInProgress && !this.restartInProgress) {
          if (this.titleMode === 'online') this.enterOnlineCharacterSelect();
          else this.enterCharacterSelect();
        }
        break;

      case 'character_select': {
        for (const c of this.critters) c.update(dt);
        const rLen = this.displayRoster.length;
        if (consumeMenuAction('left') && rLen > 0) {
          this.selectedIdx = (this.selectedIdx - 1 + rLen) % rLen;
          updateCharacterSelect(this.selectedIdx);
          this.swapPreviewForEntry(this.displayRoster[this.selectedIdx]);
        }
        if (consumeMenuAction('right') && rLen > 0) {
          this.selectedIdx = (this.selectedIdx + 1) % rLen;
          updateCharacterSelect(this.selectedIdx);
          this.swapPreviewForEntry(this.displayRoster[this.selectedIdx]);
        }
        if (consumeMenuAction('confirm') && !this.connectInProgress && !this.restartInProgress) {
          const sel = this.displayRoster[this.selectedIdx];
          if (sel?.status === 'playable') {
            if (this.selectForOnline) {
              this.connectOnlineWith(sel.displayName);
            } else {
              this.enterCountdown();
            }
          }
          // WIP/locked → ignore confirm
        }
        if (consumeMenuAction('back')) {
          this.selectForOnline = false; // back cancels online intent
          this.enterTitle();
        }
        break;
      }

      case 'countdown': {
        this.phaseTimer -= dt;
        // Drop-from-sky animation runs alongside the number overlay.
        this.updateCountdownDrops(dt);
        const sec = Math.ceil(this.phaseTimer);
        if (sec > 0) {
          showOverlay(`${sec}`);
        } else {
          // Flash "GO!" for ~0.45 s before hiding — the green variant in
          // CSS plays a radial burst, which sells the transition better
          // than snapping straight to gameplay.
          showOverlay('GO!');
          window.setTimeout(() => hideOverlay(), 450);
          this.phase = 'playing';
          // Stamp the moment the match really starts. Used by recordWin
          // to compute duration for the Speedrun Belt badge.
          this.matchStartMs = performance.now();
          // Safety net: any critter still mid-air when countdown ends
          // snaps to ground (no thud — we'd rather avoid a late SFX).
          for (const [c] of this.countdownDrops) c.mesh.position.y = 0;
          this.countdownDrops.clear();
        }
        break;
      }

      case 'playing': {
        // Offline pause: freeze input, bots, physics and cooldowns while
        // the pause menu is up. Leave visuals (drag rotation etc.) alone.
        // The DOM overlay is managed by setPaused().
        if (this.paused) {
          // Still update the HUD once so cooldown bars don't snap on resume.
          updateAbilityHUD(this.player.abilityStates);
          break;
        }
        const effectiveDt = applyHitStop(dt);
        if (effectiveDt === 0) {
          updateAbilityHUD(this.player.abilityStates);
          break;
        }

        this.matchTimer -= effectiveDt;

        // 1. Player input
        updatePlayer(this.player, effectiveDt);

        // 1.5. Portal check (before physics so redirect happens cleanly)
        // P key toggles minimized/expanded state during match.
        if (this.portalKeyPressed('KeyP')) {
          togglePortalExpanded();
        }
        if (this.player.alive && !this.player.falling) {
          const portalHit = updatePortals(this.player.x, this.player.z, effectiveDt);
          if (portalHit) return; // redirect in progress, freeze game loop
        }

        // 2. Bot AI (all critters except the player)
        for (let i = 0; i < this.critters.length; i++) {
          if (i === this.playerIndex) continue;
          updateBot(this.critters[i], this.critters, effectiveDt);
        }

        // 3. Ability updates
        for (const c of this.critters) {
          if (c.alive && !c.falling) {
            updateAbilities(c.abilityStates, c, this.critters, this.scene, effectiveDt);
          }
        }

        // 4. Update critters
        for (const c of this.critters) {
          if (c.alive && !c.falling) c.update(effectiveDt);
        }

        // 5. Physics
        resolveCollisions(this.critters);
        const playerWasFalling = this.player.falling;
        checkFalloff(this.critters, this.arena);
        // Stats: record player falls only (bots falling would inflate counts).
        // Rising edge of `falling` — checkFalloff is the only path that
        // sets it to true, so it's safe to diff before/after this call.
        if (!playerWasFalling && this.player.falling) {
          recordFall(this.player.config.name);
        }

        // 6. Update falling critters + handle respawns
        const toRespawn = updateFalling(this.critters, effectiveDt);
        for (const c of toRespawn) {
          const [rx, rz] = this.pickRespawnPos();
          c.respawnAt(rx, rz);
        }

        // 7. Arena collapse (fragment-based, self-driven in offline)
        this.arena.update(effectiveDt);

        // 8. Update HUD
        updateHUD(this.activeCount, Math.max(0, this.matchTimer));
        updateAbilityHUD(this.player.abilityStates);
        updateAllLivesHUD(this.critters);

        // Win/loss check
        if (!this.player.alive) {
          this.enterEnded('lose', 'ELIMINATED', `${this.player.config.name} fell into the void`);
        } else if (this.activeCount <= 1 && !this.critters.some(c => c.falling)) {
          this.enterEnded('win', 'VICTORY', `${this.player.config.name} is the last one standing`);
        } else if (this.matchTimer <= 0) {
          if (this.player.alive) {
            this.enterEnded('win', 'SURVIVED', `${this.player.config.name} made it to the end`);
          } else {
            this.enterEnded('lose', 'TIME UP', 'Better luck next time');
          }
        }
        break;
      }

      case 'online': {
        this.updateOnline(dt);

        // When the server has ended the current match, the end screen is up.
        // R requeues for a new match; T returns to title. Both must work
        // from `this.phase === 'online'` — the offline `case 'ended'` below
        // never runs in multiplayer.
        const serverState = this.room?.state as any;
        const onServerEndScreen = serverState?.phase === 'ended';
        if (onServerEndScreen && consumeMenuAction('restart') && !this.restartInProgress && !this.connectInProgress) {
          this.restartMatch();
          break;
        }

        if (consumeMenuAction('back')) {
          this.room?.leave().catch(() => { /* ignore */ });
          this.room = null;
          for (const c of this.onlineCritters.values()) c.dispose();
          this.onlineCritters.clear();
          this.critters = [];
          this.enterTitle();
        }
        break;
      }

      case 'ended':
        // Finish any pending fall animations so eliminated critters disappear
        updateFalling(this.critters, dt);
        for (const c of this.critters) {
          if (c.alive) c.update(dt);
        }

        if (consumeMenuAction('restart')) {
          this.restartMatch();
        }
        if (consumeMenuAction('back')) {
          // T: always hard-return to title (drops online room if any)
          if (this.room) {
            this.room.leave().catch(() => { /* ignore */ });
            this.room = null;
            for (const c of this.onlineCritters.values()) c.dispose();
            this.onlineCritters.clear();
          }
          this.enterTitle();
        }
        // Portal redirects (P = next game, B = return to previous)
        // Reads raw key state — intentionally outside the input abstraction
        // since these are navigation actions, not gameplay.
        if (isFromPortal()) {
          if (this.portalKeyPressed('KeyP')) {
            window.location.href = getPortalExitUrl();
          }
          const returnUrl = getPortalReturnUrl();
          if (returnUrl && this.portalKeyPressed('KeyB')) {
            window.location.href = returnUrl;
          }
        }
        break;
    }
  }

  // --- Diagnostics (window.__arena.checkPlayer) -------------------------

  /**
   * Current local player world position + liveness, for debug helpers.
   * Works in both online and offline — `this.player` is updated every
   * frame with the server position in online mode.
   * Returns null between matches or before spawn.
   */
  public getLocalPlayerPos(): { x: number; z: number; alive: boolean; critterName: string } | null {
    const p = this.player;
    if (!p) return null;
    return { x: p.x, z: p.z, alive: !!p.alive, critterName: p.config?.name ?? '?' };
  }

  // -------------------------------------------------------------------------
  // Debug / Lab tool API
  //
  // These methods are ONLY consumed by the /tools.html dev tool. They keep
  // the production flow (title → character select → countdown) intact while
  // giving the tool a direct way to spawn arbitrary matches and inspect
  // state.
  // -------------------------------------------------------------------------

  /**
   * Global dt multiplier. Read by the main game loop each frame. Set to 0
   * to pause, <1 for slow-mo, >1 for fast-forward. Default 1.
   */
  public debugSpeedScale = 1;

  /**
   * Lab-only: spawn an offline match with an explicit player + bot lineup,
   * bypassing title / character select. Optionally forces an arena seed for
   * deterministic replay.
   */
  public debugStartOfflineMatch(
    playerName: string,
    botNames: string[],
    options: { seed?: number; packId?: string } = {},
  ): void {
    const playerConfig = CRITTER_PRESETS.find(c => c.name === playerName);
    if (!playerConfig) { console.warn('[Lab] unknown player:', playerName); return; }
    const botConfigs = botNames
      .map(n => CRITTER_PRESETS.find(c => c.name === n))
      .filter((c): c is CritterConfig => !!c);

    const roster = [playerConfig, ...botConfigs].slice(0, MAX_CRITTERS_PER_MATCH);

    clearMenuActions();
    this.phase = 'countdown';
    document.body.classList.add('match-active');
    hideTitleScreen();
    hideCharacterSelect();
    hideEndScreen();
    hidePreview();
    showMatchHud();

    this.phaseTimer = FEEL.match.countdown;
    this.matchTimer = FEEL.match.duration;

    // Lab path: same music hook as the normal flow. The lab heredará
    // automáticamente this call — players on /tools.html can still mute
    // via the 🎶 HUD button if the music distracts from balance work.
    playMusic('ingame');

    const seed = options.seed ?? ((Math.random() * 0xFFFFFFFF) | 0);
    this.arena.reset();
    // Lab doesn't expose a pack picker yet — roll randomly too so the
    // /tools.html path matches normal play. If a specific pack is needed
    // for testing, `options.packId` is forwarded when provided.
    const labPack = isArenaPackId(options.packId) ? options.packId : getRandomPackId();
    this.arena.buildFromSeed(seed, labPack);

    this.rebuildCritters(roster);

    // Preload GLBs for the new lineup (non-blocking)
    const glbPaths = roster
      .map(c => getRosterEntry(c.name)?.glbPath)
      .filter((p): p is string => typeof p === 'string');
    if (glbPaths.length > 0) preloadModels(glbPaths);

    initAllLivesHUD(this.critters, this.playerIndex);
    initAbilityHUD(
      this.player.abilityStates,
      getRosterEntry(this.player.config.name)?.id ?? null,
    );
    hideOverlay();
  }

  /** Lab-only: rebuild the arena with a specific seed, keeping the current
   *  match (and the same pack cosmetics the match is already using). */
  public debugForceArenaSeed(seed: number, packId?: ArenaPackId): void {
    // Pack precedence: explicit caller arg > current arena pack > undefined
    // (procedural sky, no decor). The optional argument lets the lab /
    // browser console rebuild with a specific pack without going through
    // the full restartMatch flow — useful for manual QA of pack visuals
    // and in-arena decor layouts.
    const desiredPack = packId ?? this.arena.getCurrentPackId() ?? undefined;
    this.arena.reset();
    this.arena.buildFromSeed(seed, desiredPack);
  }

  /** Lab-only: read-only snapshot of arena state for display panels. */
  public debugGetArenaInfo(): {
    seed: number;
    batches: Array<{ band: number; size: number; delay: number }>;
    collapseLevel: number;
    warningBatch: number;
    currentRadius: number;
    patternLabel: 'A (outer→inner sweep)' | 'B (axis-split)' | 'unknown';
  } | null {
    const layout = (this.arena as unknown as { layout?: { seed: number; fragments: Array<{ band: number }>; batches: Array<{ indices: number[]; delay: number }> } }).layout;
    if (!layout) return null;
    const batches = layout.batches.map(b => {
      const bands = [...new Set(b.indices.map(i => layout.fragments[i].band))];
      return { band: bands.length === 1 ? bands[0] : -1, size: b.indices.length, delay: b.delay };
    });
    // Pattern heuristic: Pattern B always has 6 batches (3 per side).
    // Pattern A has 3-5 batches, each one band.
    const patternLabel: 'A (outer→inner sweep)' | 'B (axis-split)' | 'unknown' =
      layout.batches.length >= 6 ? 'B (axis-split)' : 'A (outer→inner sweep)';
    return {
      seed: layout.seed,
      batches,
      collapseLevel: (this.arena as unknown as { syncedLevel: number }).syncedLevel,
      warningBatch: (this.arena as unknown as { syncedWarning: number }).syncedWarning,
      currentRadius: this.arena.currentRadius,
      patternLabel,
    };
  }

  /** Lab-only: tear down the current match and go back to an idle state. */
  public debugEndMatchImmediately(): void {
    for (const c of this.critters) c.dispose();
    this.critters = [];
    this.arena.reset();
    this.phase = 'title';
    hideEndScreen();
    hideCharacterSelect();
    hidePreview();
    hideOverlay();
    // Drop back to the title loop — also covers the lab's initial
    // teardown before it starts its own match.
    playMusic('intro');
  }
}
