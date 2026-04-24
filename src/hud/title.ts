// ---------------------------------------------------------------------------
// Title screen — mode selector + show/hide + handlers
// ---------------------------------------------------------------------------

import { setMatchHudVisible } from './dom-shared';

const titleScreen = document.getElementById('title-screen')!;
const btnVsBots = document.getElementById('btn-vs-bots') as HTMLButtonElement | null;
const btnOnline = document.getElementById('btn-online') as HTMLButtonElement | null;

export type TitleMode = 'bots' | 'online';

export function showTitleScreen(): void {
  setMatchHudVisible(false);
  titleScreen.classList.remove('hidden');
}

export function hideTitleScreen(): void {
  titleScreen.classList.add('hidden');
}

// --- Mode button wiring --------------------------------------------------

let titleModeSelectHandler: ((mode: TitleMode) => void) | null = null;
let titleModeConfirmHandler: ((mode: TitleMode) => void) | null = null;

/**
 * Wire the title screen's mode buttons.
 *  onSelect  — fired when the user hovers/focuses a mode (arrow keys too)
 *  onConfirm — fired when the user clicks a mode or presses Enter
 */
export function setTitleModeHandlers(
  onSelect: (mode: TitleMode) => void,
  onConfirm: (mode: TitleMode) => void,
): void {
  titleModeSelectHandler = onSelect;
  titleModeConfirmHandler = onConfirm;
}

btnVsBots?.addEventListener('click', () => {
  titleModeSelectHandler?.('bots');
  titleModeConfirmHandler?.('bots');
});
btnOnline?.addEventListener('click', () => {
  titleModeSelectHandler?.('online');
  titleModeConfirmHandler?.('online');
});
// Hover on desktop highlights the mode (keyboard focus stays in sync)
btnVsBots?.addEventListener('mouseenter', () => titleModeSelectHandler?.('bots'));
btnOnline?.addEventListener('mouseenter', () => titleModeSelectHandler?.('online'));

/** Visually mark which title-mode button is currently selected. */
export function updateTitleModeSelection(mode: TitleMode): void {
  btnVsBots?.classList.toggle('selected', mode === 'bots');
  btnOnline?.classList.toggle('selected', mode === 'online');
}

/** True if the online button is present (feature-gated by main.ts). */
export function isOnlineModeAvailable(): boolean {
  return !!btnOnline && btnOnline.isConnected;
}
