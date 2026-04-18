// ---------------------------------------------------------------------------
// Lab sidebar — control panel for /tools.html
// ---------------------------------------------------------------------------
//
// Ugly-but-useful fixed panel on the right side of the canvas. Plain DOM,
// no framework. Every control writes DIRECTLY into the existing Game or
// Critter fields. No tool-specific state machine — if a control stops
// working after a game refactor, the failure mode is obvious in the code.
// ---------------------------------------------------------------------------

import type { Game } from '../game';
import { CRITTER_PRESETS } from '../critter';
import { getPlayableNames } from '../roster';
import { deriveAnimationPersonality } from '../critter-animation';
import { clearAllHeldInputs } from '../input';

const NONE = '(none)';

const ANIM_PARAMS = [
  { key: 'idleBobHz',         min: 0.3, max: 2.0, step: 0.01 },
  { key: 'idleBobAmp',        min: 0.0, max: 0.2, step: 0.005 },
  { key: 'runBounceHz',       min: 0.5, max: 5.0, step: 0.05 },
  { key: 'runBounceAmp',      min: 0.0, max: 0.3, step: 0.005 },
  { key: 'leanRadians',       min: 0.0, max: 0.6, step: 0.01 },
  { key: 'runSwayRadians',    min: 0.0, max: 0.2, step: 0.005 },
  { key: 'chargeStretchMult', min: 0.2, max: 2.5, step: 0.05 },
] as const;

type AnimKey = typeof ANIM_PARAMS[number]['key'];

// ---------------------------------------------------------------------------
// Styles — injected once, scoped under body.lab-mode via the #lab-sidebar id
// ---------------------------------------------------------------------------

