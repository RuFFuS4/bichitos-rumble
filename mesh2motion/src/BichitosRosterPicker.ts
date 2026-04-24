// ---------------------------------------------------------------------------
// Bichitos Rumble roster picker — primary UI layer on /animations
// ---------------------------------------------------------------------------
//
// This file is the entire Bichitos Rumble personality inside Mesh2Motion's
// `create.html` page. Upstream ships a generic "import any model" UI; we
// replace the model-selection interaction with a grid of our 9 playable
// critters and layer a couple of conveniences on top:
//
//   1. Roster grid — instead of uploading a random GLB or picking from
//      mesh2motion's Human/Fox/Bird/Dragon/Kaiju reference models, each
//      card here points at one of `public/models/critters/<id>.glb`.
//      Clicking a card piggy-backs on mesh2motion's existing
//      #model-selection + #load-model-button path (no fork of the engine).
//
//   2. Rig suggestion per critter — each card knows which mesh2motion
//      skeleton type ('human', 'fox', 'kaiju', 'bird', 'spider') fits the
//      critter's morphology best. After the model loads and the skeleton
//      dropdown populates, we pre-select the suggested value so the user
//      doesn't have to guess.
//
//   3. Export filename override — upstream exports as `exported_model.glb`.
//      We listen on the hidden download link and rewrite `download` to
//      `<critter-id>.glb` right before the browser fires the save dialog,
//      so the file lands with the correct game-ready name on first save.
//
//   4. Post-export toast — once the download starts, a yellow toast pops
//      out with the exact path where the file needs to end up in the
//      game repo: `public/models/critters/<id>.glb`. No disk-write API
//      available from the browser, but the path is one click from being
//      copied.
//
// Upstream edits: zero. If we need to merge a new mesh2motion release in,
// `create.html` still has our banner + CSS overrides + this script tag,
// but the engine itself is untouched. See README-INTEGRATION.md for the
// full list of deltas.
// ---------------------------------------------------------------------------

import {
  MM_HUMAN_TO_TRIPO_DEFAULT,
  MM_HUMAN_BONE_ORDER,
  setActiveMapping,
  getActiveMapping,
  resetActiveMapping,
} from './BichitosTripoRetargeter';

interface RosterEntry {
  /** Matches the filename stem in `public/models/critters/<id>.glb`. */
  id: string;
  /** Display name used on the card. */
  name: string;
  /** Critter accent colour (hex). Used as the card's dot. */
  color: string;
  /** mesh2motion SkeletonType enum value (lowercased). */
  suggestedRig: 'human' | 'fox' | 'bird' | 'dragon' | 'kaiju' | 'spider' | 'snake';
  /** Short note explaining why we suggest this rig. Shown on hover. */
  rigNote: string;
}

// Order chosen so the critters whose rigs match well come first. Helps the
// user build muscle memory on the easy cases before hitting the hard ones.
const BICHITOS_ROSTER: RosterEntry[] = [
  { id: 'sergei',    name: 'Sergei',    color: '#e74c3c', suggestedRig: 'human',  rigNote: 'Humanoid gorilla — human rig fits cleanly' },
  { id: 'kurama',    name: 'Kurama',    color: '#ff9a5c', suggestedRig: 'fox',    rigNote: 'Fox — direct match' },
  { id: 'cheeto',    name: 'Cheeto',    color: '#ff6a00', suggestedRig: 'fox',    rigNote: 'Tiger — closest is fox (both quadruped felines)' },
  { id: 'kowalski',  name: 'Kowalski',  color: '#3b82f6', suggestedRig: 'bird',   rigNote: 'Penguin — bird rig (try human if bird feels limited)' },
  { id: 'trunk',     name: 'Trunk',     color: '#9a8671', suggestedRig: 'kaiju',  rigNote: 'Elephant — kaiju is closest heavy quadruped' },
  { id: 'sebastian', name: 'Sebastian', color: '#c0392b', suggestedRig: 'spider', rigNote: 'Crab — spider for multi-leg arthropod' },
  { id: 'shelly',    name: 'Shelly',    color: '#4ade80', suggestedRig: 'kaiju',  rigNote: 'Turtle — no perfect match. Kaiju-ish; may need Tripo Animate instead' },
  { id: 'kermit',    name: 'Kermit',    color: '#74c69d', suggestedRig: 'human',  rigNote: 'Frog — no native rig. Human is a stretch; Tripo Animate recommended' },
  { id: 'sihans',    name: 'Sihans',    color: '#a68b5b', suggestedRig: 'human',  rigNote: 'Mole — no native rig. Use Tripo Animate for proper result' },
];

