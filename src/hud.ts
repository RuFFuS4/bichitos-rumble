const aliveEl = document.getElementById('hud-alive')!;
const timerEl = document.getElementById('hud-timer')!;
const overlayEl = document.getElementById('overlay')!;

export function updateHUD(aliveCount: number, timeLeft: number): void {
  aliveEl.textContent = `Alive: ${aliveCount}`;
  const mins = Math.floor(timeLeft / 60);
  const secs = Math.floor(timeLeft % 60);
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function showOverlay(main: string, sub?: string): void {
  overlayEl.style.display = 'block';
  overlayEl.innerHTML = main + (sub ? `<div class="sub">${sub}</div>` : '');
}

export function hideOverlay(): void {
  overlayEl.style.display = 'none';
}
