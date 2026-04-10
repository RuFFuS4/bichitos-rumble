import * as THREE from 'three';
import { Arena } from './arena';
import { Critter, CRITTER_PRESETS } from './critter';
import { updatePlayer, isRestartPressed, consumeKey } from './player';
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
  type EndResult,
} from './hud';
import { applyHitStop, FEEL } from './gamefeel';

type Phase = 'title' | 'character_select' | 'countdown' | 'playing' | 'ended';

const SPAWN_POSITIONS: [number, number][] = [
  [0, -6],
  [0, 6],
  [-6, 0],
  [6, 0],
];

export class Game {
  scene: THREE.Scene;
  arena: Arena;
  critters: Critter[] = [];
  player!: Critter;
  private playerIndex = 0;
  private selectedIdx = 0;   // index highlighted in character select

  private phase: Phase = 'title';
  private phaseTimer = 0;
  private matchTimer = FEEL.match.duration;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.arena = new Arena(scene);

    for (let i = 0; i < 4; i++) {
      const critter = new Critter(CRITTER_PRESETS[i], scene);
      critter.x = SPAWN_POSITIONS[i][0];
      critter.z = SPAWN_POSITIONS[i][1];
      this.critters.push(critter);
    }

    // Default player until character select. Abilities HUD shows placeholder
    // values that will be rebuilt when the player picks their critter.
    this.player = this.critters[0];
    this.playerIndex = 0;

    this.enterTitle();
  }

  // -------------------------------------------------------------------------
  // Phase transitions
  // -------------------------------------------------------------------------

  private enterTitle(): void {
    this.phase = 'title';
    showTitleScreen();
    hideCharacterSelect();
    hideEndScreen();
    hideOverlay();
  }

  private enterCharacterSelect(): void {
    this.phase = 'character_select';
    hideTitleScreen();
    hideEndScreen();
    showCharacterSelect(CRITTER_PRESETS, this.selectedIdx);
  }

  private enterCountdown(): void {
    hideCharacterSelect();
    hideEndScreen();
    showMatchHud();
    this.phase = 'countdown';
    this.phaseTimer = FEEL.match.countdown;
    this.matchTimer = FEEL.match.duration;

    // Full reset of arena and all critters for a fresh match
    this.arena.reset();
    for (let i = 0; i < this.critters.length; i++) {
      this.critters[i].reset(SPAWN_POSITIONS[i][0], SPAWN_POSITIONS[i][1]);
    }

    // Wire up player + HUD to the chosen critter
    this.playerIndex = this.selectedIdx;
    this.player = this.critters[this.playerIndex];
    initAbilityHUD(this.player.abilityStates);
    initAllLivesHUD(this.critters);
    showOverlay('Get Ready!');
  }

  private enterEnded(result: EndResult, title: string, subtitle: string): void {
    this.phase = 'ended';
    hideOverlay();
    showEndScreen(result, title, subtitle);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private get activeCount(): number {
    return this.critters.filter((c) => c.alive).length;
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
        if (consumeKey('Space') || consumeKey('Enter')) {
          this.enterCharacterSelect();
        }
        break;

      case 'character_select':
        for (const c of this.critters) c.update(dt);
        if (consumeKey('ArrowLeft') || consumeKey('KeyA')) {
          this.selectedIdx = (this.selectedIdx - 1 + CRITTER_PRESETS.length) % CRITTER_PRESETS.length;
          updateCharacterSelect(this.selectedIdx);
        }
        if (consumeKey('ArrowRight') || consumeKey('KeyD')) {
          this.selectedIdx = (this.selectedIdx + 1) % CRITTER_PRESETS.length;
          updateCharacterSelect(this.selectedIdx);
        }
        if (consumeKey('Space') || consumeKey('Enter')) {
          this.enterCountdown();
        }
        if (consumeKey('KeyT') || consumeKey('Escape')) {
          this.enterTitle();
        }
        break;

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
        checkFalloff(this.critters, this.arena);

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

        if (isRestartPressed()) {
          this.enterCountdown();
        }
        if (consumeKey('KeyT')) {
          this.enterTitle();
        }
        break;
    }
  }
}