/**
 * Absolute URL that works in both dev and production:
 *   - In production: Vercel serves `/models/critters/<id>.glb` alongside
 *     `/animations/*` from the same dist.
 *   - In dev: the pre-dev `copy-game-assets.mjs` hook mirrors the files
 *     into `static/models/critters/`, which Vite serves at
 *     `/animations/models/critters/<id>.glb` via the publicDir setting.
 *
 * Using the relative form `models/critters/<id>.glb` so mesh2motion's
 * existing file-loading path treats it like any reference model.
 */
function critterGlbUrl(id: string): string {
  return `models/critters/${id}.glb`;
}

/**
 * Module-scoped reference to the critter currently loaded via the picker.
 * Used by the export-filename override below. `null` when no critter has
 * been loaded yet (e.g. right after page mount).
 */
let currentCritter: RosterEntry | null = null;

// ---------------------------------------------------------------------------
// Panel construction
// ---------------------------------------------------------------------------

const PANEL_CSS = `
#bichitos-roster-panel {
  /* max-width keeps the panel from pushing #tool-panel into the canvas.
     Without it, the 3-column card grid stretches to whatever width the
     tool-panel has available, and the tool-panel grows to fit, which ends
     up covering ~65% of the viewport and hiding the 3D scene where the
     critter mesh and skeleton joints render. 340px fits 3 columns of
     ~100px cards comfortably and leaves the canvas free. */
  max-width: 340px;
  background: rgba(231, 76, 60, 0.07);
  border: 1px solid rgba(231, 76, 60, 0.4);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 0 0 14px 0;
  font-family: 'Segoe UI', Arial, sans-serif;
  color: inherit;
}
#bichitos-roster-panel h3 {
  margin: 0 0 4px 0;
  font-size: 13px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #ffbbb2;
  font-weight: 700;
}
#bichitos-roster-panel .subtitle {
  font-size: 10px;
  opacity: 0.75;
  margin-bottom: 12px;
  line-height: 1.4;
}
#bichitos-roster-panel .subtitle code {
  background: rgba(255, 220, 92, 0.14);
  color: #ffdc5c;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
}
#bichitos-roster-panel .critter-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.bichitos-critter-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 10px 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  transition: transform 0.12s, border-color 0.12s, background 0.12s, box-shadow 0.12s;
  color: inherit;
  font: inherit;
  position: relative;
}
.bichitos-critter-card:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 220, 92, 0.55);
  transform: translateY(-1px);
}
.bichitos-critter-card.is-active {
  background: rgba(255, 220, 92, 0.14);
  border-color: #ffdc5c;
  box-shadow: 0 0 12px rgba(255, 220, 92, 0.35);
}
.bichitos-critter-card .dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0,0,0,0.45);
}
.bichitos-critter-card .name {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.bichitos-critter-card .rig {
  font-size: 8px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  opacity: 0.65;
}

/* Post-export toast — pops in the bottom centre telling the user where
   to save the exported GLB in the game repo. */
#bichitos-export-toast {
  position: fixed;
  bottom: 34px;
  left: 50%;
  transform: translateX(-50%) translateY(8px);
  max-width: 520px;
  padding: 12px 18px;
  background: rgba(10, 10, 24, 0.95);
  border: 1px solid rgba(255, 220, 92, 0.65);
  border-radius: 10px;
  color: #fff;
  font: 13px/1.5 'Segoe UI', Arial, sans-serif;
  text-align: center;
  z-index: 100001;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
#bichitos-export-toast.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
#bichitos-export-toast strong { color: #ffdc5c; }
#bichitos-export-toast code {
  background: rgba(255, 220, 92, 0.15);
  color: #ffdc5c;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
}

/* Bone pairing panel — shown below the roster grid when a pre-rigged
   critter is loaded. Lets the user manually match MM template bones
   against the model's own skeleton, one row at a time. Changes call
   setActiveMapping() and reload the animation library so the new
   mapping drives clip playback in real time. */
#bichitos-bone-pairing-panel {
  max-width: 340px;
  background: rgba(255, 220, 92, 0.06);
  border: 1px solid rgba(255, 220, 92, 0.35);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 0 0 14px 0;
  font-family: 'Segoe UI', Arial, sans-serif;
  color: inherit;
  display: none;
}
#bichitos-bone-pairing-panel.visible { display: block; }
#bichitos-bone-pairing-panel h3 {
  margin: 0 0 4px 0;
  font-size: 12px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #ffdc5c;
  font-weight: 700;
}
#bichitos-bone-pairing-panel .subtitle {
  font-size: 10px;
  opacity: 0.75;
  margin-bottom: 10px;
  line-height: 1.35;
}
#bichitos-bone-pairing-panel .bone-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
}
#bichitos-bone-pairing-panel .bone-row {
  display: grid;
  grid-template-columns: 85px 1fr;
  align-items: center;
  gap: 6px;
  font-size: 10px;
}
#bichitos-bone-pairing-panel .bone-row label {
  font-family: 'Consolas', 'Monaco', monospace;
  color: #9cd0ff;
  text-align: right;
  padding-right: 2px;
  letter-spacing: 0.3px;
}
#bichitos-bone-pairing-panel .bone-row select {
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(255,255,255,0.18);
  color: #eee;
  padding: 3px 4px;
  border-radius: 4px;
  font-size: 10px;
  font-family: 'Consolas', 'Monaco', monospace;
  width: 100%;
}
#bichitos-bone-pairing-panel .bone-row select:focus {
  border-color: #ffdc5c;
  outline: none;
}
#bichitos-bone-pairing-panel .actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
#bichitos-bone-pairing-panel .actions button {
  flex: 1;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.2);
  color: #eee;
  padding: 6px 8px;
  font-size: 10px;
  border-radius: 4px;
  cursor: pointer;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-weight: 600;
}
#bichitos-bone-pairing-panel .actions button:hover {
  background: rgba(255, 220, 92, 0.15);
  border-color: #ffdc5c;
}
#bichitos-bone-pairing-panel .status {
  font-size: 9px;
  opacity: 0.6;
  margin-top: 6px;
  font-style: italic;
}
`;

