import type { AbilityState } from './abilities';
import type { Critter, CritterConfig } from './critter';

const aliveEl = document.getElementById('hud-alive')!;
const timerEl = document.getElementById('hud-timer')!;
const livesContainer = document.getElementById('hud-lives')!;
const overlayEl = document.getElementById('overlay')!;
const abilityContainer = document.getElementById('ability-bar-container')!;
const hudRoot = document.getElementById('hud')!;
const titleScreen = document.getElementById('title-screen')!;
const characterSelect = document.getElementById('character-select')!;
const critterCards = document.getElementById('critter-cards')!;
const endScreen = document.getElementById('end-screen')!;
const endResultEl = document.getElementById('end-result')!;
const endSubtitleEl = document.getElementById('end-subtitle')!;

export function updateHUD(aliveCount: number, timeLeft: number): void {
  aliveEl.textContent = `Alive: ${aliveCount}`;
  const mins = Math.floor(timeLeft / 60);
  const secs = Math.floor(timeLeft % 60);
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Lives HUD — shows all critters' lives with colored indicators
// ---------------------------------------------------------------------------

let liveEls: { root: HTMLElement; hearts: HTMLElement }[] = [];

/** Build lives display for all critters. Call once at init and on restart. */
export function initAllLivesHUD(critters: Critter[]): void {
  livesContainer.innerHTML = '';
  liveEls = [];

  for (const c of critters) {
    const row = document.createElement('div');
    row.className = 'lives-row';

    const dot = document.createElement('span');
    dot.className = 'lives-dot';
    dot.style.background = '#' + c.config.color.toString(16).padStart(6, '0');

    const hearts = document.createElement('span');
    hearts.className = 'lives-hearts';
    hearts.textContent = '\u2764'.repeat(c.lives);

    row.appendChild(dot);
    row.appendChild(hearts);
    livesContainer.appendChild(row);

    liveEls.push({ root: row, hearts });
  }
}

/** Update lives display each frame. */
export function updateAllLivesHUD(critters: Critter[]): void {
  for (let i = 0; i < critters.length && i < liveEls.length; i++) {
    const c = critters[i];
    const el = liveEls[i];
    if (!c.alive) {
      el.hearts.textContent = '\u2716'; // ✖
      el.root.style.opacity = '0.35';
    } else {
      el.hearts.textContent = '\u2764'.repeat(c.lives);
      el.root.style.opacity = '1';
    }
  }
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export function showOverlay(main: string, sub?: string): void {
  overlayEl.style.display = 'block';
  overlayEl.innerHTML = main + (sub ? `<div class="sub">${sub}</div>` : '');
}

export function hideOverlay(): void {
  overlayEl.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Ability cooldown HUD
// ---------------------------------------------------------------------------

let slotEls: { root: HTMLElement; fill: HTMLElement }[] = [];

export function initAbilityHUD(states: AbilityState[]): void {
  abilityContainer.innerHTML = '';
  slotEls = [];

  for (const s of states) {
    const slot = document.createElement('div');
    slot.className = 'ability-slot';

    const keyLabel = document.createElement('div');
    keyLabel.className = 'ability-key';
    keyLabel.textContent = `[${s.def.key}]`;

    const nameLabel = document.createElement('div');
    nameLabel.className = 'ability-name';
    nameLabel.textContent = s.def.name;

    const fillBg = document.createElement('div');
    fillBg.className = 'ability-fill-bg';

    const fill = document.createElement('div');
    fill.className = 'ability-fill';
    fill.style.width = '100%';
    fillBg.appendChild(fill);

    slot.appendChild(keyLabel);
    slot.appendChild(nameLabel);
    slot.appendChild(fillBg);
    abilityContainer.appendChild(slot);

    slotEls.push({ root: slot, fill });
  }
}

export function updateAbilityHUD(states: AbilityState[]): void {
  for (let i = 0; i < states.length && i < slotEls.length; i++) {
    const s = states[i];
    const el = slotEls[i];

    if (s.active) {
      el.root.className = 'ability-slot active';
      el.fill.style.width = '100%';
    } else if (s.cooldownLeft > 0) {
      el.root.className = 'ability-slot on-cooldown';
      const pct = ((s.def.cooldown - s.cooldownLeft) / s.def.cooldown) * 100;
      el.fill.style.width = `${pct}%`;
    } else {
      el.root.className = 'ability-slot';
      el.fill.style.width = '100%';
    }
  }
}

// ---------------------------------------------------------------------------
// Full-screen menus (title / character select / end)
// ---------------------------------------------------------------------------

/** Show/hide the main in-match HUD (top bar + ability bar + overlay). */
function setMatchHudVisible(visible: boolean): void {
  hudRoot.style.display = visible ? 'block' : 'none';
}

export function showTitleScreen(): void {
  setMatchHudVisible(false);
  titleScreen.classList.remove('hidden');
}

export function hideTitleScreen(): void {
  titleScreen.classList.add('hidden');
}

export function showCharacterSelect(presets: CritterConfig[], selectedIdx: number): void {
  setMatchHudVisible(false);
  // Build cards once per show
  critterCards.innerHTML = '';
  for (let i = 0; i < presets.length; i++) {
    const c = presets[i];
    const card = document.createElement('div');
    card.className = 'critter-card' + (i === selectedIdx ? ' selected' : '');
    card.dataset.idx = String(i);

    const preview = document.createElement('div');
    preview.className = 'critter-preview';
    preview.style.background = '#' + c.color.toString(16).padStart(6, '0');

    const name = document.createElement('div');
    name.className = 'critter-name';
    name.textContent = c.name;

    const role = document.createElement('div');
    role.className = 'critter-role';
    role.textContent = c.role;

    const tagline = document.createElement('div');
    tagline.className = 'critter-tagline';
    tagline.textContent = c.tagline;

    const stats = document.createElement('div');
    stats.className = 'critter-stats';
    stats.textContent = `SPD ${c.speed} · MAS ${c.mass.toFixed(2)} · HIT ${c.headbuttForce}`;

    card.appendChild(preview);
    card.appendChild(name);
    card.appendChild(role);
    card.appendChild(tagline);
    card.appendChild(stats);
    critterCards.appendChild(card);
  }
  characterSelect.classList.remove('hidden');
}

/** Update the selected card highlight without rebuilding everything. */
export function updateCharacterSelect(selectedIdx: number): void {
  const cards = critterCards.querySelectorAll('.critter-card');
  cards.forEach((card, i) => {
    card.classList.toggle('selected', i === selectedIdx);
  });
}

export function hideCharacterSelect(): void {
  characterSelect.classList.add('hidden');
}

export type EndResult = 'win' | 'lose' | 'draw';

export function showEndScreen(result: EndResult, title: string, subtitle: string): void {
  endResultEl.textContent = title;
  endResultEl.className = 'end-result ' + result;
  endSubtitleEl.textContent = subtitle;
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
