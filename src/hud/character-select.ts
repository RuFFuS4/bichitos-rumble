// ---------------------------------------------------------------------------
// Character select — grid + info pane (name / role / tagline / stat bars /
// ability preview)
// ---------------------------------------------------------------------------

import { createAbilityStates } from '../abilities';
import type { CritterConfig } from '../critter';
import type { RosterEntry } from '../roster';
import { getCritterThumbnail } from '../slot-thumbnail';
import { setMatchHudVisible } from './dom-shared';

const characterSelect = document.getElementById('character-select')!;
const critterGrid    = document.getElementById('critter-grid')!;
const infoName       = document.getElementById('critter-info-name')!;
const infoRole       = document.getElementById('critter-info-role')!;
const infoTagline    = document.getElementById('critter-info-tagline')!;
const infoStats      = document.getElementById('critter-info-stats')!;
const infoAbilities  = document.getElementById('critter-info-abilities')!;

// ---- Click handler wiring ------------------------------------------------

/** Callback registered by the game layer — invoked when a slot is clicked/tapped. */
let slotClickHandler: ((idx: number) => void) | null = null;
export function setSlotClickHandler(handler: (idx: number) => void): void {
  slotClickHandler = handler;
}

// ---- Cached roster + presets for repaint calls --------------------------

let cachedRoster: RosterEntry[] = [];
let cachedPresets: CritterConfig[] = [];

// ---- Thumbnail avatar ---------------------------------------------------

/**
 * Build the slot avatar: a coloured placeholder circle that gets swapped
 * for a real 3D thumbnail once the GLB thumbnail module has rendered it.
 * If the critter has no GLB (internal placeholders), the placeholder
 * stays as a solid colour.
 */
function buildSlotAvatar(entry: RosterEntry): HTMLDivElement {
  const avatar = document.createElement('div');
  avatar.className = 'slot-avatar';
  // Placeholder colour while the thumbnail is rendering. Also the final
  // appearance if the critter has no GLB (procedural bots don't reach
  // this code path, so this is mostly dead-safe).
  avatar.style.background = '#' + entry.baseColor.toString(16).padStart(6, '0');

  getCritterThumbnail(entry).then((url) => {
    if (!url) return;
    avatar.style.backgroundImage = `url(${url})`;
    avatar.style.backgroundSize = 'contain';
    avatar.style.backgroundRepeat = 'no-repeat';
    avatar.style.backgroundPosition = 'center';
    avatar.style.backgroundColor = 'transparent';
  });

  return avatar;
}

// ---- Public API ---------------------------------------------------------

/**
 * Build the character select grid. Roster entries control layout and status;
 * presets provide gameplay stats for the info pane (only playable characters).
 */
export function showCharacterSelect(
  roster: RosterEntry[],
  presets: CritterConfig[],
  selectedIdx: number,
): void {
  setMatchHudVisible(false);
  critterGrid.innerHTML = '';
  cachedRoster = roster;
  cachedPresets = presets;

  for (let i = 0; i < roster.length; i++) {
    const entry = roster[i];
    const slot = document.createElement('div');
    slot.dataset.idx = String(i);
    // Per-critter glow colour — picked up by the slot CSS (glow bg +
    // hover + selected ring). Gives each slot its own visual identity
    // without needing a per-critter style sheet.
    const hex = '#' + entry.baseColor.toString(16).padStart(6, '0');
    slot.style.setProperty('--slot-glow', hex);

    if (entry.status === 'playable') {
      slot.className = 'critter-slot' + (i === selectedIdx ? ' selected' : '');
      slot.appendChild(buildSlotAvatar(entry));

      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = entry.displayName;
      slot.appendChild(name);

      const capturedIdx = i;
      slot.addEventListener('click', () => {
        slotClickHandler?.(capturedIdx);
      });
    } else if (entry.status === 'wip') {
      slot.className = 'critter-slot wip' + (i === selectedIdx ? ' selected' : '');
      const avatar = buildSlotAvatar(entry);
      avatar.style.opacity = '0.5';
      slot.appendChild(avatar);

      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = entry.displayName;
      slot.appendChild(name);

      const badge = document.createElement('div');
      badge.className = 'slot-badge';
      badge.textContent = 'WIP';
      slot.appendChild(badge);

      const capturedIdx = i;
      slot.addEventListener('click', () => {
        slotClickHandler?.(capturedIdx);
      });
    } else {
      // locked
      slot.className = 'critter-slot locked';

      const lock = document.createElement('div');
      lock.className = 'slot-lock';
      lock.textContent = '🔒';

      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = 'Coming Soon';

      slot.appendChild(lock);
      slot.appendChild(name);
    }

    critterGrid.appendChild(slot);
  }

  paintInfoPane(roster, presets, selectedIdx);
  characterSelect.classList.remove('hidden');
}