function injectStyles(): void {
  if (document.getElementById('bichitos-roster-styles')) return;
  const style = document.createElement('style');
  style.id = 'bichitos-roster-styles';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

function buildPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'bichitos-roster-panel';

  const title = document.createElement('h3');
  title.textContent = 'Choose a critter';
  panel.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'subtitle';
  subtitle.innerHTML =
    'Click any critter to load its model and auto-select a suggested rig. ' +
    'The upstream upload button is hidden on purpose — this lab is wired ' +
    'to only work with the 9 playable critters of Bichitos Rumble.';
  panel.appendChild(subtitle);

  const grid = document.createElement('div');
  grid.className = 'critter-grid';

  for (const critter of BICHITOS_ROSTER) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'bichitos-critter-card';
    card.title = critter.rigNote;
    card.dataset.critterId = critter.id;

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = critter.color;
    card.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = critter.name;
    card.appendChild(name);

    const rig = document.createElement('span');
    rig.className = 'rig';
    rig.textContent = `→ ${critter.suggestedRig}`;
    card.appendChild(rig);

    card.addEventListener('click', () => {
      loadCritter(critter);
    });

    grid.appendChild(card);
  }

  panel.appendChild(grid);
  return panel;
}

function markActiveCard(critterId: string): void {
  const cards = document.querySelectorAll<HTMLButtonElement>('.bichitos-critter-card');
  cards.forEach((card) => {
    card.classList.toggle('is-active', card.dataset.critterId === critterId);
  });
}

