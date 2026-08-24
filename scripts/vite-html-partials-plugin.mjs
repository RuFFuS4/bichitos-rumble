// ---------------------------------------------------------------------------
// vite-html-partials-plugin — single-source HTML fragments for the entries
// ---------------------------------------------------------------------------
//
// Afilado pick 5. index.html and tools.html used to each carry a hand-synced
// copy of the in-match HUD (CSS + markup) and diverged three times. This
// plugin lets any HTML entry pull a shared fragment with a token:
//
//   <!-- @partial:hud -->   →  replaced with src/hud/hud.partial.html
//
// Runs on transformIndexHtml with order 'pre', so the injected markup goes
// through the rest of Vite's HTML pipeline (asset rewriting, minification)
// exactly as if it had been written inline in the entry.
//
// Refuse-to-guess:
//   · token names a partial not in PARTIALS      → hard build error
//   · token's partial file is missing/unreadable → hard build error
//   · a partial exists but no entry references it → fine, nothing happens
//
// Dev ergonomics: the partial files are added to the dev server's watcher;
// editing one triggers a full-reload so the change shows up like an edit
// to the entry itself would.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Registry of known partials — token name → path relative to project root. */
const PARTIALS = {
  hud: 'src/hud/hud.partial.html',
};

/** Matches `<!-- @partial:NAME -->` (whitespace-tolerant). */
const TOKEN_RE = /<!--\s*@partial:([\w-]+)\s*-->/g;

/**
 * Post-injection sanity check: every `<!--` in the final HTML must have
 * a later `-->`. An unclosed comment doesn't error in the browser — it
 * silently comments out everything to the end of the document, which
 * with injected partials shows up as "half the page is missing" with
 * zero console output. Throwing here turns that into a build error that
 * names the entry and the line of the offending opener.
 */
function assertNoUnclosedComment(html, filename) {
  let idx = 0;
  for (;;) {
    const open = html.indexOf('<!--', idx);
    if (open < 0) return;
    const close = html.indexOf('-->', open + 4);
    if (close < 0) {
      const line = html.slice(0, open).split('\n').length;
      throw new Error(
        `[html-partials] entry "${filename}": unclosed HTML comment after partial injection — `
        + `"<!--" opened at line ${line} has no matching "-->". `
        + 'Check the injected partial files (and the entry itself) for a comment that never closes.',
      );
    }
    idx = close + 3;
  }
}

export function htmlPartialsPlugin() {
  /** Project root — set once config is resolved. */
  let root = process.cwd();

  const resolvePartial = (name) => {
    const rel = PARTIALS[name];
    if (!rel) {
      throw new Error(
        `[html-partials] unknown partial "${name}" — known: ${Object.keys(PARTIALS).join(', ')}. `
        + 'Register it in scripts/vite-html-partials-plugin.mjs (PARTIALS map).',
      );
    }
    return path.resolve(root, rel);
  };

  return {
    name: 'bichitos-html-partials',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      // Watch every registered partial: editing one must reload the page
      // just like editing the entry HTML would. `add` is idempotent.
      for (const rel of Object.values(PARTIALS)) {
        server.watcher.add(path.resolve(root, rel));
      }
      const partialPaths = new Set(
        Object.values(PARTIALS).map((rel) => path.resolve(root, rel)),
      );
      server.watcher.on('change', (file) => {
        if (partialPaths.has(path.resolve(file))) {
          server.config.logger.info(`[html-partials] ${path.relative(root, file)} changed — full reload`);
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!TOKEN_RE.test(html)) return html;
        TOKEN_RE.lastIndex = 0;
        const out = html.replace(TOKEN_RE, (_match, name) => {
          const abs = resolvePartial(name);
          let content;
          try {
            content = readFileSync(abs, 'utf8');
          } catch {
            throw new Error(
              `[html-partials] entry "${ctx.filename}" references partial "${name}" `
              + `but its file is missing: ${path.relative(root, abs)}`,
            );
          }
          return content;
        });
        // Review 2026-08-24 (diferido): un `<!--` sin `-->` posterior en
        // el HTML resultante haría que el navegador se tragase EN
        // SILENCIO todo el resto del documento (típicamente un partial
        // que abre un comentario y no lo cierra). Error de build claro
        // en vez de una página medio vacía imposible de diagnosticar.
        assertNoUnclosedComment(out, ctx.filename ?? '(unknown entry)');
        return out;
      },
    },
  };
}
