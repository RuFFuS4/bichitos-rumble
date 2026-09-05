// ---------------------------------------------------------------------------
// Online waiting screen (room fill + countdown + slot roster)
// ---------------------------------------------------------------------------
//
// Shown while the server is in phase 'waiting'. Renders:
//   - A big countdown indicating seconds left until bot-fill
//   - A row of 4 slots (filled/empty, human/bot)
//   - A hint about bot-fill behaviour
//
// Null-safe: every function is a no-op on pages where the DOM nodes don't
// exist (e.g. /tools.html, which skips the waiting flow entirely).
// ---------------------------------------------------------------------------

import { getRosterEntry } from '../roster';
import { getCritterThumbnail } from '../slot-thumbnail';
import { t } from '../i18n';

// Null on /tools.html (the lab skips the waiting flow entirely).
const waitingScreen    = document.getElementById('waiting-screen');
const waitingCountdownEl = document.getElementById('waiting-countdown');
const waitingSlotsEl   = document.getElementById('waiting-slots');
const waitingShareEl   = document.getElementById('waiting-share');
const waitingShareLink = document.getElementById('waiting-share-link');
const waitingShareCopy = document.getElementById('waiting-share-copy') as HTMLButtonElement | null;
const waitingShareNative = document.getElementById('waiting-share-native') as HTMLButtonElement | null;

// --- H4 private rooms — share row -----------------------------------------
// game.ts calls setWaitingShareRoom(roomId) after creating a private room
// ("Play with Friends"); null hides the row again (public rooms / leave).
let currentShareUrl: string | null = null;

export function setWaitingShareRoom(roomId: string | null): void {
  if (!waitingShareEl || !waitingShareLink) return;
  if (!roomId) {
    currentShareUrl = null;
    waitingShareEl.style.display = 'none';
    return;
  }
  currentShareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;
  waitingShareLink.textContent = currentShareUrl;
  waitingShareEl.style.display = '';
  // navigator.share only exists on secure contexts + supporting browsers
  // (mobile mostly) — hide the native button where it would just throw.
  if (waitingShareNative) {
    waitingShareNative.style.display =
      typeof navigator !== 'undefined' && 'share' in navigator ? '' : 'none';
  }
}

waitingShareCopy?.addEventListener('click', () => {
  if (!currentShareUrl) return;
  navigator.clipboard?.writeText(currentShareUrl).then(() => {
    waitingShareCopy.textContent = t('share-copied');
    // Vuelve al texto original del botón — misma clave que su data-i18n.
    setTimeout(() => { waitingShareCopy.textContent = t('waiting-share-copy'); }, 1600);
  }).catch(() => { /* clipboard blocked — the link is visible to copy by hand */ });
});

waitingShareNative?.addEventListener('click', () => {
  if (!currentShareUrl) return;
  void navigator.share?.({
    title: 'Bichitos Rumble',
    text: t('share-join-room'),
    url: currentShareUrl,
  }).catch(() => { /* user cancelled the share sheet — fine */ });
});

export type WaitingSlotKind = 'human' | 'bot' | 'empty';

export interface WaitingSlotData {
  /** 'human' | 'bot' | 'empty'. */
  kind: WaitingSlotKind;
  /** Critter name (e.g. "Sergei"). Empty string for empty slots. */
  name: string;
  /** Display colour hex (e.g. 0xff5577). 0 for empty. */
  color: number;
  /** 2026-05-01 final block — verified nickname for human slots.
   *  Empty for bots, empties, and guests. When present, the slot
   *  displays "Rafa (Sergei)"; when absent it falls back to just
   *  the critter name. */
  nickname?: string;
}

export interface WaitingScreenData {
  secondsLeft: number;
  slots: WaitingSlotData[];   // exactly MAX_PLAYERS entries (padded with empty)
  maxPlayers: number;
}

export function showWaitingScreen(): void {
  // Checklist 2026-09-05: la barra de habilidades del HUD asomaba entre
  // el prompt "T · salir de la sala" y el texto (captura del host de
  // sala privada). La clase en body la oculta mientras esperamos.
  document.body.classList.add('waiting-room');
  if (!waitingScreen) return;
  waitingScreen.classList.remove('hidden');
}

export function hideWaitingScreen(): void {
  document.body.classList.remove('waiting-room');
  if (!waitingScreen) return;
  waitingScreen.classList.add('hidden');
}