// ---------------------------------------------------------------------------
// Bone pairing panel — C (manual Tripo ↔ MM mapping)
// ---------------------------------------------------------------------------

/** Human-readable labels for each MM bone so non-rig-nerds can parse
 *  the list. Keyed by the same names as MM_HUMAN_BONE_ORDER. */
const MM_BONE_LABELS: Record<string, string> = {
  pelvis: 'hips',
  spine_01: 'lower spine',
  spine_02: 'mid spine',
  spine_03: 'upper spine',
  neck_01: 'neck',
  head: 'head',
  clavicle_l: 'L shoulder', upperarm_l: 'L upper arm', lowerarm_l: 'L forearm', hand_l: 'L hand',
  clavicle_r: 'R shoulder', upperarm_r: 'R upper arm', lowerarm_r: 'R forearm', hand_r: 'R hand',
  thigh_l: 'L thigh', calf_l: 'L calf', foot_l: 'L foot',
  thigh_r: 'R thigh', calf_r: 'R calf', foot_r: 'R foot',
};

function buildBonePairingPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'bichitos-bone-pairing-panel';

  const title = document.createElement('h3');
  title.textContent = 'Bone Mapping';
  panel.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'subtitle';
  subtitle.innerHTML =
    'Match Mesh2Motion template bones (left) to the bones in your model (right). ' +
    'Changes reload animations on the fly. Set to <code>(skip)</code> to drop a bone.';
  subtitle.querySelector('code')?.setAttribute('style', 'background: rgba(255,220,92,0.14); color: #ffdc5c; padding: 1px 4px; border-radius: 3px;');
  panel.appendChild(subtitle);

  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'bone-rows';
  rowsContainer.id = 'bichitos-bone-rows';
  panel.appendChild(rowsContainer);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset defaults';
  resetBtn.addEventListener('click', () => {
    resetActiveMapping();
    // Re-render with defaults + trigger reload
    const skel = getCurrentPreRiggedSkeleton();
    if (skel) renderBonePairingRows(skel);
    reloadAnimationsFromMapping();
  });
  actions.appendChild(resetBtn);

  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.textContent = 'Reload anims';
  reloadBtn.addEventListener('click', () => reloadAnimationsFromMapping());
  actions.appendChild(reloadBtn);

  panel.appendChild(actions);

  const status = document.createElement('div');
  status.className = 'status';
  status.id = 'bichitos-bone-pairing-status';
  status.textContent = 'Load a critter to see its bones.';
  panel.appendChild(status);

  return panel;
}

/** Rebuild the rows for the current pre-rigged skeleton. Each row = one
 *  MM bone (label) + a <select> listing ALL bones from the loaded
 *  model's skeleton plus a "(skip)" sentinel option. Pre-selects the
 *  current active mapping value. */
