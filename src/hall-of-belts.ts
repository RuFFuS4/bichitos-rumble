// ---------------------------------------------------------------------------
// Hall of Belts — full-screen modal listing every achievement
// ---------------------------------------------------------------------------
//
// Phase 4 (light) of BADGES_DESIGN.md. Opens from the character-select
// screen via a dedicated button or the B key, shows all 16 belts in a
// grid — unlocked ones in full colour, locked ones as grey silhouettes
// with the criterion visible so the player knows what to chase.
//
// No gameplay wiring beyond that. The runtime just reads the current
// `stats.unlockedBadges` list every time the modal opens.
//
// When the Phase 5 PNG assets ship, swap the emoji in the .belt-icon
// element for an <img>. Everything else in this file stays.
// ---------------------------------------------------------------------------

import { BADGE_CATALOG, type BadgeDef } from './badges';
import { getStats } from './stats';
import {
  fetchAllLeaderboards,
  getCachedIdentity,
  type LeaderboardEntry,
  type OnlineBeltId,
} from './online-identity';
import { getBeltThumbnail } from './belt-thumbnail';
import { openBeltViewer } from './belt-viewer';

let modalEl: HTMLDivElement | null = null;
/** 'offline' (original 16 badges) or 'online' (5 competitive belts). */
type BeltsTab = 'offline' | 'online';
let currentTab: BeltsTab = 'offline';

// Belt definitions for the online tab — the server is the source of truth
// for who holds what, but the display metadata lives here.
const ONLINE_BELT_META: Array<{
  id: OnlineBeltId;
  name: string;
  icon: string;
  imgPath: string;
  criterion: string;
  /** Format the raw metric into something human-readable. */
  format: (entry: LeaderboardEntry) => string;
}> = [
  { id: 'throne-online',    name: 'Throne Belt',    icon: '👑',
    imgPath: './images/belts/throne-online.png',
    criterion: 'Most online wins',
    format: (e) => `${e.value} wins` },
  { id: 'flash-online',     name: 'Flash Belt',     icon: '⚡',
    imgPath: './images/belts/flash-online.png',
    criterion: 'Fastest online win',
    format: (e) => `${(e.value / 1000).toFixed(1)}s` },
  { id: 'ironclad-online',  name: 'Ironclad Belt',  icon: '🛡️',
    imgPath: './images/belts/ironclad-online.png',
    criterion: 'Best lives-per-match ratio (min 5 matches)',
    format: (e) => `${e.value.toFixed(2)} lives/match (${e.secondaryValue} matches)` },
  { id: 'slayer-online',    name: 'Slayer Belt',    icon: '🗡️',
    imgPath: './images/belts/slayer-online.png',
    criterion: 'Most human kills',
    format: (e) => `${e.value} kills` },
  { id: 'hot-streak-online', name: 'Hot Streak Belt', icon: '🔥',
    imgPath: './images/belts/hot-streak-online.png',
    criterion: 'Longest win streak',
    format: (e) => `${e.value} in a row` },
];

/**
 * One-time DOM setup. Idempotent. Call at boot from main.ts.
 */