/**
 * Refresh the waiting-screen DOM with server-driven data. Called every
 * frame while phase === 'waiting'. Only touches the nodes whose content
 * actually changed (the countdown goes down every tick; slot contents
 * change only when a player joins/leaves/becomes a bot).
 */
export function updateWaitingScreen(data: WaitingScreenData): void {
  if (!waitingScreen || !waitingCountdownEl || !waitingSlotsEl) return;

  // Countdown: round up so "0.4s left" reads as "1s left" until it truly hits 0.
  const sec = Math.max(0, Math.ceil(data.secondsLeft));
  if (waitingCountdownEl.textContent !== String(sec)) {
    waitingCountdownEl.textContent = String(sec);
  }
  // Last 10s: urgency pulse.
  const urgent = sec > 0 && sec <= 10;
  waitingCountdownEl.classList.toggle('urgent', urgent);

  // Slots — re-render the set. Small enough that an innerHTML replace is fine.
  const fp = waitingSlotsFingerprint(data.slots);
  if (waitingSlotsEl.dataset.fp !== fp) {
    waitingSlotsEl.innerHTML = '';
    for (const s of data.slots) {
      waitingSlotsEl.appendChild(buildWaitingSlotEl(s));
    }
    waitingSlotsEl.dataset.fp = fp;
  }
}

function waitingSlotsFingerprint(slots: WaitingSlotData[]): string {
  return slots.map(s => `${s.kind}:${s.name}:${s.nickname ?? ''}:${s.color}`).join('|');
}

function buildWaitingSlotEl(s: WaitingSlotData): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'waiting-slot ' + s.kind;

  // Avatar: starts as a coloured tile (instant fallback) and upgrades to a
  // 3D thumbnail once getCritterThumbnail resolves. No await so the slot
  // renders immediately; the cached thumbnails from character-select
  // usually resolve synchronously.
  const avatar = document.createElement('span');
  avatar.className = 'waiting-slot-avatar';
  if (s.color) {
    avatar.style.background = '#' + s.color.toString(16).padStart(6, '0');
  }
  if (s.kind !== 'empty' && s.name) {
    const entry = getRosterEntry(s.name);
    if (entry) {
      getCritterThumbnail(entry).then(url => {
        if (!url) return;
        // Keep the tinted background as a subtle halo behind the avatar.
        avatar.style.backgroundImage = `url(${url})`;
        avatar.style.backgroundSize = 'cover';
        avatar.style.backgroundPosition = 'center';
      }).catch(() => { /* keep fallback tile */ });
    }
  }
  el.appendChild(avatar);

  // 2026-05-01 final block — verified human slots display the
  // PLAYER NICKNAME on the main line ("Rafa") with the critter
  // name as a smaller subtitle ("Sergei"). Bots and guests fall
  // back to the critter name only. Empty slots stay "Open".
  const name = document.createElement('span');
  name.className = 'waiting-slot-name';
  if (s.kind === 'empty') {
    name.textContent = t('waiting-slot-open');
  } else if (s.nickname) {
    name.textContent = s.nickname;
  } else {
    name.textContent = s.name || '—';
  }
  el.appendChild(name);
  if (s.nickname && s.name) {
    const sub = document.createElement('span');
    sub.className = 'waiting-slot-subtitle';
    sub.textContent = s.name;
    el.appendChild(sub);
  }

  // Badge: HUMAN / 🤖 BOT / OPEN — type of participant, below the name.
  // 2026-05-01 polish — bot rows now ship the sprite mask alongside
  // the emoji fallback. CSS hides the unused one based on the
  // `has-hud-sprites` body class.
  const badge = document.createElement('span');
  badge.className = 'waiting-slot-badge';
  if (s.kind === 'bot') {
    // El label viene SOLO del diccionario tipado (nunca input de usuario).
    badge.innerHTML =
      '<span class="sprite-fallback-hud" aria-hidden="true">\u{1F916}</span>' +
      '<span class="sprite-hud sprite-hud-bot-mask waiting-bot-sprite" aria-hidden="true"></span>' +
      '<span class="waiting-bot-label">' + t('waiting-badge-bot') + '</span>';
  } else {
    badge.textContent = s.kind === 'human' ? t('waiting-badge-human') : t('waiting-badge-open');
  }
  el.appendChild(badge);

  return el;
}