function renderBonePairingRows(skeleton: { bones: { name: string }[] }): void {
  const container = document.getElementById('bichitos-bone-rows');
  const panel = document.getElementById('bichitos-bone-pairing-panel');
  const status = document.getElementById('bichitos-bone-pairing-status');
  if (!container || !panel) return;

  container.innerHTML = '';

  const modelBoneNames = skeleton.bones.map((b) => b.name).slice().sort();
  const mapping = getActiveMapping();

  for (const mmName of MM_HUMAN_BONE_ORDER) {
    const row = document.createElement('div');
    row.className = 'bone-row';

    const label = document.createElement('label');
    const labelText = MM_BONE_LABELS[mmName] ?? mmName;
    label.textContent = labelText;
    label.title = `${mmName} (MM template)`;
    row.appendChild(label);

    const sel = document.createElement('select');
    sel.dataset.mmBone = mmName;

    // Skip option
    const skip = document.createElement('option');
    skip.value = '';
    skip.textContent = '(skip)';
    sel.appendChild(skip);

    // All model bones
    for (const bn of modelBoneNames) {
      const opt = document.createElement('option');
      opt.value = bn;
      opt.textContent = bn;
      sel.appendChild(opt);
    }

    // Preselect
    sel.value = mapping[mmName] ?? '';

    sel.addEventListener('change', () => onMappingRowChanged());
    row.appendChild(sel);
    container.appendChild(row);
  }

  if (status) {
    status.textContent = `Model has ${modelBoneNames.length} bones. Edit rows to change how clips map.`;
  }
  panel.classList.add('visible');
}

function hideBonePairingPanel(): void {
  const panel = document.getElementById('bichitos-bone-pairing-panel');
  if (panel) panel.classList.remove('visible');
}

/** Add a "Use model's existing rig" button inside the Edit Skeleton
 *  step (next to the Bind Pose button). Clicking it activates the
 *  pre-rigged pipeline — skips bind, jumps to AnimationsListing, shows
 *  the bone pairing panel. Only functional when the loaded GLB carried
 *  a Tripo-style skeleton (detected silently during the normal load). */
function injectUseExistingRigButton(): void {
  if (document.getElementById('bichitos-use-existing-rig-btn')) return;
  const bindPoseBtn = document.getElementById('action_bind_pose');
  if (!bindPoseBtn) return;

  const btn = document.createElement('button');
  btn.id = 'bichitos-use-existing-rig-btn';
  btn.type = 'button';
  btn.textContent = '🔗 Use existing rig (skip binding)';
  btn.style.cssText = 'background: rgba(255, 220, 92, 0.15); border: 1px solid #ffdc5c; color: #ffdc5c; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; letter-spacing: 0.3px; margin-right: 8px;';
  btn.title = 'Use the skeleton that came with the model (Tripo Animate) instead of the MM template. Jumps straight to the animations step + bone mapping panel.';

  btn.addEventListener('click', () => {
    const engine = (window as unknown as {
      __bichitos_mm_engine?: {
        load_model_step: {
          has_pre_rigged_data: () => boolean;
          trigger_pre_rigged_activation: () => boolean;
        };
      };
    }).__bichitos_mm_engine;
    if (!engine) {
      console.warn('[BichitosRosterPicker] engine not on window; button no-op');
      return;
    }
    if (!engine.load_model_step.has_pre_rigged_data()) {
      alert('This model doesn\'t ship a pre-rigged skeleton — continue with the MM template rig (click Bind Pose).');
      return;
    }
    engine.load_model_step.trigger_pre_rigged_activation();
  });

  // Insert before the Bind Pose button
  bindPoseBtn.parentNode?.insertBefore(btn, bindPoseBtn);
}

/** Read the current DOM state and push it as the new active mapping,
 *  then reload animations so the change takes effect immediately. */
function onMappingRowChanged(): void {
  const rows = document.querySelectorAll<HTMLSelectElement>('#bichitos-bone-rows select[data-mm-bone]');
  const mapping: Record<string, string> = {};
  rows.forEach((sel) => {
    const mm = sel.dataset.mmBone;
    if (mm && sel.value) mapping[mm] = sel.value;
    // Empty value ("(skip)") → simply omit the key.
  });
  setActiveMapping(mapping);
  reloadAnimationsFromMapping();
}