/** Update the selected slot highlight and refresh the info pane. Cheap call per navigation. */
export function updateCharacterSelect(selectedIdx: number): void {
  const slots = critterGrid.querySelectorAll('.critter-slot');
  slots.forEach((slot, i) => {
    const entry = cachedRoster[i];
    if (entry && entry.status !== 'locked') {
      slot.classList.toggle('selected', i === selectedIdx);
    }
  });
  paintInfoPane(cachedRoster, cachedPresets, selectedIdx);
}

export function hideCharacterSelect(): void {
  characterSelect.classList.add('hidden');
}

// ---- Info pane: name, role, tagline, animated stat bars -----------------

/** Relative normalization: bars fill based on min/max across the current preset pool. */
function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function paintInfoPane(roster: RosterEntry[], presets: CritterConfig[], idx: number): void {
  const entry = roster[idx];
  if (!entry) return;

  // Name / role / tagline always come from the roster entry
  infoName.textContent = entry.displayName;
  infoRole.textContent = entry.role;
  infoTagline.textContent = entry.status === 'wip'
    ? entry.tagline + ' (coming soon)'
    : entry.tagline;

  infoStats.innerHTML = '';
  infoAbilities.innerHTML = '';

  // Stat bars only if this character has a gameplay config
  const config = presets.find(p => p.name === entry.displayName);
  if (config) {
    const speedMin = Math.min(...presets.map(p => p.speed));
    const speedMax = Math.max(...presets.map(p => p.speed));
    const massMin = Math.min(...presets.map(p => p.mass));
    const massMax = Math.max(...presets.map(p => p.mass));
    const powerMin = Math.min(...presets.map(p => p.headbuttForce));
    const powerMax = Math.max(...presets.map(p => p.headbuttForce));

    const MIN_FILL = 0.18;
    const rel = (v: number, min: number, max: number) =>
      MIN_FILL + normalize(v, min, max) * (1 - MIN_FILL);

    const stats: { label: string; pct: number }[] = [
      { label: 'Speed',  pct: rel(config.speed, speedMin, speedMax) * 100 },
      { label: 'Weight', pct: rel(config.mass, massMin, massMax) * 100 },
      { label: 'Power',  pct: rel(config.headbuttForce, powerMin, powerMax) * 100 },
    ];

    for (const s of stats) {
      const row = document.createElement('div');
      row.className = 'stat-row';

      const label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = s.label;

      const bg = document.createElement('div');
      bg.className = 'stat-bar-bg';

      const fill = document.createElement('div');
      fill.className = 'stat-bar';
      fill.style.width = '0%';
      bg.appendChild(fill);

      row.appendChild(label);
      row.appendChild(bg);
      infoStats.appendChild(row);

      requestAnimationFrame(() => {
        fill.style.width = s.pct.toFixed(1) + '%';
      });
    }
  }

  // --- Ability list ---
  // Source 1: real abilities from gameplay config (playable characters)
  if (config) {
    const states = createAbilityStates(config.name);
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      appendAbilityRow(entry.id, i, s.def.key, s.def.name, s.def.description, false);
    }
  }
  // Source 2: planned abilities from roster (WIP characters)
  else if (entry.plannedAbilities) {
    for (let i = 0; i < entry.plannedAbilities.length; i++) {
      const a = entry.plannedAbilities[i];
      appendAbilityRow(entry.id, i, a.key, a.name, a.description, true);
    }
  }
}

const ABILITY_SLOT_SUFFIX = ['j', 'k', 'l'];

function appendAbilityRow(critterSlug: string, slotIdx: number, key: string, name: string, desc: string, planned: boolean): void {
  const row = document.createElement('div');
  row.className = 'ability-info-row';

  // Ability icon (AI-generated sprite sheet). Hidden by CSS until
  // body.has-ability-sprites is set by the preload in main.ts — if the
  // sheet never loads, the row still reads fine with just key + name.
  const slotSuffix = ABILITY_SLOT_SUFFIX[slotIdx] ?? 'j';
  const icon = document.createElement('span');
  icon.className = `sprite-ability sprite-ability-${critterSlug}-${slotSuffix} ability-info-icon`;
  row.appendChild(icon);

  // Key label without brackets — the CSS styles it as a chip (gold
  // outlined pill) so the '[ ]' wrappers would read as double framing.
  const keyEl = document.createElement('span');
  keyEl.className = 'ability-info-key';
  keyEl.textContent = key;

  const nameEl = document.createElement('span');
  nameEl.className = 'ability-info-name';
  nameEl.textContent = name;

  const descEl = document.createElement('span');
  descEl.className = 'ability-info-desc';
  descEl.textContent = '— ' + desc;

  row.appendChild(keyEl);
  row.appendChild(nameEl);
  row.appendChild(descEl);

  if (planned) {
    const badge = document.createElement('span');
    badge.className = 'ability-info-planned';
    badge.textContent = '(planned)';
    row.appendChild(badge);
  }

  infoAbilities.appendChild(row);
}
