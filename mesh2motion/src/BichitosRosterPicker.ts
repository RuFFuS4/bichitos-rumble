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

  // Trigger mesh2motion's normal load path.
  loadButton.click();
  console.log(`[BichitosRosterPicker] loading ${critter.name} (${url}), suggested rig: ${critter.suggestedRig}`);

  currentCritter = critter;
  markActiveCard(critter.id);

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
  attachExportHandlers();
  console.log('[BichitosRosterPicker] mounted');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
