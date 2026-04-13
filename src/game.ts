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
  setSlotClickHandler, setTitleTapHandler, setEndTapHandler,
  type EndResult,
} from './hud';
import { applyHitStop, FEEL } from './gamefeel';
import { showPreview, swapPreviewCritter, hidePreview } from './preview';
import { play as playSound } from './audio';
import { recordPick, recordOutcome, recordFall } from './stats';
import { getDisplayRoster, getRosterEntry, type RosterEntry } from './roster';
import { preloadModels } from './model-loader';

type Phase = 'title' | 'character_select' | 'countdown' | 'playing' | 'ended';

const SPAWN_POSITIONS: [number, number][] = [
  [0, -6],
  [0, 6],
  [-6, 0],
  [6, 0],
];
const MAX_CRITTERS_PER_MATCH = SPAWN_POSITIONS.length;

/**
 * Build the match roster: player config first, then bots from a pool.
 * Bots are drawn round-robin from the pool, skipping the player's config.
 */
function buildMatchRoster(
  playerConfig: CritterConfig,
  botPool: CritterConfig[],
  botCount: number,
): CritterConfig[] {
  const roster: CritterConfig[] = [playerConfig];
  const available = botPool.filter(c => c.name !== playerConfig.name);
  if (available.length === 0) return roster;
  for (let i = 0; i < botCount; i++) {
    roster.push(available[i % available.length]);
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
  private displayRoster: RosterEntry[] = getDisplayRoster();

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
        this.enterCountdown();
      } else {
        // Tap on different slot → select it for preview (playable or WIP)
        this.selectedIdx = idx;
        updateCharacterSelect(this.selectedIdx);
        this.swapPreviewForEntry(entry);
      }
    });

    setTitleTapHandler(() => {
      if (this.phase === 'title') {
        this.enterCharacterSelect();
      }
    });

    setEndTapHandler(() => {
      if (this.phase === 'ended') {
        this.enterCountdown();
      }
    });

    this.enterTitle();
  }

  // -------------------------------------------------------------------------
  // Phase transitions
  // -------------------------------------------------------------------------

  private enterTitle(): void {
    clearMenuActions();
    this.phase = 'title';
    showTitleScreen();
    hideCharacterSelect();
    hideEndScreen();
    hideOverlay();
    hidePreview();
  }

  private enterCharacterSelect(): void {
    clearMenuActions();
    this.phase = 'character_select';
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
    hideCharacterSelect();
    hidePreview();
    hideEndScreen();
    showMatchHud();
    this.phase = 'countdown';
    this.phaseTimer = FEEL.match.countdown;
    this.matchTimer = FEEL.match.duration;

    // Resolve player config from the display roster selection
    const entry = this.displayRoster[this.selectedIdx];
    const playerConfig = CRITTER_PRESETS.find(p => p.name === entry?.displayName)
      ?? CRITTER_PRESETS[0]; // safety fallback

    // Rebuild the roster: player first, bots from full CRITTER_PRESETS pool
    this.arena.reset();
    const roster = buildMatchRoster(
      playerConfig,
      CRITTER_PRESETS,
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

    initAbilityHUD(this.player.abilityStates);
    initAllLivesHUD(this.critters);
    showOverlay('Get Ready!');

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

    // Instantiate fresh critters from the roster, clipped to spawn slots
    const count = Math.min(roster.length, SPAWN_POSITIONS.length);
    for (let i = 0; i < count; i++) {
      const critter = new Critter(roster[i], this.scene);
      critter.x = SPAWN_POSITIONS[i][0];
      critter.z = SPAWN_POSITIONS[i][1];
      this.critters.push(critter);
    }

    // Player is always the first critter of the roster
    this.playerIndex = 0;
    this.player = this.critters[0];
  }

  private enterEnded(result: EndResult, title: string, subtitle: string): void {
    clearMenuActions();
    this.phase = 'ended';
    hideOverlay();
    showEndScreen(result, title, subtitle);
    if (result === 'win') {
      playSound('victory');
    }

    // Stats: record the match outcome for the player's critter. Draws are
    // not recorded (no current code path produces 'draw', but the type
    // allows it — guarded here so future tie logic doesn't inflate counts).
    if (result === 'win' || result === 'lose') {
      recordOutcome(this.player.config.name, result);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private get activeCount(): number {
    return this.critters.filter((c) => c.alive).length;
  }

  /** Show the correct preview model for a roster entry (playable or WIP). */
  private swapPreviewForEntry(entry: RosterEntry | undefined): void {
    if (!entry) return;
    const config = CRITTER_PRESETS.find(p => p.name === entry.displayName)
      ?? previewConfigFromRoster(entry);
    swapPreviewCritter(config);
  }

  /** Pick a respawn position near center that's inside the current arena. */
  private pickRespawnPos(): [number, number] {
    const r = this.arena.currentRadius * 0.4;
    const angle = Math.random() * Math.PI * 2;
    return [Math.cos(angle) * r, Math.sin(angle) * r];
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------

  update(dt: number): void {
    switch (this.phase) {
      case 'title':
        // Let critters idle (bob animation, no input)
        for (const c of this.critters) c.update(dt);
        if (consumeMenuAction('confirm')) {
          this.enterCharacterSelect();
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
        if (consumeMenuAction('confirm')) {
          const sel = this.displayRoster[this.selectedIdx];
          if (sel?.status === 'playable') {
            this.enterCountdown();
          }
          // WIP/locked → ignore confirm
        }
        if (consumeMenuAction('back')) {
          this.enterTitle();
        }
        break;
      }

      case 'countdown': {
        this.phaseTimer -= dt;
        const sec = Math.ceil(this.phaseTimer);
        if (sec > 0) {
          showOverlay(`${sec}`);
        } else {
          hideOverlay();
          this.phase = 'playing';
        }
        break;
      }

      case 'playing': {
        const effectiveDt = applyHitStop(dt);
        if (effectiveDt === 0) {
          updateAbilityHUD(this.player.abilityStates);
          break;
        }

        this.matchTimer -= effectiveDt;

        // 1. Player input
        updatePlayer(this.player, effectiveDt);

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

        // 7. Arena collapse
        this.arena.update(effectiveDt, FEEL.match.collapseInterval);

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

      case 'ended':
        // Finish any pending fall animations so eliminated critters disappear
        updateFalling(this.critters, dt);
        for (const c of this.critters) {
          if (c.alive) c.update(dt);
        }

        if (consumeMenuAction('restart')) {
          this.enterCountdown();
        }
        if (consumeMenuAction('back')) {
          this.enterTitle();
        }
        break;
    }
  }
}
