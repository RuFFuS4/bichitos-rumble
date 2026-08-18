// ---------------------------------------------------------------------------
// apply-ui — shared "Apply to source" flow for the three labs
// ---------------------------------------------------------------------------
//
// H3 slice 4. One function, `applyPatchToSource(patch, hooks)`:
//
//   1. POST the patch to the dev server's /__tool-patch/preview.
//   2. Render the returned diff in a BLOCKING modal (nothing is written
//      until the user confirms — the diff is the review step).
//   3. On confirm: `hooks.onBeforeApply()` runs FIRST (labs clear their
//      localStorage working copy here — the file write triggers a Vite
//      full-reload whose timing races the HTTP response, so cleanup
//      must happen before the write, with `hooks.onApplyFailed()` as
//      the restore path if the apply errors out).
//   4. POST to /__tool-patch/apply. On success the page reloads by
//      itself (HMR full-reload on the changed source file) and the lab
//      boots from the freshly-authored code.
//
// The endpoints only exist on the dev server (plugin `apply: 'serve'`);
// in a production build the fetch 404s and the modal explains that.
// ---------------------------------------------------------------------------

import type { ToolPatch } from './tool-storage';

interface DiffLine { kind: 'add' | 'del' | 'ctx' | 'sep'; text: string }

interface PreviewResponse {
  ok: boolean;
  target?: string;
  changed?: boolean;
  diff?: DiffLine[];
  errors?: string[];
}

export interface ApplyHooks {
  /** Clear the lab's localStorage working copy for the entities in the
   *  patch. Runs BEFORE the write (see header). */
  onBeforeApply: () => void;
  /** Restore the working copy if the apply request failed. */
  onApplyFailed: () => void;
}

/** Run the preview → confirm → apply flow. Resolves true if the file
 *  was written (a full page reload is then imminent). */
