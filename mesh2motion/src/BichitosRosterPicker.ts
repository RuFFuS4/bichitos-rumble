// ---------------------------------------------------------------------------
// Bichitos Rumble roster picker — custom UI layer on top of mesh2motion-app
// ---------------------------------------------------------------------------
//
// Replaces the need to upload a file for each of our 9 playable critters.
// Renders a grid of critter cards above mesh2motion's "load model" step;
// clicking a card preloads that critter's GLB and preselects the
// suggested skeleton type (user can override).
//
// How it integrates:
//   - mesh2motion's StepLoadModel binds a 'click' handler to
//     #load-model-button that reads `#model-selection.value` and calls
//     load_model_file(value, extension). We piggyback on that by:
//       1. Adding a new <option> to #model-selection pointing at our
//          critter's GLB URL.
//       2. Setting that option as the current value.
//       3. Dispatching a click on #load-model-button.
//   - When mesh2motion progresses to the skeleton step and populates
//     #skeleton-selection, we observe that and pre-pick the suggested
//     rig so the user sees our recommendation already selected.
//
// Zero modifications to mesh2motion internals. This file can be removed
// at any time and mesh2motion keeps working as upstream.
// ---------------------------------------------------------------------------

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

// Order chosen so the critters whose rigs match well come first — gives
// the user a natural sequence to work through.
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

// Resolution of the critter GLB URL. Using an absolute path works in
// production (Vercel serves public/models/critters/ at /models/critters/
// alongside /animations/*) AND in mesh2motion's dev server because the
// predev copy-game-assets script mirrors them into static/models/critters/.
function critterGlbUrl(id: string): string {
  return `models/critters/${id}.glb`;
}

// ---------------------------------------------------------------------------
// Panel construction
// ---------------------------------------------------------------------------

const PANEL_CSS = `
#bichitos-roster-panel {
  background: rgba(231, 76, 60, 0.06);
  border: 1px solid rgba(231, 76, 60, 0.35);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0 0 12px 0;
  font-family: 'Segoe UI', Arial, sans-serif;
  color: inherit;
}
#bichitos-roster-panel h3 {
  margin: 0 0 6px 0;
  font-size: 12px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #ffbbb2;
  font-weight: 700;
}
#bichitos-roster-panel .subtitle {
  font-size: 10px;
  opacity: 0.7;
  margin-bottom: 10px;
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
  padding: 8px 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: transform 0.12s, border-color 0.12s, background 0.12s;
  color: inherit;
  font: inherit;
}
.bichitos-critter-card:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 220, 92, 0.55);
  transform: translateY(-1px);
}
.bichitos-critter-card .dot {
  width: 20px;
  height: 20px;
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
  title.textContent = 'Bichitos Rumble roster';
  panel.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'subtitle';
  subtitle.textContent = 'Click a critter to load its GLB and preselect the suggested skeleton.';
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

  // Ensure there's an <option> for this critter. If the user clicks the
  // card multiple times, the option gets reused.
  let option = Array.from(modelSelect.options).find(o => o.value === url);
  if (!option) {
    option = document.createElement('option');
    option.value = url;
    option.textContent = `${critter.name} (Bichitos)`;
    modelSelect.appendChild(option);
  }
  modelSelect.value = url;

  // Trigger mesh2motion's normal load path.
  loadButton.click();
  console.log(`[BichitosRosterPicker] loading ${critter.name} (${url}), suggested rig: ${critter.suggestedRig}`);

  // The skeleton dropdown gets populated asynchronously once the model
  // lands on the skeleton-selection step. We watch for it and preselect
  // the suggested rig when it appears.
  preselectSkeletonWhenReady(critter.suggestedRig);
}

function preselectSkeletonWhenReady(rig: RosterEntry['suggestedRig']): void {
  const start = performance.now();
  const TIMEOUT_MS = 8000;

  const tryPick = (): boolean => {
    const skeletonSelect = document.querySelector<HTMLSelectElement>('#skeleton-selection');
    if (!skeletonSelect) return false;

    const options = Array.from(skeletonSelect.options).map(o => o.value);
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
// Boot — insert the panel once the load-model tools are in the DOM
// ---------------------------------------------------------------------------

function boot(): void {
  const loadModelTools = document.getElementById('load-model-tools');
  if (!loadModelTools) {
    // mesh2motion hasn't mounted yet — retry next frame.
    requestAnimationFrame(boot);
    return;
  }

  // Only mount once.
  if (document.getElementById('bichitos-roster-panel')) return;

  injectStyles();
  const panel = buildPanel();
  // Insert BEFORE the load-model-tools so the roster is the first thing
  // the user sees on the create page.
  loadModelTools.parentNode?.insertBefore(panel, loadModelTools);
  console.log('[BichitosRosterPicker] mounted');
}

// Kick off after DOM ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
