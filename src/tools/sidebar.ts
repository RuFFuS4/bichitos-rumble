// ---------------------------------------------------------------------------
// Lab sidebar — control panel for /tools.html
// ---------------------------------------------------------------------------
//
// Ugly-but-useful fixed panel on the right side of the canvas. Plain DOM,
// no framework. Every control goes through DevApi (src/tools/dev-api.ts) so
// the game engine never gets poked from UI code directly. If a panel stops
// working after a refactor, the failure lives in DevApi, not here.
//
// Layout — panels bucketed in 4 thematic groups, each collapsible:
//
//   [MATCH SETUP]    Matchup · Arena
//   [LIVE CONTROL]   Bots · Gameplay · Playback
//   [OBSERVE]        Recording · Performance · Input · Player info
//   [TUNING]         Animation
//
// Sections collapse on header click. Default states are chosen so the
// first-paint screen fits the "start a match and watch it" flow — setup
// collapsed, core live panels expanded, heavy/verbose panels collapsed.
// ---------------------------------------------------------------------------

import { getPlayableNames } from '../roster';
import { deriveAnimationPersonality } from '../critter-animation';
import { clearAllHeldInputs } from '../input';
import type { DevApi, BotBehaviourTag, GameplayEvent } from './dev-api';

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

const BOT_BEHAVIOURS: BotBehaviourTag[] = [
  'normal', 'idle', 'passive', 'aggressive', 'chase', 'ability_only',
];

const TELEPORT_PRESETS = ['center', 'corners', 'line', 'bunch'] as const;

type GroupKind = 'setup' | 'control' | 'observe' | 'tuning';

// ---------------------------------------------------------------------------
// Styles — injected once, scoped under body.lab-mode via the #lab-sidebar id
// ---------------------------------------------------------------------------