const CSS = `
#lab-sidebar {
  position: fixed;
  top: 0; right: 0;
  width: 320px;
  max-height: 100vh;
  overflow-y: auto;
  padding: 12px 14px;
  background: rgba(12, 14, 22, 0.88);
  color: #dde1ea;
  font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace;
  border-left: 1px solid rgba(255,255,255,0.08);
  z-index: 10000;
  pointer-events: auto;
  user-select: none;
}
#lab-sidebar h2 {
  font-size: 11px;
  letter-spacing: 0.12em;
  color: #9aa6c4;
  text-transform: uppercase;
  margin: 14px 0 6px;
}
#lab-sidebar h2:first-child { margin-top: 0; }
#lab-sidebar .lab-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}
#lab-sidebar label {
  font-size: 11px;
  color: #b8becf;
  flex-shrink: 0;
}
#lab-sidebar select, #lab-sidebar input[type="text"], #lab-sidebar input[type="number"] {
  background: #1a1e2c;
  color: #fff;
  border: 1px solid #30364a;
  padding: 3px 6px;
  border-radius: 3px;
  font: inherit;
  width: 100%;
  min-width: 0;
}
#lab-sidebar input[type="range"] {
  flex: 1;
  min-width: 0;
  accent-color: #e74c3c;
}
#lab-sidebar .lab-val {
  font-variant-numeric: tabular-nums;
  color: #e8c77d;
  min-width: 46px;
  text-align: right;
  font-size: 11px;
}
#lab-sidebar button {
  background: #242a3d;
  color: #fff;
  border: 1px solid #3a4260;
  padding: 4px 10px;
  border-radius: 3px;
  font: inherit;
  cursor: pointer;
  margin: 2px 0;
}
#lab-sidebar button:hover { background: #2d354d; }
#lab-sidebar button.primary {
  background: #3b2428;
  border-color: #e74c3c;
  color: #ffbbb2;
}
#lab-sidebar button.primary:hover { background: #4f2930; }
#lab-sidebar .lab-btn-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
#lab-sidebar .lab-info {
  background: #14182a;
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 11px;
  color: #c6cbd9;
  white-space: pre-wrap;
  font-variant-numeric: tabular-nums;
}
#lab-sidebar .lab-note {
  font-size: 10px;
  color: #6a7289;
  margin-top: 4px;
}
body.lab-mode #title-screen,
body.lab-mode #character-select,
body.lab-mode #end-screen { display: none !important; }
`;

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export function mountLabSidebar(game: Game): void {
  injectStyles();

  const root = document.createElement('div');
  root.id = 'lab-sidebar';
  document.body.appendChild(root);

  // Sticky-key guard: any interaction with the sidebar drops every held
  // input. A dropdown/slider stealing focus can cause a keyup to miss the
  // window listener, which leaves the critter drifting after release.
  // Covers pointerdown (opening a dropdown / grabbing a slider / button
  // press) and focusin (tab into a control).
  root.addEventListener('pointerdown', () => clearAllHeldInputs());
  root.addEventListener('focusin', () => clearAllHeldInputs());

  // --- state ---
  const names = getPlayableNames(); // 9 playables
  let playerPick = 'Sergei';
  let botPicks: string[] = ['Trunk', 'Kurama', 'Shelly'];
  let lastSeed: number | null = null;

  // --- Matchup section ---
  const matchup = section(root, 'Matchup');
  const playerSel = select(matchup, 'Player', names, playerPick, (v) => { playerPick = v; });
  const bot1Sel = select(matchup, 'Bot 1', [NONE, ...names], botPicks[0] ?? NONE, (v) => { botPicks[0] = v === NONE ? '' : v; });
  const bot2Sel = select(matchup, 'Bot 2', [NONE, ...names], botPicks[1] ?? NONE, (v) => { botPicks[1] = v === NONE ? '' : v; });
  const bot3Sel = select(matchup, 'Bot 3', [NONE, ...names], botPicks[2] ?? NONE, (v) => { botPicks[2] = v === NONE ? '' : v; });
  const matchupBtns = row(matchup);
  button(matchupBtns, 'Start Match', () => startMatch(/*reuseSeed*/ false), 'primary');
  button(matchupBtns, 'Restart Same Seed', () => startMatch(/*reuseSeed*/ true));
  button(matchupBtns, 'Randomize Bots', () => {
    const pool = names.filter(n => n !== playerPick);
    shuffle(pool);
    botPicks = pool.slice(0, 3);
    bot1Sel.value = botPicks[0] ?? NONE;
    bot2Sel.value = botPicks[1] ?? NONE;
    bot3Sel.value = botPicks[2] ?? NONE;
  });
  button(matchupBtns, 'Mirror Match', () => {
    botPicks = [playerPick, playerPick, playerPick];
    bot1Sel.value = bot2Sel.value = bot3Sel.value = playerPick;
  });

  function currentBotNames(): string[] {
    return botPicks.filter(n => n && n !== NONE);
  }
  function startMatch(reuseSeed: boolean): void {
    const opts: { seed?: number } = {};
    if (reuseSeed && lastSeed !== null) opts.seed = lastSeed;
    game.debugStartOfflineMatch(playerPick, currentBotNames(), opts);
    const info = game.debugGetArenaInfo();
    if (info) lastSeed = info.seed;
    refreshInfoPanel();
  }

  // --- Arena section ---
  const arena = section(root, 'Arena');
  const arenaInfoEl = document.createElement('div');
  arenaInfoEl.className = 'lab-info';
  arena.appendChild(arenaInfoEl);
  const seedRow = row(arena);
  const seedLabel = document.createElement('label');
  seedLabel.textContent = 'Seed';
  seedRow.appendChild(seedLabel);
  const seedInput = document.createElement('input');
  seedInput.type = 'number';
  seedInput.style.maxWidth = '140px';
  seedRow.appendChild(seedInput);
  const arenaBtns = row(arena);
  button(arenaBtns, 'Force Seed', () => {
    const raw = seedInput.value.trim();
    if (!raw) return;
    const seed = parseInt(raw, 10) | 0;
    lastSeed = seed;
    game.debugForceArenaSeed(seed);
    refreshInfoPanel();
  });
  button(arenaBtns, 'Replay Last', () => {
    if (lastSeed === null) return;
    game.debugStartOfflineMatch(playerPick, currentBotNames(), { seed: lastSeed });
    refreshInfoPanel();
  });
  button(arenaBtns, 'Copy Seed', () => {
    const info = game.debugGetArenaInfo();
    if (info) navigator.clipboard.writeText(String(info.seed)).catch(() => {});
  });

  // --- Animation tuner ---
  const anim = section(root, 'Animation (player)');
  const sliders = new Map<AnimKey, HTMLInputElement>();
  const valueLabels = new Map<AnimKey, HTMLSpanElement>();
  for (const p of ANIM_PARAMS) {
    const rowEl = row(anim);
    const l = document.createElement('label');
    l.textContent = p.key;
    l.style.minWidth = '110px';
    rowEl.appendChild(l);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(p.min);
    slider.max = String(p.max);
    slider.step = String(p.step);
    const val = document.createElement('span');
    val.className = 'lab-val';
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(3);
      const player = game.player;
      if (player?.animPersonality) {
        player.animPersonality[p.key] = v;
      }
    });
    rowEl.appendChild(slider);
    rowEl.appendChild(val);
    sliders.set(p.key, slider);
    valueLabels.set(p.key, val);
  }
  const animBtns = row(anim);
  button(animBtns, 'Reset Derived', () => {
    const player = game.player;
    if (!player) return;
    const derived = deriveAnimationPersonality(player.config);
    player.animPersonality = derived;
    syncSlidersFromPlayer();
  });
  button(animBtns, 'Copy Values', () => {
    const player = game.player;
    if (!player) return;
    navigator.clipboard
      .writeText(JSON.stringify(player.animPersonality, null, 2))
      .catch(() => {});
  });

  // --- Playback / quick actions ---
  const actions = section(root, 'Playback');
  const speedRow = row(actions);
  const speedLabel = document.createElement('label');
  speedLabel.textContent = 'speedScale';
  speedLabel.style.minWidth = '90px';
  speedRow.appendChild(speedLabel);
  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.min = '0';
  speedSlider.max = '2';
  speedSlider.step = '0.05';
  speedSlider.value = '1';
  const speedVal = document.createElement('span');
  speedVal.className = 'lab-val';
  speedVal.textContent = '1.00';
  speedSlider.addEventListener('input', () => {
    const v = parseFloat(speedSlider.value);
    game.debugSpeedScale = v;
    speedVal.textContent = v.toFixed(2);
  });
  speedRow.appendChild(speedSlider);
  speedRow.appendChild(speedVal);

  const actionBtns = row(actions);
  button(actionBtns, 'Pause', () => {
    game.debugSpeedScale = game.debugSpeedScale === 0 ? 1 : 0;
    speedSlider.value = String(game.debugSpeedScale);
    speedVal.textContent = game.debugSpeedScale.toFixed(2);
  });
  button(actionBtns, 'Slow 0.3×', () => {
    game.debugSpeedScale = 0.3;
    speedSlider.value = '0.3';
    speedVal.textContent = '0.30';
  });
  button(actionBtns, 'Normal 1×', () => {
    game.debugSpeedScale = 1;
    speedSlider.value = '1';
    speedVal.textContent = '1.00';
  });
  button(actionBtns, 'End Match', () => game.debugEndMatchImmediately());

  // --- Info panel ---
  const info = section(root, 'Player info');
  const infoEl = document.createElement('div');
  infoEl.className = 'lab-info';
  info.appendChild(infoEl);

  const note = document.createElement('div');
  note.className = 'lab-note';
  note.textContent = '/tools.html · internal · unlinked from production UI';
  root.appendChild(note);

  // --- Polling loop for live panels ---
  function refreshInfoPanel(): void {
    const p = game.player;
    if (!p) { infoEl.textContent = 'no player'; return; }
    const cfg = p.config;
    const ap = p.animPersonality;
    const kitTypes = p.abilityStates.map(s => s.def.type).join(' + ');
    infoEl.textContent = [
      `name     ${cfg.name}`,
      `role     ${cfg.role}`,
      `speed    ${cfg.speed}`,
      `mass     ${cfg.mass}`,
      `HB force ${cfg.headbuttForce}`,
      `kit      ${kitTypes || '(none)'}`,
      `lives    ${p.lives}`,
      `alive    ${p.alive}`,
      `falling  ${p.falling}`,
      '',
      `animPersonality`,
      ...Object.entries(ap).map(([k, v]) => `  ${k.padEnd(20)} ${(+v).toFixed(3)}`),
    ].join('\n');

    syncSlidersFromPlayer();
  }

  function refreshArenaPanel(): void {
    const info = game.debugGetArenaInfo();
    if (!info) {
      arenaInfoEl.textContent = '(no arena — start a match)';
      return;
    }
    const batchDesc = info.batches
      .map((b, i) => {
        const bandStr = b.band === -1 ? 'mix' : `b${b.band}`;
        return `  ${i}: ${bandStr.padEnd(4)} ${String(b.size).padStart(2)}× delay=${b.delay.toFixed(1)}s`;
      })
      .join('\n');
    arenaInfoEl.textContent = [
      `pattern      ${info.patternLabel}`,
      `seed         ${info.seed}`,
      `batches (${info.batches.length})`,
      batchDesc,
      `level        ${info.collapseLevel}/${info.batches.length}`,
      `warning      ${info.warningBatch < 0 ? '-' : info.warningBatch}`,
      `radius       ${info.currentRadius.toFixed(2)}`,
    ].join('\n');
    if (seedInput.value === '' && lastSeed === null) {
      lastSeed = info.seed;
      seedInput.value = String(info.seed);
    }
  }

  function syncSlidersFromPlayer(): void {
    const player = game.player;
    if (!player?.animPersonality) return;
    for (const p of ANIM_PARAMS) {
      const slider = sliders.get(p.key)!;
      const v = player.animPersonality[p.key];
      slider.value = String(v);
      valueLabels.get(p.key)!.textContent = (+v).toFixed(3);
    }
  }

  // Live refresh at 4 Hz — cheap enough, infrequent updates.
  setInterval(() => {
    refreshArenaPanel();
    refreshInfoPanel();
  }, 250);
  // First paint
  setTimeout(() => {
    refreshArenaPanel();
    refreshInfoPanel();
    const info = game.debugGetArenaInfo();
    if (info) {
      lastSeed = info.seed;
      seedInput.value = String(info.seed);
    }
  }, 100);

  // Stash on window for manual tweaking from the console
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as unknown as { __lab: object }).__lab = {
    game,
    startMatch,
    setSpeed: (v: number) => { game.debugSpeedScale = v; speedSlider.value = String(v); speedVal.textContent = v.toFixed(2); },
  };

  // Keep player dropdown reactive
  playerSel.addEventListener('change', () => {
    // If player changed, sync sliders to the new critter's derived values
    // only if they're not in a match yet. Active matches keep current tuning.
  });
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function injectStyles(): void {
  const id = 'lab-sidebar-css';
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = CSS;
  document.head.appendChild(el);
}