function reloadAnimationsFromMapping(): void {
  const engine = (window as unknown as {
    __bichitos_mm_engine?: {
      is_pre_rigged_active?: boolean;
      reload_animations_for_current_mapping?: () => void;
    };
  }).__bichitos_mm_engine;
  if (!engine || !engine.is_pre_rigged_active) return;
  engine.reload_animations_for_current_mapping?.();
  const status = document.getElementById('bichitos-bone-pairing-status');
  if (status) {
    const filled = Object.keys(getActiveMapping()).length;
    status.textContent = `Mapping applied. ${filled} MM bones → model bones. Animations reloaded.`;
  }
}

function getCurrentPreRiggedSkeleton(): { bones: { name: string }[] } | null {
  const engine = (window as unknown as {
    __bichitos_mm_engine?: {
      load_model_step?: { get_pre_rigged_skeleton?: () => { bones: { name: string }[] } | null };
    };
  }).__bichitos_mm_engine;
  return engine?.load_model_step?.get_pre_rigged_skeleton?.() ?? null;
}

// ---------------------------------------------------------------------------
// Load flow — wires into mesh2motion's existing #load-model-button path
// ---------------------------------------------------------------------------

function loadCritter(critter: RosterEntry): void {
  const modelSelect = document.querySelector<HTMLSelectElement>('#model-selection');
  const loadButton = document.querySelector<HTMLButtonElement>('#load-model-button');

  if (!modelSelect || !loadButton) {
    console.warn('[BichitosRosterPicker] mesh2motion DOM not ready yet');
    return;
  }

  const url = critterGlbUrl(critter.id);

  // Ensure there's an <option> for this critter. If the user re-clicks
  // the same card, the option is reused instead of duplicated.
  let option = Array.from(modelSelect.options).find((o) => o.value === url);
  if (!option) {
    option = document.createElement('option');
    option.value = url;
    option.textContent = `${critter.name} (Bichitos)`;
    modelSelect.appendChild(option);
  }
  modelSelect.value = url;

  // [BICHITOS-FORK] Normal MM flow — user goes through LoadSkeleton +
  // EditSkeleton like any other import. A "Use model's existing rig"
  // button we inject into the Edit Skeleton tools lets the user opt in
  // to the pre-rigged path (skip bind, jump to AnimationsListing with
  // bone pairing) when they want to. This keeps the lab predictable:
  // rotate/scale/show-skeleton all work in their normal context, and
  // the bone-pairing panel only appears after explicit opt-in.

  // Trigger mesh2motion's normal load path.
  loadButton.click();
  console.log(`[BichitosRosterPicker] loading ${critter.name} (${url}), suggested rig: ${critter.suggestedRig}`);

  currentCritter = critter;
  markActiveCard(critter.id);

  // The skeleton dropdown gets populated asynchronously once the model
  // lands on the skeleton-selection step. We watch for it and preselect
  // the suggested rig when it appears. (No-op when pre-rigged path took
  // over, since Skeleton step is skipped.)
  preselectSkeletonWhenReady(critter.suggestedRig);
}