export async function applyPatchToSource(patch: ToolPatch, hooks: ApplyHooks): Promise<boolean> {
  let preview: PreviewResponse;
  try {
    const res = await fetch('/__tool-patch/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.status === 404) {
      await showMessageModal('Apply to source', [
        'The apply endpoint only exists on the DEV server (`npm run dev`).',
        'In a build, export the JSON patch and run `npm run apply-tool-patch`.',
      ]);
      return false;
    }
    preview = (await res.json()) as PreviewResponse;
  } catch {
    await showMessageModal('Apply to source', ['Could not reach the dev server. Is `npm run dev` running?']);
    return false;
  }

  if (!preview.ok) {
    await showMessageModal('Patch rejected', preview.errors ?? ['unknown error']);
    return false;
  }
  if (!preview.changed) {
    await showMessageModal('Nothing to apply', ['The patch matches the source — no changes.']);
    return false;
  }

  const confirmed = await showDiffModal(preview.target ?? '(target)', preview.diff ?? []);
  if (!confirmed) return false;

  hooks.onBeforeApply();
  try {
    const res = await fetch('/__tool-patch/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = (await res.json()) as PreviewResponse & { written?: boolean };
    if (!body.ok) {
      hooks.onApplyFailed();
      await showMessageModal('Apply failed', body.errors ?? ['unknown error']);
      return false;
    }
    // Success: the source file just changed on disk — Vite is about to
    // full-reload this page. Show a passive note in case the reload
    // takes a beat; no interaction needed.
    showToast(`Applied to ${body.target} — reloading…`);
    return true;
  } catch {
    hooks.onApplyFailed();
    await showMessageModal('Apply failed', ['Request failed mid-flight. The working copy was restored.']);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Modal + toast (no dependencies, lab-theme colours inline)
// ---------------------------------------------------------------------------

const COLORS = {
  bg: '#12131a',
  panel: '#1a1d29',
  border: '#2a2f3d',
  text: '#e0e4ee',
  dim: '#8a90a3',
  accent: '#ffdc5c',
  add: '#43c56b',
  del: '#e74c3c',
};

function buildOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(6,7,12,0.72)',
    'display:flex', 'align-items:center', 'justify-content:center',
  ].join(';');
  return overlay;
}

function buildPanel(maxWidth: string): HTMLDivElement {
  const panel = document.createElement('div');
  panel.style.cssText = [
    `background:${COLORS.panel}`, `color:${COLORS.text}`,
    `border:1px solid ${COLORS.border}`, 'border-radius:8px',
    `max-width:${maxWidth}`, 'width:calc(100vw - 48px)', 'max-height:80vh',
    'display:flex', 'flex-direction:column', 'padding:16px 18px',
    'font-family:ui-monospace,Consolas,monospace', 'font-size:12px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
  ].join(';');
  return panel;
}

function buildButton(label: string, primary: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = [
    'padding:6px 16px', 'border-radius:5px', 'cursor:pointer',
    'font-family:inherit', 'font-size:12px', 'font-weight:600',
    primary
      ? `background:${COLORS.accent};color:#1a1400;border:1px solid ${COLORS.accent}`
      : `background:transparent;color:${COLORS.text};border:1px solid ${COLORS.border}`,
  ].join(';');
  return b;
}

/** Blocking diff modal. Resolves true on Confirm, false on Cancel/Esc. */
function showDiffModal(target: string, diff: DiffLine[]): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const overlay = buildOverlay();
    const panel = buildPanel('760px');

    const title = document.createElement('div');
    title.innerHTML = `<strong style="color:${COLORS.accent}">Apply to source</strong> — <span style="color:${COLORS.dim}">${escapeText(target)} (nothing is written until you confirm)</span>`;
    title.style.cssText = 'margin-bottom:10px;font-size:13px';
    panel.appendChild(title);

    const box = document.createElement('pre');
    box.style.cssText = [
      `background:${COLORS.bg}`, `border:1px solid ${COLORS.border}`,
      'border-radius:6px', 'padding:10px 12px', 'overflow:auto',
      'flex:1', 'margin:0 0 12px', 'line-height:1.45', 'white-space:pre',
    ].join(';');
    for (const line of diff) {
      const row = document.createElement('div');
      if (line.kind === 'add') { row.style.color = COLORS.add; row.textContent = `+ ${line.text}`; }
      else if (line.kind === 'del') { row.style.color = COLORS.del; row.textContent = `- ${line.text}`; }
      else if (line.kind === 'sep') { row.style.color = COLORS.dim; row.textContent = `  ${line.text}`; }
      else { row.style.color = COLORS.dim; row.textContent = `  ${line.text}`; }
      box.appendChild(row);
    }
    panel.appendChild(box);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
    const cancel = buildButton('Cancel', false);
    const confirm = buildButton('Apply to source', true);
    buttons.appendChild(cancel);
    buttons.appendChild(confirm);
    panel.appendChild(buttons);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = (result: boolean) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolvePromise(result);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
  });
}

/** Simple blocking message modal with an OK button. */
function showMessageModal(titleText: string, lines: string[]): Promise<void> {
  return new Promise((resolvePromise) => {
    const overlay = buildOverlay();
    const panel = buildPanel('520px');
    const title = document.createElement('div');
    title.innerHTML = `<strong style="color:${COLORS.accent}">${escapeText(titleText)}</strong>`;
    title.style.cssText = 'margin-bottom:8px;font-size:13px';
    panel.appendChild(title);
    for (const l of lines) {
      const p = document.createElement('div');
      p.textContent = l;
      p.style.cssText = `color:${COLORS.text};margin-bottom:4px`;
      panel.appendChild(p);
    }
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:flex-end;margin-top:10px';
    const ok = buildButton('OK', true);
    buttons.appendChild(ok);
    panel.appendChild(buttons);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    ok.addEventListener('click', () => { overlay.remove(); resolvePromise(); });
  });
}

function showToast(text: string): void {
  const t = document.createElement('div');
  t.textContent = text;
  t.style.cssText = [
    'position:fixed', 'bottom:18px', 'left:50%', 'transform:translateX(-50%)',
    `background:${COLORS.accent}`, 'color:#1a1400', 'font-weight:600',
    'padding:8px 18px', 'border-radius:6px', 'z-index:99999',
    'font-family:ui-monospace,Consolas,monospace', 'font-size:12px',
  ].join(';');
  document.body.appendChild(t);
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
