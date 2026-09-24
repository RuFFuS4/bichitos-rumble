// ---------------------------------------------------------------------------
// i18n de contenido de juego (src/i18n.ts CONTENT_ES) — cobertura
// ---------------------------------------------------------------------------
// El rol, el lema y las descripciones de habilidad viven en inglés en el
// código de PERSONAJES y se traducen por el texto fuente. Si alguien añade o
// cambia una frase allí, la traducción deja de casar y el juego enseña el
// inglés con la interfaz en castellano: este test lo caza y dice cuál falta.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { CRITTER_ABILITIES } from '../../src/abilities';
import { getDisplayRoster } from '../../src/roster';
import { CONTENT_ES } from '../../src/i18n';

/** Todas las frases de contenido que enseña la selección de bicho. */
function contentSources(): string[] {
  const out = new Set<string>();
  for (const entry of getDisplayRoster()) {
    if (entry.status === 'locked') continue; // la parrilla no enseña su ficha
    out.add(entry.role);
    out.add(entry.tagline);
    // Same rule as character-select.ts paintInfoPane: the real kit when the
    // critter has one; the roster's planned abilities only otherwise.
    const kit = CRITTER_ABILITIES[entry.displayName];
    if (kit) for (const def of kit) out.add(def.description);
    else for (const planned of entry.plannedAbilities ?? []) out.add(planned.description);
  }
  return [...out].filter(Boolean);
}

describe('i18n content (ES)', () => {
  it('every role, tagline and ability description has a Spanish translation', () => {
    const missing = contentSources().filter((s) => !(s in CONTENT_ES));
    expect(missing, `sin traducir en src/i18n.ts CONTENT_ES:\n${missing.join('\n')}`).toEqual([]);
  });

  it('no stale translations (source text no longer in the game)', () => {
    const live = new Set(contentSources());
    const stale = Object.keys(CONTENT_ES).filter((s) => !live.has(s));
    expect(stale, `traducciones sin texto fuente (PERSONAJES cambió la frase):\n${stale.join('\n')}`).toEqual([]);
  });
});
