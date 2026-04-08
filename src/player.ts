import { Critter } from './critter';

const keys: Record<string, boolean> = {};

window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

export function updatePlayer(critter: Critter, dt: number): void {
  if (!critter.alive) return;

  let mx = 0;
  let mz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) mz = -1;
  if (keys['KeyS'] || keys['ArrowDown']) mz = 1;
  if (keys['KeyA'] || keys['ArrowLeft']) mx = -1;
  if (keys['KeyD'] || keys['ArrowRight']) mx = 1;

  // Normalize diagonal
  const len = Math.sqrt(mx * mx + mz * mz);
  if (len > 0) {
    mx /= len;
    mz /= len;
  }

  const accel = critter.config.speed;
  critter.vx += mx * accel * dt;
  critter.vz += mz * accel * dt;

  // Headbutt on Space
  if (keys['Space']) {
    critter.startHeadbutt();
  }
}

export function isRestartPressed(): boolean {
  return !!keys['KeyR'];
}
