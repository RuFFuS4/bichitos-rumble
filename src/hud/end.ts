// ---------------------------------------------------------------------------
// End screen + per-match stats block + match-HUD visibility helper
// ---------------------------------------------------------------------------

import { setMatchHudVisible } from './dom-shared';

const endScreen      = document.getElementById('end-screen')!;
const endResultEl    = document.getElementById('end-result')!;
const endSubtitleEl  = document.getElementById('end-subtitle')!;
const titleScreen    = document.getElementById('title-screen')!;
const characterSelect = document.getElementById('character-select')!;
// End-screen per-match stats block (null on /tools.html).
const endStatsEl     = document.getElementById('end-stats');

export type EndResult = 'win' | 'lose' | 'draw';

// ---- Stats block --------------------------------------------------------

export interface EndMatchStats {
  /** Headbutt lunges performed this match (attempts, not contacts). */
  headbutts: number;
  /** Total ability casts across slots (J + K + L). */
  abilitiesUsed: number;
  /** Times the player fell off the arena. */
  falls: number;
  /** Times the player respawned from a fall. */
  respawns: number;
}

/** Show the stats row on the end-screen with the player's counters. */
export function setEndMatchStats(stats: EndMatchStats): void {
  if (!endStatsEl) return;
  // Order + icon per stat. Emojis chosen to read at a glance in the
  // small 13px row — no custom asset pipeline required. If we ever
  // want themed glyphs, swap these for CSS masked SVGs without
  // touching the rest.
  const rows: Array<{ icon: string; label: string; value: number }> = [
    { icon: '⚡', label: 'Headbutts',  value: stats.headbutts     },
    { icon: '✨', label: 'Abilities',  value: stats.abilitiesUsed },
    { icon: '💀', label: 'Falls',      value: stats.falls         },
    { icon: '🔁', label: 'Respawns',   value: stats.respawns      },
  ];
  endStatsEl.innerHTML = '';
  const valueEls: Array<{ el: HTMLSpanElement; target: number }> = [];
  for (const { icon, label, value } of rows) {
    const col = document.createElement('div');
    col.className = 'stat';
    const i = document.createElement('span');
    i.className = 'stat-icon';
    i.textContent = icon;
    const v = document.createElement('span');
    v.className = 'stat-value';
    v.textContent = '0';
    const l = document.createElement('span');
    l.className = 'stat-label';
    l.textContent = label;
    col.appendChild(i);
    col.appendChild(v);
    col.appendChild(l);
    endStatsEl.appendChild(col);
    valueEls.push({ el: v, target: value });
  }
  endStatsEl.style.display = 'flex';
  // Trigger the entry animation (CSS handles the look) by toggling a
  // class. Using the next frame so the display:flex has committed.
  endStatsEl.classList.remove('stats-enter');
  requestAnimationFrame(() => {
    endStatsEl.classList.add('stats-enter');
  });
  // Count-up: each number eases from 0 to its final value over ~700 ms.
  // Pure RAF loop, no extra deps. Safe to re-invoke — the previous loop's
  // stored el is overwritten on the next setEndMatchStats() call.
  animateCountUp(valueEls, 700);
}

function animateCountUp(
  entries: Array<{ el: HTMLSpanElement; target: number }>,
  durationMs: number,
): void {
  const start = performance.now();
  function step(now: number) {
    const t = Math.min(1, (now - start) / durationMs);
    // easeOutCubic — fast first, soft landing
    const eased = 1 - Math.pow(1 - t, 3);
    for (const { el, target } of entries) {
      el.textContent = String(Math.round(target * eased));
    }
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** Hide the stats row (called on match start, title return, etc.). */
export function clearEndMatchStats(): void {
  if (!endStatsEl) return;
  endStatsEl.style.display = 'none';
  endStatsEl.innerHTML = '';
}

// ---- Tap handler --------------------------------------------------------

// Tap-anywhere handler on the end screen — mobile menu UX.
// Title screen uses explicit mode buttons, not tap-anywhere, to avoid
// starting a match accidentally.
let endTapHandler: (() => void) | null = null;

export function setEndTapHandler(handler: () => void): void {
  endTapHandler = handler;
}

endScreen.addEventListener('click', (e) => {
  // Don't trigger if clicking on the kbd hint elements (let them be passive)
  const target = e.target as HTMLElement;
  if (target.closest('kbd')) return;
  endTapHandler?.();
});

// ---- Show / hide --------------------------------------------------------

export function showEndScreen(
  result: EndResult,
  title: string,
  subtitle: string,
  showPortalOptions = false,
): void {
  endResultEl.textContent = title;
  endResultEl.className = 'end-result ' + result;
  endSubtitleEl.textContent = subtitle;
  // Show portal prompt only for players who arrived via portal
  const portalPrompt = document.getElementById('end-portal-prompt');
  if (portalPrompt) portalPrompt.style.display = showPortalOptions ? '' : 'none';
  endScreen.classList.remove('hidden');
  // Keep the match HUD visible behind the end screen so player sees final state
  setMatchHudVisible(true);
}

export function hideEndScreen(): void {
  endScreen.classList.add('hidden');
}

/** Called when match starts, to ensure HUD is visible and menus are hidden. */
export function showMatchHud(): void {
  setMatchHudVisible(true);
  titleScreen.classList.add('hidden');
  characterSelect.classList.add('hidden');
  endScreen.classList.add('hidden');
}
