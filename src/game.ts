import * as THREE from 'three';
import { Arena } from './arena';
import { Critter, CRITTER_PRESETS } from './critter';
import { updatePlayer, isRestartPressed } from './player';
import { updateBot } from './bot';
import { resolveCollisions, checkFalloff } from './physics';
import { updateHUD, showOverlay, hideOverlay } from './hud';

type Phase = 'countdown' | 'playing' | 'ended';

const MATCH_DURATION = 90; // seconds
const COLLAPSE_INTERVAL = 15; // seconds between collapses
const COUNTDOWN_SECS = 3;

export class Game {
  scene: THREE.Scene;
  arena: Arena;
  critters: Critter[] = [];
  player!: Critter;

  private phase: Phase = 'countdown';
  private phaseTimer = 0;
  private matchTimer = MATCH_DURATION;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.arena = new Arena(scene);

    // Spawn 4 critters at cardinal positions
    const spawnDist = 6;
    const positions: [number, number][] = [
      [0, -spawnDist],
      [0, spawnDist],
      [-spawnDist, 0],
      [spawnDist, 0],
    ];

    for (let i = 0; i < 4; i++) {
      const critter = new Critter(CRITTER_PRESETS[i], scene);
      critter.x = positions[i][0];
      critter.z = positions[i][1];
      this.critters.push(critter);
    }

    // Player controls the first critter
    this.player = this.critters[0];

    this.startCountdown();
  }

  private startCountdown(): void {
    this.phase = 'countdown';
    this.phaseTimer = COUNTDOWN_SECS;
    showOverlay('Get Ready!');
  }

  private get aliveCount(): number {
    return this.critters.filter((c) => c.alive).length;
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

      case 'playing':
        this.matchTimer -= dt;

        // Player input
        updatePlayer(this.player, dt);

        // Bot AI
        for (let i = 1; i < this.critters.length; i++) {
          updateBot(this.critters[i], this.critters, dt);
        }

        // Update critters
        for (const c of this.critters) {
          if (c.alive) c.update(dt);
        }

        // Physics
        resolveCollisions(this.critters);
        checkFalloff(this.critters, this.arena, dt);

        // Arena collapse
        this.arena.update(dt, COLLAPSE_INTERVAL);

        // Update HUD
        updateHUD(this.aliveCount, Math.max(0, this.matchTimer));

        // Win/loss check
        if (!this.player.alive) {
          this.phase = 'ended';
          showOverlay('Eliminated!', 'Press R to restart');
        } else if (this.aliveCount <= 1) {
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

      case 'ended':
        // Falling animation continues
        checkFalloff(this.critters, this.arena, dt);
        for (const c of this.critters) c.update(dt);

        if (isRestartPressed()) {
          this.restart();
        }
        break;
    }
  }

  private restart(): void {
    this.arena.reset();
    this.matchTimer = MATCH_DURATION;

    const spawnDist = 6;
    const positions: [number, number][] = [
      [0, -spawnDist],
      [0, spawnDist],
      [-spawnDist, 0],
      [spawnDist, 0],
    ];
    for (let i = 0; i < this.critters.length; i++) {
      this.critters[i].reset(positions[i][0], positions[i][1]);
    }

    this.startCountdown();
  }
}