export function initHallOfBelts(): void {
  if (modalEl) return;

  modalEl = document.createElement('div');
  modalEl.id = 'belts-modal';
  modalEl.className = 'belts-modal hidden';
  modalEl.setAttribute('aria-hidden', 'true');
  modalEl.innerHTML = `
    <div class="belts-backdrop" data-belts-close="1"></div>
    <div class="belts-panel" role="dialog" aria-label="Hall of Belts">
      <div class="belts-header">
        <h2 class="belts-title">🏆 Hall of Belts</h2>
        <div class="belts-tabs" role="tablist">
          <button class="belts-tab" data-tab="offline" role="tab" aria-selected="true">
            <span class="belts-tab-icon">🏅</span> Offline (16)
          </button>
          <button class="belts-tab" data-tab="online" role="tab" aria-selected="false">
            <span class="belts-tab-icon">🌐</span> Online (5)
          </button>
        </div>
        <div class="belts-progress"></div>
        <button class="belts-close" data-belts-close="1" aria-label="Close">✕</button>
      </div>
      <div class="belts-body">
        <div class="belts-grid" role="list"></div>
      </div>
      <div class="belts-footer">
        <kbd>B</kbd> or <kbd>Esc</kbd> to close · hover a belt for details
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  // Tab switch handlers
  modalEl.querySelectorAll<HTMLButtonElement>('.belts-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn.dataset.tab as BeltsTab) ?? 'offline';
      if (tab === currentTab) return;
      currentTab = tab;
      syncTabSelection();
      rebuildContent();
    });
  });

  // Close on backdrop click, close button, or explicit [data-belts-close]
  modalEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target && target.closest('[data-belts-close]')) {
      closeHallOfBelts();
    }
  });

  // Key handling — scoped globally but only acts while the modal is
  // visible OR we're on character-select (the "open" trigger).
  window.addEventListener('keydown', onKeydown);
}

/**
 * Show the modal + render the grid against the current stats snapshot.
 * Cheap — the grid is rebuilt each open so state is always fresh.
 */
export function openHallOfBelts(): void {
  if (!modalEl) initHallOfBelts();
  if (!modalEl) return;
  syncTabSelection();
  rebuildContent();
  modalEl.classList.remove('hidden');
  modalEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('belts-modal-open');
}

export function closeHallOfBelts(): void {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  modalEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('belts-modal-open');
}

export function isHallOfBeltsOpen(): boolean {
  return !!(modalEl && !modalEl.classList.contains('hidden'));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function syncTabSelection(): void {
  if (!modalEl) return;
  modalEl.querySelectorAll<HTMLButtonElement>('.belts-tab').forEach((btn) => {
    const active = btn.dataset.tab === currentTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

function rebuildContent(): void {
  if (!modalEl) return;
  if (currentTab === 'offline') rebuildOfflineGrid();
  else rebuildOnlineGrid();
}

function rebuildOfflineGrid(): void {
  if (!modalEl) return;
  const stats = getStats();
  const unlocked = new Set(stats.unlockedBadges);

  const grid = modalEl.querySelector('.belts-grid') as HTMLDivElement;
  const progress = modalEl.querySelector('.belts-progress') as HTMLDivElement;

  grid.className = 'belts-grid belts-grid-offline';
  grid.innerHTML = '';
  for (const badge of BADGE_CATALOG) {
    grid.appendChild(renderOfflineSlot(badge, unlocked.has(badge.id)));
  }

  const won = BADGE_CATALOG.filter((b) => unlocked.has(b.id)).length;
  progress.textContent = `${won} / ${BADGE_CATALOG.length} unlocked`;
}

function renderOfflineSlot(badge: BadgeDef, isUnlocked: boolean): HTMLDivElement {
  const slot = document.createElement('div');
  slot.className = `belt-slot ${isUnlocked ? 'unlocked' : 'locked'} belt-${badge.category}`;
  slot.setAttribute('role', 'listitem');
  slot.setAttribute('title', `${badge.name}\n${badge.description}`);
  // 2026-05-01 final block — unlocked slots try to render the 3D
  // belt GLB as a thumbnail. Pipeline: 2D PNG ships first as the
  // immediate fallback (cheap), then `getBeltThumbnail` upgrades
  // the slot to the rendered GLB once it resolves. Locked slots
  // stay padlocked. Click on an unlocked slot opens the belt
  // viewer for a rotating close-up.
  const iconHtml = isUnlocked
    ? `<img class="belt-img" src="${escapeHtml(badge.imgPath)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${badge.icon}'}))">`
    : '🔒';
  slot.innerHTML = `
    <div class="belt-icon">${iconHtml}</div>
    <div class="belt-name">${escapeHtml(badge.name)}</div>
    <div class="belt-desc">${escapeHtml(badge.description)}</div>
  `;
  if (isUnlocked) {
    slot.classList.add('belt-slot-clickable');
    slot.setAttribute('role', 'button');
    slot.setAttribute('tabindex', '0');
    const open = () => openBeltViewer(badge.id, badge.name, badge.description);
    slot.addEventListener('click', open);
    slot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    // Async upgrade to the 3D thumbnail. Cached after first call.
    getBeltThumbnail(badge.id).then((url) => {
      if (!url) return;
      const img = slot.querySelector('img.belt-img') as HTMLImageElement | null;
      if (img) img.src = url;
    }).catch(() => { /* keep PNG fallback */ });
  }
  return slot;
}

// ---------------------------------------------------------------------------
// Online tab — fetches leaderboards from the server and lays them out as
// five columns, one per belt, with the current holder on top and the top-10
// under them. The user's own row is highlighted when present.
// ---------------------------------------------------------------------------

function rebuildOnlineGrid(): void {
  if (!modalEl) return;
  const grid = modalEl.querySelector('.belts-grid') as HTMLDivElement;
  const progress = modalEl.querySelector('.belts-progress') as HTMLDivElement;
  grid.className = 'belts-grid belts-grid-online';
  grid.innerHTML = '<div class="belts-online-loading">Loading leaderboards…</div>';

  const identity = getCachedIdentity();
  progress.textContent = identity
    ? `Playing as ${identity.nickname}`
    : 'No nickname yet — pick one in Online Multiplayer to compete';

  // The response is small (5 belts × 10 rows ≈ a few KB), so a single
  // fetch replaces whatever loading state was rendered.
  fetchAllLeaderboards()
    .then((byBelt) => {
      if (currentTab !== 'online' || !modalEl) return;  // tab might have switched away
      grid.innerHTML = '';
      for (const meta of ONLINE_BELT_META) {
        const entries = byBelt[meta.id] ?? [];
        grid.appendChild(renderOnlineColumn(meta, entries, identity?.playerId ?? null));
      }
    })
    .catch((err) => {
      console.warn('[hall-of-belts] leaderboard fetch failed:', err);
      if (currentTab !== 'online' || !modalEl) return;
      grid.innerHTML = `
        <div class="belts-online-error">
          Could not reach the server. Try again in a moment.
        </div>
      `;
    });
}

function renderOnlineColumn(
  meta: typeof ONLINE_BELT_META[number],
  entries: LeaderboardEntry[],
  myPlayerId: string | null,
): HTMLDivElement {
  const col = document.createElement('div');
  col.className = 'belt-online-col';
  const holder = entries[0];
  const holderText = holder ? `${escapeHtml(holder.nickname)} — ${escapeHtml(meta.format(holder))}` : 'Nobody yet — be the first';

  const rowsHtml = entries.length === 0
    ? '<li class="belt-online-empty">No rankings yet</li>'
    : entries.slice(0, 10).map((e, i) => {
        const isMe = myPlayerId && e.playerId === myPlayerId;
        const cls = `belt-online-row${i === 0 ? ' holder' : ''}${isMe ? ' is-me' : ''}`;
        return `
          <li class="${cls}">
            <span class="belt-online-rank">#${i + 1}</span>
            <span class="belt-online-name">${escapeHtml(e.nickname)}</span>
            <span class="belt-online-value">${escapeHtml(meta.format(e))}</span>
          </li>
        `;
      }).join('');

  const iconHtml = `<img class="belt-img-online" src="${escapeHtml(meta.imgPath)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${meta.icon}'}))">`;
  col.innerHTML = `
    <div class="belt-online-head">
      <div class="belt-online-icon belt-online-icon-clickable" data-bv-belt="${escapeHtml(meta.id)}" tabindex="0" role="button" aria-label="${escapeHtml(meta.name)} preview">${iconHtml}</div>
      <div class="belt-online-meta">
        <div class="belt-online-name-big">${escapeHtml(meta.name)}</div>
        <div class="belt-online-criterion">${escapeHtml(meta.criterion)}</div>
      </div>
    </div>
    <div class="belt-online-holder">
      Current holder: <strong>${holderText}</strong>
    </div>
    <ol class="belt-online-list">${rowsHtml}</ol>
  `;
  // 2026-05-01 final block — upgrade the 2D PNG to a 3D rendered
  // thumbnail + wire click → openBeltViewer for a rotating close-up.
  const iconWrap = col.querySelector('.belt-online-icon-clickable') as HTMLElement | null;
  if (iconWrap) {
    const open = () => openBeltViewer(meta.id, meta.name, meta.criterion);
    iconWrap.addEventListener('click', open);
    iconWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    getBeltThumbnail(meta.id).then((url) => {
      if (!url) return;
      const img = iconWrap.querySelector('img.belt-img-online') as HTMLImageElement | null;
      if (img) img.src = url;
    }).catch(() => { /* keep PNG fallback */ });
  }
  return col;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default:  return c;
    }
  });
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function onKeydown(e: KeyboardEvent): void {
  // Esc closes unconditionally when open
  if (e.key === 'Escape' && isHallOfBeltsOpen()) {
    e.preventDefault();
    closeHallOfBelts();
    return;
  }
  // B toggles only while character-select is visible OR the modal is
  // already open. This avoids hijacking B during a match (online portal
  // shortcut) or the title screen.
  if (e.key.toLowerCase() === 'b') {
    const selectVisible = !document
      .getElementById('character-select')
      ?.classList.contains('hidden');
    if (isHallOfBeltsOpen()) {
      e.preventDefault();
      closeHallOfBelts();
    } else if (selectVisible) {
      e.preventDefault();
      openHallOfBelts();
    }
  }
}