const CSS = `
#lab-sidebar {
  position: fixed;
  top: 0; right: 0;
  width: 340px;
  max-height: 100vh;
  overflow-y: auto;
  padding: 12px 14px;
  background: rgba(12, 14, 22, 0.9);
  color: #dde1ea;
  font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace;
  border-left: 1px solid rgba(255,255,255,0.08);
  z-index: 10000;
  pointer-events: auto;
  user-select: none;
}
#lab-sidebar .lab-banner {
  background: linear-gradient(90deg, #3b0f14, #1a0a10);
  border: 1px solid #e74c3c;
  color: #ffbbb2;
  padding: 6px 10px;
  border-radius: 3px;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-align: center;
  margin-bottom: 12px;
}

/* --- Thematic group bars + matching section border --- */
#lab-sidebar .lab-group-wrap {
  margin: 0 -14px;
  padding: 0 14px 6px;
}
#lab-sidebar .lab-group {
  margin: 12px -14px 8px;
  padding: 5px 14px;
  font-size: 9px;
  letter-spacing: 0.3em;
  font-weight: bold;
  text-transform: uppercase;
  border-top: 1px solid rgba(255,255,255,0.08);
}
#lab-sidebar .lab-group-wrap:first-of-type .lab-group { margin-top: 4px; }
#lab-sidebar .lab-group.setup {
  color: #a8c7ff;
  background: linear-gradient(90deg, rgba(95,163,255,0.14), transparent 70%);
  border-top-color: rgba(95,163,255,0.45);
}
#lab-sidebar .lab-group.control {
  color: #ffb8b0;
  background: linear-gradient(90deg, rgba(231,76,60,0.14), transparent 70%);
  border-top-color: rgba(231,76,60,0.45);
}
#lab-sidebar .lab-group.observe {
  color: #a8e6a0;
  background: linear-gradient(90deg, rgba(74,222,128,0.14), transparent 70%);
  border-top-color: rgba(74,222,128,0.45);
}
#lab-sidebar .lab-group.tuning {
  color: #ffe390;
  background: linear-gradient(90deg, rgba(255,220,92,0.14), transparent 70%);
  border-top-color: rgba(255,220,92,0.45);
}
#lab-sidebar .lab-group-setup   .lab-section { border-left-color: rgba(95,163,255,0.30); }
#lab-sidebar .lab-group-control .lab-section { border-left-color: rgba(231,76,60,0.30); }
#lab-sidebar .lab-group-observe .lab-section { border-left-color: rgba(74,222,128,0.30); }
#lab-sidebar .lab-group-tuning  .lab-section { border-left-color: rgba(255,220,92,0.30); }

/* --- Collapsible sections --- */
#lab-sidebar .lab-section {
  margin-bottom: 6px;
  border-left: 2px solid rgba(255,255,255,0.08);
  padding-left: 8px;
  background: rgba(255,255,255,0.012);
  border-radius: 0 3px 3px 0;
}
#lab-sidebar .lab-section-header {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 3px 0;
}
#lab-sidebar .lab-section-header:hover h2 { color: #dde1ea; }
#lab-sidebar .lab-section-header:hover .lab-section-caret { color: #fff; }
#lab-sidebar .lab-section-caret {
  color: #6a7289;
  font-size: 9px;
  width: 10px;
  flex-shrink: 0;
  transition: color 0.15s;
}
#lab-sidebar .lab-section-header h2 {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: #9aa6c4;
  text-transform: uppercase;
  transition: color 0.15s;
}
#lab-sidebar .lab-section-content { padding: 4px 0 6px; }
#lab-sidebar .lab-section.collapsed .lab-section-content { display: none; }

/* --- Shared controls --- */
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

/* --- Info / event log / specialized widgets --- */
#lab-sidebar .lab-info {
  background: #14182a;
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 11px;
  color: #c6cbd9;
  white-space: pre-wrap;
  font-variant-numeric: tabular-nums;
}
#lab-sidebar .lab-event-log {
  background: #10131f;
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 10px;
  color: #9ea4b8;
  max-height: 160px;
  overflow-y: auto;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}
#lab-sidebar .lab-event-log .evt {
  display: grid;
  grid-template-columns: 40px 78px 1fr;
  gap: 4px;
}
#lab-sidebar .lab-event-log .evt-t       { color: #5c6177; }
#lab-sidebar .lab-event-log .evt-type    { color: #7fc8ff; text-transform: uppercase; font-size: 9px; }
#lab-sidebar .lab-event-log .evt-actor   { color: #e8c77d; }
#lab-sidebar .lab-event-log .evt-details { color: #9aa6c4; }
#lab-sidebar .evt-headbutt   .evt-type { color: #ff9a5c; }
#lab-sidebar .evt-fall       .evt-type { color: #e74c3c; }
#lab-sidebar .evt-eliminate  .evt-type { color: #ff5577; }
#lab-sidebar .evt-respawn    .evt-type { color: #4ade80; }
#lab-sidebar .evt-ability_cast .evt-type { color: #b48bff; }
#lab-sidebar .evt-ability_end  .evt-type { color: #7a6da6; }
#lab-sidebar .evt-collapse_warn .evt-type { color: #ffcc00; }
#lab-sidebar .evt-collapse_batch .evt-type { color: #ff8844; }
#lab-sidebar .evt-match_started .evt-type { color: #4ade80; }
#lab-sidebar .evt-match_ended  .evt-type { color: #9aa6c4; }

#lab-sidebar .lab-bot-row {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
  font-size: 11px;
}
#lab-sidebar .lab-bot-row .bot-name { color: #e8c77d; }
#lab-sidebar .lab-bot-row.dead .bot-name { color: #5c6177; text-decoration: line-through; }
#lab-sidebar .lab-bot-row .bot-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #4ade80;
}
#lab-sidebar .lab-bot-row.dead .bot-dot { background: #5c6177; }

#lab-sidebar .lab-cd-row {
  display: grid;
  grid-template-columns: 30px 1fr 70px;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  margin-bottom: 3px;
}
#lab-sidebar .lab-cd-row .cd-slot { color: #9aa6c4; }
#lab-sidebar .lab-cd-row .cd-name { color: #dde1ea; }
#lab-sidebar .lab-cd-row .cd-bar-bg {
  height: 6px; background: #1a1e2c; border-radius: 3px; overflow: hidden;
  grid-column: 2 / span 2;
}
#lab-sidebar .lab-cd-row .cd-bar {
  height: 100%; background: #4ade80; border-radius: 3px;
  transition: width 0.1s linear;
}
#lab-sidebar .lab-cd-row.on-cd .cd-bar    { background: #ff8844; }
#lab-sidebar .lab-cd-row.active  .cd-bar  { background: #e74c3c; }
#lab-sidebar .lab-cd-row .cd-val {
  color: #b8becf; font-variant-numeric: tabular-nums; text-align: right; font-size: 10px;
}

#lab-sidebar .lab-perf-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 8px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  background: #14182a;
  padding: 6px 8px;
  border-radius: 3px;
}
#lab-sidebar .lab-perf-grid .pk { color: #9aa6c4; }
#lab-sidebar .lab-perf-grid .pv { color: #e8c77d; text-align: right; }

#lab-sidebar .lab-input-box {
  background: #14182a;
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 11px;
}
#lab-sidebar .lab-input-box .key {
  display: inline-block;
  background: #1a1e2c;
  border: 1px solid #30364a;
  padding: 1px 6px;
  border-radius: 3px;
  margin: 2px 2px 0 0;
  color: #dde1ea;
  font-size: 10px;
}
#lab-sidebar .lab-input-box .action {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  margin: 2px 2px 0 0;
  font-size: 10px;
  background: #1a1e2c;
  color: #5c6177;
  border: 1px solid #30364a;
}
#lab-sidebar .lab-input-box .action.on {
  color: #000;
  background: #ffdc5c;
  border-color: #ffdc5c;
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

export function mountLabSidebar(devApi: DevApi): void {
  injectStyles();

  const root = document.createElement('div');
  root.id = 'lab-sidebar';
  document.body.appendChild(root);

  // Sticky-key guard: any interaction with the sidebar drops every held
  // input. A dropdown/slider stealing focus can cause a keyup to miss the
  // window listener, which leaves the critter drifting after release.
  root.addEventListener('pointerdown', () => clearAllHeldInputs());
  root.addEventListener('focusin', () => clearAllHeldInputs());

  // ---- INTERNAL banner --------------------------------------------------
  const banner = document.createElement('div');
  banner.className = 'lab-banner';
  banner.textContent = 'INTERNAL DEV TOOL · not for players';
  root.appendChild(banner);

  // ---- Shared state -----------------------------------------------------
  const names = getPlayableNames(); // 9 playables
  let playerPick = 'Sergei';
  let botPicks: string[] = ['Trunk', 'Kurama', 'Shelly'];
  let lastSeed: number | null = null;

  // =======================================================================
  // GROUP: MATCH SETUP ----------------------------------------------------
  // =======================================================================
  const setupGroup = group(root, 'Match setup', 'setup');

  // ---- Matchup (collapsed by default — only needed at the start) --------
  const matchup = section(setupGroup, 'Matchup', { collapsed: true });
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
    devApi.startMatch(playerPick, currentBotNames(), opts);
    const info = devApi.getArenaInfo();
    if (info) lastSeed = info.seed;
    refreshAll();
  }

  // ---- Arena (collapsed by default) -------------------------------------
  const arena = section(setupGroup, 'Arena', { collapsed: true });
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
    devApi.forceSeed(seed);
    refreshArenaPanel();
  });
  button(arenaBtns, 'Replay Last', () => {
    if (lastSeed === null) return;
    devApi.startMatch(playerPick, currentBotNames(), { seed: lastSeed });
    refreshAll();
  });
  button(arenaBtns, 'Copy Seed', () => {
    const info = devApi.getArenaInfo();
    if (info) navigator.clipboard.writeText(String(info.seed)).catch(() => {});
  });

  // =======================================================================
  // GROUP: LIVE CONTROL ---------------------------------------------------
  // =======================================================================
  const controlGroup = group(root, 'Live control', 'control');

  // ---- Bots (expanded — priority panel) ---------------------------------
  const bots = section(controlGroup, 'Bots');
  const bulkRow = row(bots);
  const bulkLabel = document.createElement('label');
  bulkLabel.textContent = 'All bots';
  bulkRow.appendChild(bulkLabel);
  const bulkSel = document.createElement('select');
  for (const b of BOT_BEHAVIOURS) {
    const op = document.createElement('option');
    op.value = b; op.textContent = b;
    bulkSel.appendChild(op);
  }
  bulkSel.value = 'normal';
  bulkSel.addEventListener('change', () => {
    devApi.setAllBotsBehaviour(bulkSel.value as BotBehaviourTag);
    refreshBotsPanel();
  });
  bulkRow.appendChild(bulkSel);
  const botListEl = document.createElement('div');
  bots.appendChild(botListEl);

  // ---- Gameplay (expanded — priority panel) -----------------------------
  const gameplay = section(controlGroup, 'Gameplay');
  tinyLabel(gameplay, 'Cooldowns (player)');
  const cdList = document.createElement('div');
  gameplay.appendChild(cdList);
  const gpBtns = row(gameplay);
  button(gpBtns, 'Reset CDs', () => { devApi.resetPlayerCooldowns(); refreshCooldownsPanel(); });
  button(gpBtns, 'Force J', () => devApi.forceAbility(0));
  button(gpBtns, 'Force K', () => devApi.forceAbility(1));
  button(gpBtns, 'Force L', () => devApi.forceAbility(2));
  const tpBtns = row(gameplay);
  button(tpBtns, 'TP Player Centre', () => devApi.teleportPlayer(0, 0));
  for (const preset of TELEPORT_PRESETS) {
    button(tpBtns, `Bots→${preset}`, () => devApi.teleportBotsPreset(preset));
  }
  tinyLabel(gameplay, 'Event log');
  const eventLogEl = document.createElement('div');
  eventLogEl.className = 'lab-event-log';
  gameplay.appendChild(eventLogEl);
  const evtBtns = row(gameplay);
  button(evtBtns, 'Clear Log', () => { devApi.clearEventLog(); refreshEventLog(); });

  // ---- Playback (collapsed — reach for when pausing / slow-mo) ----------
  const actions = section(controlGroup, 'Playback', { collapsed: true });
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
    devApi.setSpeed(v);
    speedVal.textContent = v.toFixed(2);
  });
  speedRow.appendChild(speedSlider);
  speedRow.appendChild(speedVal);
  const actionBtns = row(actions);
  button(actionBtns, 'Pause', () => {
    const next = devApi.getSpeed() === 0 ? 1 : 0;
    devApi.setSpeed(next);
    speedSlider.value = String(next);
    speedVal.textContent = next.toFixed(2);
  });
  button(actionBtns, 'Slow 0.3×', () => {
    devApi.setSpeed(0.3);
    speedSlider.value = '0.3';
    speedVal.textContent = '0.30';
  });
  button(actionBtns, 'Normal 1×', () => {
    devApi.setSpeed(1);
    speedSlider.value = '1';
    speedVal.textContent = '1.00';
  });
  button(actionBtns, 'End Match', () => devApi.endMatch());

  // =======================================================================
  // GROUP: OBSERVE --------------------------------------------------------
  // =======================================================================
  const observeGroup = group(root, 'Observe', 'observe');

  // ---- Recording (expanded — live status) -------------------------------
  const recording = section(observeGroup, 'Recording');
  const recStatus = document.createElement('div');
  recStatus.className = 'lab-info';
  recording.appendChild(recStatus);
  const recBtns = row(recording);
  button(recBtns, 'Stop', () => { devApi.stopRecording(); refreshRecordingPanel(); });
  button(recBtns, 'Download JSON', () => devApi.downloadRecordingJSON(), 'primary');
  button(recBtns, 'Download MD', () => devApi.downloadRecordingMD());
  button(recBtns, 'Clear', () => { devApi.clearRecording(); refreshRecordingPanel(); });

  // ---- Performance (expanded — quick FPS glance) ------------------------
  const perf = section(observeGroup, 'Performance');
  const perfGrid = document.createElement('div');
  perfGrid.className = 'lab-perf-grid';
  perf.appendChild(perfGrid);

  // ---- Input (collapsed — kept for gamepad / touch checks) --------------
  const inputSec = section(observeGroup, 'Input', { collapsed: true });
  const inputBox = document.createElement('div');
  inputBox.className = 'lab-input-box';
  inputSec.appendChild(inputBox);

  // ---- Player info (collapsed — verbose raw stats) ----------------------
  const info = section(observeGroup, 'Player info', { collapsed: true });
  const infoEl = document.createElement('div');
  infoEl.className = 'lab-info';
  info.appendChild(infoEl);

  // =======================================================================
  // GROUP: TUNING ---------------------------------------------------------
  // =======================================================================
  const tuningGroup = group(root, 'Tuning', 'tuning');

  // ---- Animation tuner (collapsed — occasional tweaking) ----------------
  const anim = section(tuningGroup, 'Animation (player)', { collapsed: true });
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
      const player = devApi.game.player;
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
    const player = devApi.game.player;
    if (!player) return;
    player.animPersonality = deriveAnimationPersonality(player.config);
    syncSlidersFromPlayer();
  });
  button(animBtns, 'Copy Values', () => {
    const player = devApi.game.player;
    if (!player) return;
    navigator.clipboard
      .writeText(JSON.stringify(player.animPersonality, null, 2))
      .catch(() => {});
  });

  // ---- Footer note + sibling-tool links --------------------------------
  const note = document.createElement('div');
  note.className = 'lab-note';
  note.innerHTML = '/tools.html · internal · unlinked from production UI · noindex';
  root.appendChild(note);

  // Sibling internal tool discoverability. Keep adding tools here as they
  // appear; the list is short on purpose — these are dev surfaces, not
  // player-facing UI.
  const siblingLinks = document.createElement('div');
  siblingLinks.className = 'lab-note';
  siblingLinks.style.marginTop = '2px';
  siblingLinks.innerHTML =
    'Other internal tools: ' +
    '<a href="/animations" target="_blank" rel="noopener" ' +
    'style="color:#ffdc5c;text-decoration:none;">🎬 /animations</a> ' +
    '<span style="opacity:0.55">(mesh2motion-based animation lab)</span>';
  root.appendChild(siblingLinks);

  // =======================================================================
  // Live panel refresh functions
  // =======================================================================
  function refreshAll(): void {
    refreshArenaPanel();
    refreshInfoPanel();
    refreshBotsPanel();
    refreshCooldownsPanel();
    refreshEventLog();
    refreshPerfPanel();
    refreshInputPanel();
    refreshRecordingPanel();
  }

  function refreshRecordingPanel(): void {
    const rec = devApi.getRecording();
    if (!rec) {
      recStatus.textContent = [
        'status   no recording',
        'hint     starts automatically with each match',
      ].join('\n');
      return;
    }
    const live = devApi.isRecording();
    const dur = live
      ? ((performance.now() - rec.meta.startedAt) / 1000).toFixed(1)
      : (rec.meta.durationSec ?? 0).toFixed(1);
    recStatus.textContent = [
      `status   ${live ? 'RECORDING' : 'closed'}`,
      `started  ${rec.meta.startedAtIso}`,
      `player   ${rec.meta.playerName}`,
      `bots     ${rec.meta.botNames.join(', ') || '(none)'}`,
      `seed     ${rec.meta.seed ?? '-'}`,
      `duration ${dur}s`,
      `events   ${rec.events.length}`,
      `actions  ${rec.actions.length}`,
      `samples  ${rec.snapshots.length}`,
      `outcome  ${rec.outcome.survivor ?? '-'} (${rec.outcome.reason ?? 'pending'})`,
    ].join('\n');
  }

  function refreshInfoPanel(): void {
    const p = devApi.game.player;
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
    const info = devApi.getArenaInfo();
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

  // Bot rows are kept ALIVE across refreshes. Recreating them every tick
  // destroys the <select> element while the user has the dropdown open,
  // which the browser interprets as "close the dropdown". Previous bug:
  // individual bot dropdowns never opened because they were nuked ~4×/sec.
  // Canonical pattern for any live panel with interactive widgets.
  interface BotRowEls {
    row: HTMLDivElement;
    sel: HTMLSelectElement;
    name: HTMLSpanElement;
  }
  const botRowEls = new Map<number, BotRowEls>();
  let botEmptyEl: HTMLElement | null = null;

  function refreshBotsPanel(): void {
    const list = devApi.getBotSnapshots();

    if (list.length === 0) {
      for (const { row } of botRowEls.values()) row.remove();
      botRowEls.clear();
      if (!botEmptyEl) {
        botEmptyEl = document.createElement('div');
        botEmptyEl.className = 'lab-note';
        botEmptyEl.textContent = '(no bots in current match)';
        botListEl.appendChild(botEmptyEl);
      }
      return;
    }
    if (botEmptyEl) {
      botEmptyEl.remove();
      botEmptyEl = null;
    }

    const seen = new Set<number>();
    for (const b of list) {
      seen.add(b.index);
      let cached = botRowEls.get(b.index);
      if (!cached) {
        const rowEl = document.createElement('div');
        const dot = document.createElement('span');
        dot.className = 'bot-dot';
        rowEl.appendChild(dot);
        const nameEl = document.createElement('span');
        nameEl.className = 'bot-name';
        rowEl.appendChild(nameEl);
        const sel = document.createElement('select');
        for (const opt of BOT_BEHAVIOURS) {
          const op = document.createElement('option');
          op.value = opt; op.textContent = opt;
          sel.appendChild(op);
        }
        sel.addEventListener('change', () => {
          devApi.setBotBehaviour(b.index, sel.value as BotBehaviourTag);
        });
        rowEl.appendChild(sel);
        botListEl.appendChild(rowEl);
        cached = { row: rowEl, sel, name: nameEl };
        botRowEls.set(b.index, cached);
      }
      cached.row.className = 'lab-bot-row' + (b.alive ? '' : ' dead');
      cached.name.textContent = `${b.index} · ${b.name}`;
      if (document.activeElement !== cached.sel) {
        cached.sel.value = b.behaviour;
      }
    }
    for (const idx of Array.from(botRowEls.keys())) {
      if (!seen.has(idx)) {
        const { row } = botRowEls.get(idx)!;
        row.remove();
        botRowEls.delete(idx);
      }
    }
  }

  function refreshCooldownsPanel(): void {
    const p = devApi.getPlayerSnapshot();
    cdList.innerHTML = '';
    if (!p) {
      const empty = document.createElement('div');
      empty.className = 'lab-note';
      empty.textContent = '(no player)';
      cdList.appendChild(empty);
      return;
    }
    cdList.appendChild(renderCooldownRow('HB', 'headbutt', p.headbuttCooldown, 0.6));
    p.abilities.forEach((a, i) => {
      const slot = ['J', 'K', 'L'][i] || `#${i}`;
      let pct: number;
      let cls: 'active' | 'on-cd' | '';
      let display: string;
      if (a.active) {
        pct = 1;
        cls = 'active';
        display = a.windUpLeft > 0 ? `wind ${a.windUpLeft.toFixed(1)}` : `act ${a.durationLeft.toFixed(1)}`;
      } else if (a.cooldownLeft > 0) {
        pct = 1 - Math.min(1, a.cooldownLeft / (a.cooldown || 1));
        cls = 'on-cd';
        display = `${a.cooldownLeft.toFixed(1)}s`;
      } else {
        pct = 1;
        cls = '';
        display = 'ready';
      }
      cdList.appendChild(renderCooldownRowFull(slot, a.name, pct, cls, display));
    });
  }

  function renderCooldownRow(slot: string, name: string, cdLeft: number, fullCd: number): HTMLDivElement {
    const onCd = cdLeft > 0;
    const pct = onCd ? 1 - Math.min(1, cdLeft / fullCd) : 1;
    return renderCooldownRowFull(slot, name, pct, onCd ? 'on-cd' : '', onCd ? `${cdLeft.toFixed(1)}s` : 'ready');
  }

  function renderCooldownRowFull(slot: string, name: string, pct: number, cls: 'active' | 'on-cd' | '', display: string): HTMLDivElement {
    const rowEl = document.createElement('div');
    rowEl.className = 'lab-cd-row' + (cls ? ' ' + cls : '');
    const slotEl = document.createElement('span');
    slotEl.className = 'cd-slot';
    slotEl.textContent = slot;
    rowEl.appendChild(slotEl);
    const nameEl = document.createElement('span');
    nameEl.className = 'cd-name';
    nameEl.textContent = name;
    rowEl.appendChild(nameEl);
    const valEl = document.createElement('span');
    valEl.className = 'cd-val';
    valEl.textContent = display;
    rowEl.appendChild(valEl);
    const bg = document.createElement('div');
    bg.className = 'cd-bar-bg';
    const bar = document.createElement('div');
    bar.className = 'cd-bar';
    bar.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
    bg.appendChild(bar);
    rowEl.appendChild(bg);
    return rowEl;
  }

  function refreshEventLog(): void {
    const log = devApi.getEventLog();
    eventLogEl.innerHTML = '';
    const now = performance.now();
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      const dtSec = (now - e.t) / 1000;
      const line = formatEventLine(e, dtSec);
      eventLogEl.appendChild(line);
    }
  }

  function formatEventLine(e: GameplayEvent, dtSec: number): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `evt evt-${e.type}`;
    const t = document.createElement('span');
    t.className = 'evt-t';
    t.textContent = `-${dtSec.toFixed(1)}s`;
    const type = document.createElement('span');
    type.className = 'evt-type';
    type.textContent = e.type;
    const rest = document.createElement('span');
    const actor = document.createElement('span');
    actor.className = 'evt-actor';
    actor.textContent = e.actor ?? '';
    rest.appendChild(actor);
    if (e.details) {
      rest.appendChild(document.createTextNode(' '));
      const det = document.createElement('span');
      det.className = 'evt-details';
      det.textContent = e.details;
      rest.appendChild(det);
    }
    el.appendChild(t);
    el.appendChild(type);
    el.appendChild(rest);
    return el;
  }

  function refreshPerfPanel(): void {
    const p = devApi.getPerf();
    perfGrid.innerHTML = '';
    const rows: Array<[string, string]> = [
      ['fps',        p.fps.toFixed(0)],
      ['frameMs',    p.frameMs.toFixed(1)],
      ['drawCalls',  String(p.drawCalls)],
      ['triangles',  p.triangles.toLocaleString('en-US')],
      ['geometries', String(p.geometries)],
      ['textures',   String(p.textures)],
      ['critters',   String(p.critters)],
      ['fragments',  `${p.arenaFragmentsAlive}/${p.arenaFragmentsTotal}`],
    ];
    for (const [k, v] of rows) {
      const kk = document.createElement('span'); kk.className = 'pk'; kk.textContent = k;
      const vv = document.createElement('span'); vv.className = 'pv'; vv.textContent = v;
      perfGrid.appendChild(kk);
      perfGrid.appendChild(vv);
    }
  }

  function refreshInputPanel(): void {
    const snap = devApi.getInputSnapshot();
    inputBox.innerHTML = '';

    const moveLine = document.createElement('div');
    moveLine.textContent = `move (${snap.move.x.toFixed(2)}, ${snap.move.z.toFixed(2)})`;
    inputBox.appendChild(moveLine);

    const actionsLine = document.createElement('div');
    for (const [name, on] of Object.entries(snap.held)) {
      const chip = document.createElement('span');
      chip.className = 'action' + (on ? ' on' : '');
      chip.textContent = name;
      actionsLine.appendChild(chip);
    }
    inputBox.appendChild(actionsLine);

    const keysLine = document.createElement('div');
    if (snap.keyboard.length === 0) {
      const chip = document.createElement('span');
      chip.className = 'key';
      chip.textContent = '(no keys held)';
      keysLine.appendChild(chip);
    } else {
      for (const k of snap.keyboard) {
        const chip = document.createElement('span');
        chip.className = 'key';
        chip.textContent = k.code;
        keysLine.appendChild(chip);
      }
    }
    inputBox.appendChild(keysLine);

    const gpLine = document.createElement('div');
    gpLine.style.marginTop = '4px';
    if (snap.gamepads.length === 0) {
      const chip = document.createElement('span');
      chip.className = 'action';
      chip.textContent = 'no gamepad';
      gpLine.appendChild(chip);
    } else {
      for (const gp of snap.gamepads) {
        const chip = document.createElement('span');
        chip.className = 'action' + (gp.connected ? ' on' : '');
        chip.textContent = `GP${gp.index}: ${gp.id.slice(0, 24)}`;
        gpLine.appendChild(chip);
      }
    }
    inputBox.appendChild(gpLine);
  }

  function syncSlidersFromPlayer(): void {
    const player = devApi.game.player;
    if (!player?.animPersonality) return;
    for (const p of ANIM_PARAMS) {
      const slider = sliders.get(p.key)!;
      const v = player.animPersonality[p.key];
      slider.value = String(v);
      valueLabels.get(p.key)!.textContent = (+v).toFixed(3);
    }
  }

  // Live refresh rates tuned per-panel cost:
  //   - Fast (12 Hz): cooldowns, event log, perf, input — visible latency matters.
  //   - Slow (4 Hz): arena + info + bots + recording — updated discretely.
  setInterval(() => {
    refreshCooldownsPanel();
    refreshEventLog();
    refreshPerfPanel();
    refreshInputPanel();
  }, 80);
  setInterval(() => {
    refreshArenaPanel();
    refreshInfoPanel();
    refreshBotsPanel();
    refreshRecordingPanel();
  }, 250);
  // First paint
  setTimeout(() => {
    refreshAll();
    const info = devApi.getArenaInfo();
    if (info) {
      lastSeed = info.seed;
      seedInput.value = String(info.seed);
    }
  }, 100);

  // Stash on window for manual tweaking from the console. Both DevApi and
  // the raw Game are reachable as escape hatches.
  (window as unknown as { __lab: object }).__lab = {
    devApi,
    game: devApi.game,
    startMatch,
    setSpeed: (v: number) => {
      devApi.setSpeed(v);
      speedSlider.value = String(v);
      speedVal.textContent = v.toFixed(2);
    },
  };

  playerSel.addEventListener('change', () => {
    // Player changed before pressing Start — nothing to sync yet.
    // Active matches keep their current tuning.
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

/**
 * Create a thematic group wrapper with a coloured separator bar. Returns
 * the wrapper; callers add sections to it.
 *
 * Kinds:
 *   - 'setup'   (blue)    one-time pre-match config
 *   - 'control' (red)     things you change DURING a match
 *   - 'observe' (green)   live read-only panels
 *   - 'tuning'  (yellow)  fine-grained tweaks
 */
function group(parent: HTMLElement, label: string, kind: GroupKind): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'lab-group-wrap lab-group-' + kind;
  const header = document.createElement('div');
  header.className = 'lab-group ' + kind;
  header.textContent = label;
  wrap.appendChild(header);
  parent.appendChild(wrap);
  return wrap;
}

/**
 * Collapsible section. Returns the CONTENT element — callers append their
 * controls to it exactly like before (the wrapper is transparent to them).
 * The header toggles display of the content on click.
 */
function section(parent: HTMLElement, title: string, opts?: { collapsed?: boolean }): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'lab-section' + (opts?.collapsed ? ' collapsed' : '');
  const header = document.createElement('div');
  header.className = 'lab-section-header';
  const caret = document.createElement('span');
  caret.className = 'lab-section-caret';
  caret.textContent = opts?.collapsed ? '▸' : '▾';
  const h = document.createElement('h2');
  h.textContent = title;
  header.appendChild(caret);
  header.appendChild(h);
  const content = document.createElement('div');
  content.className = 'lab-section-content';
  header.addEventListener('click', () => {
    const nowCollapsed = wrap.classList.toggle('collapsed');
    caret.textContent = nowCollapsed ? '▸' : '▾';
  });
  wrap.appendChild(header);
  wrap.appendChild(content);
  parent.appendChild(wrap);
  return content;
}

function tinyLabel(parent: HTMLElement, text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'lab-note';
  el.textContent = text;
  parent.appendChild(el);
  return el;
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
