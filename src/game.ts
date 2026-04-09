import * as THREE from 'three';
import { Arena } from './arena';
import { Critter, CRITTER_PRESETS } from './critter';
import { updatePlayer, isRestartPressed } from './player';
import { updateBot } from './bot';
import { updateAbilities } from './abilities';
import { resolveCollisions, checkFalloff, updateFalling } from './physics';
import { updateHUD, showOverlay, hideOverlay, initAbilityHUD, updateAbilityHUD, initAllLivesHUD, updateAllLivesHUD } from './hud';
import { applyHitStop, FEEL } from './gamefeel';

type Phase = 'countdown' | 'playing' | 'ended';

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

  private phase: Phase = 'countdown';
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

    this.player = this.critters[0];
    initAbilityHUD(this.player.abilityStates);
    initAllLivesHUD(this.critters);
    this.startCountdown();
  }

  private startCountdown(): void {
    this.phase = 'countdown';
    this.phaseTimer = FEEL.match.countdown;
    showOverlay('Get Ready!');
  }

  /** Critters still in the game (have lives or are alive and not permanently eliminated). */
  private get activeCount(): number {
    return this.critters.filter((c) => c.alive).length;
  }

  /** Pick a respawn position near center that's inside the current arena. */
  private pickRespawnPos(): [number, number] {
    const r = this.arena.currentRadius * 0.4;
    const angle = Math.random() * Math.PI * 2;
    return [Math.cos(angle) * r, Math.sin(angle) * r];
  }

  update(dt: number): void {
    switch (this.phase) {
      case 'countdown':
        this.phaseTimer -= dt;
        const sec = Math.ceil(this.phaseTimer);
        if (sec > 0) {
          showOverlay(`${sec}`);
        } else {
          hideOverlay();
          this.phase = 'playing';
        }
        break;

      case 'playing': {
        const effectiveDt = applyHitStop(dt);
        if (effectiveDt === 0) {
          updateAbilityHUD(this.player.abilityStates);
          break;
        }

        this.matchTimer -= effectiveDt;

        // 1. Player input
        updatePlayer(this.player, effectiveDt);

        // 2. Bot AI
        for (let i = 1; i < this.critters.length; i++) {
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
          this.phase = 'ended';
          showOverlay('Eliminated!', 'Press R to restart');
        } else if (this.activeCount <= 1 && !this.critters.some(c => c.falling)) {
          this.phase = 'ended';
          showOverlay('You Win!', 'Press R to restart');
        } else if (this.matchTimer <= 0) {
          this.phase = 'ended';
          if (this.player.alive) {
            showOverlay('Time Up - You Survived!', 'Press R to restart');
          } else {
            showOverlay('Time Up!', 'Press R to restart');
          }
        }
        break;
      }

      case 'ended':
        updateFalling(this.critters, dt);
        for (const c of this.critters) {
          if (c.alive) c.update(dt);
        }

        if (isRestartPressed()) {
          this.restart();
        }
        break;
    }
  }

  private restart(): void {
    this.arena.reset();
    this.matchTimer = FEEL.match.duration;

    for (let i = 0; i < this.critters.length; i++) {
      this.critters[i].reset(SPAWN_POSITIONS[i][0], SPAWN_POSITIONS[i][1]);
    }

    initAbilityHUD(this.player.abilityStates);
    initAllLivesHUD(this.critters);
    this.startCountdown();
  }
}
