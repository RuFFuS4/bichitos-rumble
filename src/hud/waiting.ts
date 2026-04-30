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

// Null on /tools.html (the lab skips the waiting flow entirely).
const waitingScreen    = document.getElementById('waiting-screen');
const waitingCountdownEl = document.getElementById('waiting-countdown');
const waitingSlotsEl   = document.getElementById('waiting-slots');

export type WaitingSlotKind = 'human' | 'bot' | 'empty';

export interface WaitingSlotData {
  /** 'human' | 'bot' | 'empty'. */
  kind: WaitingSlotKind;
  /** Critter name (e.g. "Sergei"). Empty string for empty slots. */
  name: string;
  /** Display colour hex (e.g. 0xff5577). 0 for empty. */
  color: number;
}

export interface WaitingScreenData {
  secondsLeft: number;
  slots: WaitingSlotData[];   // exactly MAX_PLAYERS entries (padded with empty)
  maxPlayers: number;
}

export function showWaitingScreen(): void {
  if (!waitingScreen) return;
  waitingScreen.classList.remove('hidden');
}

export function hideWaitingScreen(): void {
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
  return slots.map(s => `${s.kind}:${s.name}:${s.color}`).join('|');
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

  // Critter name for filled slots ("Sergei", "Trunk"); placeholder
  // "Open" for empty slots so the animated-dots CSS reads as
  // "waiting for player…" instead of pointing at a dash.
  const name = document.createElement('span');
  name.className = 'waiting-slot-name';
  name.textContent = s.name || (s.kind === 'empty' ? 'Open' : '—');
  el.appendChild(name);

  // Badge: HUMAN / 🤖 BOT / OPEN — type of participant, below the name.
  // 2026-05-01 polish — bot rows now ship the sprite mask alongside
  // the emoji fallback. CSS hides the unused one based on the
  // `has-hud-sprites` body class.
  const badge = document.createElement('span');
  badge.className = 'waiting-slot-badge';
  if (s.kind === 'bot') {
    badge.innerHTML =
      '<span class="sprite-fallback-hud" aria-hidden="true">\u{1F916}</span>' +
      '<span class="sprite-hud sprite-hud-bot-mask waiting-bot-sprite" aria-hidden="true"></span>' +
      '<span class="waiting-bot-label">BOT</span>';
  } else {
    badge.textContent = s.kind === 'human' ? 'HUMAN' : 'OPEN';
  }
  el.appendChild(badge);

  return el;
}
