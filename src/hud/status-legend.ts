// ---------------------------------------------------------------------------
// Status legend — always-available "?" button + popup
// ---------------------------------------------------------------------------
//
// Players see emoji status icons floating above critters during a match
// (frozen ❄️, stunned 💫, etc.) and we needed a way to explain what each
// glyph means without:
//   · using the pause menu (online matches don't pause),
//   · stealing the P key (already wired to the Vibe Jam portal panel),
//   · cluttering the HUD permanently.
//
// Solution: a small "?" button injected into the existing `#hud-settings`
// group (top-right of the screen, next to portal/sfx/music). Clicking it
// toggles a popup with the icon catalogue + short descriptions. Clicking
// outside the popup, or hitting the button again, closes it. Pure DOM,
// no Three.js, no framework — fits the rest of the HUD pattern.
//
// Public surface:
//   initStatusLegend()  — wires the button + popup into the page once
// ---------------------------------------------------------------------------

interface LegendEntry {
  icon: string;
  name: string;
  desc: string;
}

const ENTRIES: readonly LegendEntry[] = [
  { icon: '❄️', name: 'Frozen',      desc: 'Hit by snowball — slowed and chilled.' },
  { icon: '🐌', name: 'Slowed',      desc: 'Movement reduced (e.g. quicksand).' },
  { icon: '☠️', name: 'Poisoned',    desc: 'Toxic cloud — slowed + limited vision.' },
  { icon: '💫', name: 'Stunned',     desc: 'Cannot move for a brief window.' },
  { icon: '💥', name: 'Vulnerable',  desc: 'Hits land twice as hard.' },
  { icon: '🛡️', name: 'Steel Shell', desc: 'Invulnerable and anchored to the ground.' },
  { icon: '🔥', name: 'Frenzy',      desc: 'Temporarily faster and heavier.' },
  { icon: '👻', name: 'Ghost',       desc: 'Decoy / invisibility trick — bots lose track.' },
];

let initialised = false;

function injectStyles(): void {
  if (document.getElementById('status-legend-style')) return;
  const style = document.createElement('style');
  style.id = 'status-legend-style';
  style.textContent = `
    #btn-status-legend.settings-btn[aria-expanded="true"] {
      background: rgba(255, 255, 255, 0.22);
      border-color: rgba(255, 255, 255, 0.55);
    }
    /* The button lives inside #hud-settings (top-left of the
       screen, after portal/sfx/music). Anchor the popup right
       below it so the connection is obvious — top-left, not the
       opposite corner. */
    #status-legend-popup {
      position: fixed;
      top: 56px;
      left: 12px;
      width: 290px;
      max-width: calc(100vw - 24px);
      max-height: calc(100vh - 80px);
      overflow: auto;
      padding: 12px 14px 14px 14px;
      background: rgba(18, 22, 28, 0.92);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
      color: #f1f1f1;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.35;
      z-index: 30;
      pointer-events: auto;
      transition: opacity 0.15s ease-out, transform 0.15s ease-out;
      transform-origin: top left;
    }
    #status-legend-popup[hidden] {
      display: none;
    }
    #status-legend-popup h3 {
      margin: 0 0 8px 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #f5d27a;
    }
    #status-legend-popup ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
    }
    #status-legend-popup li {
      display: grid;
      grid-template-columns: 26px 1fr;
      align-items: start;
      gap: 8px;
      padding: 4px 0;
      border-top: 1px dashed rgba(255, 255, 255, 0.10);
    }
    #status-legend-popup li:first-child {
      border-top: none;
      padding-top: 0;
    }
    #status-legend-popup .legend-icon {
      font-size: 18px;
      line-height: 1;
      text-align: center;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }
    #status-legend-popup .legend-name {
      font-weight: 600;
      color: #ffffff;
      margin-right: 4px;
    }
    #status-legend-popup .legend-desc {
      color: rgba(241, 241, 241, 0.78);
      font-size: 12px;
    }
    /* Hover hint on desktop only — coarse pointers (touch) skip this so
       the popup doesn't open just from accidental finger drags. */
    @media (hover: hover) and (pointer: fine) {
      #btn-status-legend:hover + #status-legend-popup[data-hover-enabled="true"] {
        display: block !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function buildPopup(): HTMLDivElement {
  const popup = document.createElement('div');
  popup.id = 'status-legend-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Status effects legend');
  popup.hidden = true;

  const title = document.createElement('h3');
  title.textContent = 'Status effects';
  popup.appendChild(title);

  const list = document.createElement('ul');
  for (const e of ENTRIES) {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'legend-icon';
    icon.textContent = e.icon;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'legend-name';
    name.textContent = e.name;
    const desc = document.createElement('span');
    desc.className = 'legend-desc';
    desc.textContent = ' — ' + e.desc;
    text.appendChild(name);
    text.appendChild(desc);
    li.appendChild(icon);
    li.appendChild(text);
    list.appendChild(li);
  }
  popup.appendChild(list);
  return popup;
}

/**
 * Wire the "?" button into `#hud-settings` and the popup into <body>.
 * Idempotent — safe to call from multiple init paths.
 */
export function initStatusLegend(): void {
  if (initialised) return;
  initialised = true;

  injectStyles();

  const settings = document.getElementById('hud-settings');
  if (!settings) {
    console.warn('[status-legend] #hud-settings not found — skipping legend init');
    return;
  }

  // Button — share the same `.settings-btn` class as the existing
  // portal/sfx/music triplet so the visual rhythm stays consistent.
  const btn = document.createElement('button');
  btn.id = 'btn-status-legend';
  btn.className = 'settings-btn';
  btn.title = 'Status effects';
  btn.setAttribute('aria-label', 'Show status effects legend');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'status-legend-popup');
  btn.textContent = '❓';
  // Keep keyboard input focused on gameplay — clicking the button
  // shouldn't steal focus and let the next Space/Enter tap the
  // button instead of triggering a headbutt.
  btn.addEventListener('mousedown', (ev) => ev.preventDefault());
  settings.appendChild(btn);

  const popup = buildPopup();
  document.body.appendChild(popup);

  function setOpen(open: boolean): void {
    popup.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setOpen(popup.hidden);
  });

  // Click anywhere outside the popup (and outside the button) closes it.
  document.addEventListener('click', (ev) => {
    if (popup.hidden) return;
    const target = ev.target as Node | null;
    if (!target) return;
    if (popup.contains(target) || btn.contains(target)) return;
    setOpen(false);
  });

  // Esc to close — keeps the panel feeling like a real dialog.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !popup.hidden) {
      setOpen(false);
    }
  });
}