function section(parent: HTMLElement, title: string): HTMLDivElement {
  const wrap = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = title;
  wrap.appendChild(h);
  parent.appendChild(wrap);
  return wrap;
}

function row(parent: HTMLElement): HTMLDivElement {
  const r = document.createElement('div');
  r.className = 'lab-row';
  parent.appendChild(r);
  return r;
}

function select(
  parent: HTMLElement,
  labelText: string,
  options: string[],
  initial: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const rowEl = row(parent);
  const l = document.createElement('label');
  l.textContent = labelText;
  l.style.minWidth = '48px';
  rowEl.appendChild(l);
  const sel = document.createElement('select');
  for (const o of options) {
    const op = document.createElement('option');
    op.value = o;
    op.textContent = o;
    sel.appendChild(op);
  }
  sel.value = initial;
  sel.addEventListener('change', () => onChange(sel.value));
  rowEl.appendChild(sel);
  return sel;
}

function button(
  parent: HTMLElement,
  text: string,
  onClick: () => void,
  variant: 'default' | 'primary' = 'default',
): HTMLButtonElement {
  if (!parent.classList.contains('lab-btn-row')) {
    // If parent isn't already a button row, wrap this button in one
    const r = document.createElement('div');
    r.className = 'lab-btn-row';
    parent.appendChild(r);
    parent = r;
  }
  const b = document.createElement('button');
  b.textContent = text;
  if (variant === 'primary') b.className = 'primary';
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