function preselectSkeletonWhenReady(rig: RosterEntry['suggestedRig']): void {
  const start = performance.now();
  const TIMEOUT_MS = 8000;

  const tryPick = (): boolean => {
    const skeletonSelect = document.querySelector<HTMLSelectElement>('#skeleton-selection');
    if (!skeletonSelect) return false;

    const options = Array.from(skeletonSelect.options).map((o) => o.value);
    if (!options.includes(rig)) return false;

    skeletonSelect.value = rig;
    skeletonSelect.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(`[BichitosRosterPicker] preselected skeleton: ${rig}`);
    return true;
  };

  const tick = (): void => {
    if (tryPick()) return;
    if (performance.now() - start > TIMEOUT_MS) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Export filename override + instructions toast
// ---------------------------------------------------------------------------

function attachExportHandlers(): void {
  const hiddenLink = document.querySelector<HTMLAnchorElement>('#download-hidden-link');
  if (!hiddenLink) {
    requestAnimationFrame(attachExportHandlers);
    return;
  }

  // Mesh2Motion's export path does, in order:
  //   1. generate the GLB ArrayBuffer via GLTFExporter.parse (async).
  //   2. `link.href = URL.createObjectURL(blob)`
  //   3. `link.download = 'exported_model.glb'`
  //   4. `link.click()`
  // A click listener registered here fires during the event target phase
  // (before the browser's default download action on an <a>). We
  // overwrite `download` at that point, so the save dialog offers the
  // game-ready filename instead of the generic one.
  hiddenLink.addEventListener('click', () => {
    if (currentCritter) {
      hiddenLink.download = `${currentCritter.id}.glb`;
    }
  });

  // After the click propagates + the browser kicks off the download, pop
  // the toast telling the user where the file needs to live in the game
  // repo. Using a listener on the upstream #export-button so we don't
  // depend on a specific async timing from the GLB exporter.
  const exportButton = document.querySelector<HTMLButtonElement>('#export-button');
  if (exportButton) {
    exportButton.addEventListener('click', () => {
      if (!currentCritter) return;
      // The export is async; the actual file save happens later. We wait
      // a short moment so the toast feels like a confirmation of the
      // download, not a click feedback.
      setTimeout(() => showExportToast(currentCritter!), 600);
    });
  }
}

function showExportToast(critter: RosterEntry): void {
  let toast = document.getElementById('bichitos-export-toast') as HTMLDivElement | null;
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bichitos-export-toast';
    document.body.appendChild(toast);
  }

  toast.innerHTML =
    `<strong>${critter.name} exported.</strong><br>` +
    `Save this file as <code>public/models/critters/${critter.id}.glb</code> ` +
    `in the game repo. Reloading the game picks up the clips automatically.`;

  // Force reflow so class toggle re-triggers animation if re-shown fast.
  void toast.offsetWidth;
  toast.classList.add('visible');
  window.clearTimeout((showExportToast as unknown as { _timer?: number })._timer ?? 0);
  (showExportToast as unknown as { _timer?: number })._timer = window.setTimeout(() => {
    toast?.classList.remove('visible');
  }, 6000);
}

// ---------------------------------------------------------------------------
// Boot — insert the panel once the load-model tools are in the DOM
// ---------------------------------------------------------------------------

function boot(): void {
  const loadModelTools = document.getElementById('load-model-tools');
  if (!loadModelTools) {
    requestAnimationFrame(boot);
    return;
  }
  if (document.getElementById('bichitos-roster-panel')) return;

  injectStyles();
  const panel = buildPanel();
  loadModelTools.parentNode?.insertBefore(panel, loadModelTools);

  const pairingPanel = buildBonePairingPanel();
  loadModelTools.parentNode?.insertBefore(pairingPanel, loadModelTools);

  injectUseExistingRigButton();

  attachExportHandlers();

  // Hook into the pre-rigged load event so the pairing panel re-renders
  // its rows with the new critter's bone list every time a card is
  // clicked. Poll for the engine until ready (script loads in parallel
  // with CustomModelUploadBootstrap).
  const wireEngineListener = (): void => {
    const engine = (window as unknown as {
      __bichitos_mm_engine?: {
        load_model_step?: {
          addEventListener?: (ev: string, cb: () => void) => void;
          get_pre_rigged_skeleton?: () => { bones: { name: string }[] } | null;
        };
      };
    }).__bichitos_mm_engine;
    if (!engine?.load_model_step?.addEventListener) {
      setTimeout(wireEngineListener, 100);
      return;
    }
    engine.load_model_step.addEventListener('modelLoadedPreRigged', () => {
      const skel = engine.load_model_step?.get_pre_rigged_skeleton?.();
      if (skel) renderBonePairingRows(skel);
    });
    engine.load_model_step.addEventListener('modelLoaded', () => {
      // Regular (non-pre-rigged) load → hide the pairing panel.
      hideBonePairingPanel();
    });
  };
  wireEngineListener();

  console.log('[BichitosRosterPicker] mounted');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
