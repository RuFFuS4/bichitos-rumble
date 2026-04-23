// ---------------------------------------------------------------------------
// Online Belt toast — "Nickname has taken the Throne Belt!"
// ---------------------------------------------------------------------------
//
// Broadcast-driven counterpart to the local badge-toast.ts. The BrawlRoom
// sends a `beltChanged` message at the end of every online match for each
// of the 5 online belts whose holder is different from before. We pop a
// small card bottom-right so the whole room sees the change live.
//
// Special-cased when the new holder is YOU: the card turns gold and the
// text becomes "🏆 You took the X Belt!" with a louder entrance.
//
// DOM: a single `#online-belt-toast` node that we create lazily so
// the element doesn't exist before main.ts calls initOnlineBeltToast().
// Successive events re-arm the timer and swap the content in place.
// ---------------------------------------------------------------------------

import type { BeltChangedEvent } from './network';
import { getCachedIdentity } from './online-identity';

interface BeltMeta {
  name: string;
  icon: string;
  imgPath: string;
  /** Format the raw numeric metric into human-readable text. Mirrors
   *  hall-of-belts.ts ONLINE_BELT_META so the toast reads consistently
   *  with the leaderboard column. */
  format: (value: number) => string;
}

const BELT_META: Record<BeltChangedEvent['belt'], BeltMeta> = {
  'throne-online':    { name: 'Throne Belt',    icon: '👑', imgPath: './images/belts/throne-online.png',
                        format: (v) => `${v} wins` },
  'flash-online':     { name: 'Flash Belt',     icon: '⚡', imgPath: './images/belts/flash-online.png',
                        format: (v) => `${(v / 1000).toFixed(1)}s` },
  'ironclad-online':  { name: 'Ironclad Belt',  icon: '🛡️', imgPath: './images/belts/ironclad-online.png',
                        format: (v) => `${v.toFixed(2)} lives/match` },
  'slayer-online':    { name: 'Slayer Belt',    icon: '🗡️', imgPath: './images/belts/slayer-online.png',
                        format: (v) => `${v} kills` },
  'hot-streak-online': { name: 'Hot Streak Belt', icon: '🔥', imgPath: './images/belts/hot-streak-online.png',
                        format: (v) => `${v} in a row` },
};

let toastEl: HTMLDivElement | null = null;
let hideTimer: number | null = null;

function ensureToast(): HTMLDivElement {
  if (toastEl) return toastEl;
  // Scoped styles injected once — same pattern as the gamepad toast so
  // there's no CSS in index.html for this single-purpose surface.
  if (!document.getElementById('online-belt-toast-style')) {
    const style = document.createElement('style');
    style.id = 'online-belt-toast-style';
    style.textContent = `
      #online-belt-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(16px);
        padding: 12px 18px 14px;
        min-width: 280px;
        max-width: 420px;
        background: linear-gradient(145deg, rgba(30, 24, 10, 0.95), rgba(14, 10, 4, 0.95));
        border: 1px solid rgba(255, 220, 92, 0.5);
        border-radius: 14px;
        color: #fff;
        z-index: 10002;
        pointer-events: none;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55), 0 0 26px rgba(255, 220, 92, 0.22);
        opacity: 0;
        transition: opacity 0.22s ease, transform 0.28s ease;
        font-family: 'Segoe UI', Arial, sans-serif;
        text-align: center;
      }
      #online-belt-toast.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      #online-belt-toast.is-me {
        border-color: rgba(255, 220, 92, 0.9);
        box-shadow:
          0 14px 40px rgba(0, 0, 0, 0.6),
          0 0 40px rgba(255, 220, 92, 0.55);
      }
      #online-belt-toast .obt-head {
        font-size: 12px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: rgba(255, 220, 92, 0.85);
        margin-bottom: 4px;
        font-weight: 700;
      }
      #online-belt-toast.is-me .obt-head { color: #ffdc5c; }
      #online-belt-toast .obt-body {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }
      #online-belt-toast .obt-icon {
        font-size: 28px;
        line-height: 1;
        filter: drop-shadow(0 0 10px rgba(255, 220, 92, 0.5));
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #online-belt-toast .obt-img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
      }
      #online-belt-toast .obt-text {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.5px;
      }
      #online-belt-toast .obt-value {
        display: block;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 1px;
        color: rgba(255, 255, 255, 0.65);
        margin-top: 3px;
      }
      #online-belt-toast strong { color: #ffdc5c; font-weight: 800; }
      #online-belt-toast.is-me strong { color: #fff; }
    `;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.id = 'online-belt-toast';
  document.body.appendChild(el);
  toastEl = el;
  return el;
}

/** Idempotent. Call once at boot so later show() calls don't block on setup. */
export function initOnlineBeltToast(): void {
  ensureToast();
}

/**
 * Pop the toast for one belt-change event. If a previous toast is still
 * visible the element is reused and the timer is reset — no stacking.
 */
export function showOnlineBeltToast(ev: BeltChangedEvent): void {
  const el = ensureToast();
  const meta = BELT_META[ev.belt];
  if (!meta) return;
  const me = getCachedIdentity();
  const isMe = !!me && me.playerId === ev.playerId;

  const head = isMe
    ? '🏆 You took a belt!'
    : 'Belt changed hands';
  const body = isMe
    ? `You now hold the <strong>${meta.icon} ${escapeHtml(meta.name)}</strong>`
    : `<strong>${escapeHtml(ev.nickname)}</strong> now holds the <strong>${meta.icon} ${escapeHtml(meta.name)}</strong>`;

  el.classList.toggle('is-me', isMe);
  // Prefer AI-generated PNG, fallback to emoji via onerror.
  const iconHtml = `<img class="obt-img" src="${meta.imgPath}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${meta.icon}'}))">`;
  el.innerHTML = `
    <div class="obt-head">${head}</div>
    <div class="obt-body">
      <div class="obt-icon">${iconHtml}</div>
      <div class="obt-text">
        ${body}
        <span class="obt-value">${escapeHtml(meta.format(ev.value))}</span>
      </div>
    </div>
  `;
  // Force a reflow so the class toggle animates reliably if events fire
  // in quick succession.
  void el.offsetWidth;
  el.classList.add('visible');

  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.classList.remove('visible');
    hideTimer = null;
  }, isMe ? 6000 : 4200);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
