// ---------------------------------------------------------------------------
// Navegador de pruebas — SIEMPRE MUDO
// ---------------------------------------------------------------------------
//
// Directiva de Rafa (2026-09-07): "cuando lances instancias para las
// pruebas silencia la música y sonidos". Las tandas de agentes abren
// muchas instancias del juego a la vez (capturas, batch runner, campañas
// de Playwright) y cada una arrancaba su música y sus efectos.
//
// Se silencia por DOS vías, a propósito, porque cada una tapa un agujero
// de la otra:
//
//   1. `--mute-audio` en el proceso de Chromium: corta el audio aunque el
//      juego cambie, aunque alguien añada un <audio> nuevo o aunque la
//      instancia se abra en modo headed para mirarla.
//   2. Las banderas de silencio del propio juego en localStorage, puestas
//      ANTES de que cargue nada (`addInitScript`): así el juego no llega
//      ni a crear los nodos de audio, y los botones del HUD aparecen ya
//      en estado "mudo" en las capturas — que es como Rafa quiere verlas.
//
// Las claves son las de `src/audio.ts` (STORAGE_KEY_SFX / STORAGE_KEY_MUSIC).
// Si allí cambian, aquí también: hay un test que lo comprueba.
// ---------------------------------------------------------------------------

import { chromium } from '@playwright/test';

/** Claves de silencio de src/audio.ts. */
export const MUTE_STORAGE_KEYS = {
  sfx: 'bichitos.sfxMuted',
  music: 'bichitos.musicMuted',
};

/** Argumentos de Chromium para que una instancia de pruebas no suene. */
export const MUTE_ARGS = ['--mute-audio'];

/**
 * Lanza Chromium para pruebas. Mismo `options` que `chromium.launch`, con
 * el silencio añadido (y sin pisar otros `args` que pase quien llama).
 */
export async function launchMutedBrowser(options = {}) {
  const { args = [], ...rest } = options;
  return chromium.launch({
    headless: true,
    ...rest,
    args: [...MUTE_ARGS, ...args],
  });
}

/**
 * Deja una página (o un contexto) muda desde antes del primer script del
 * juego. Llamar justo después de crearla y ANTES del primer `goto`.
 */
export async function muteGameAudio(pageOrContext) {
  await pageOrContext.addInitScript((keys) => {
    try {
      localStorage.setItem(keys.sfx, '1');
      localStorage.setItem(keys.music, '1');
    } catch {
      // localStorage puede fallar en contextos restringidos; el
      // --mute-audio del proceso sigue cubriendo el caso.
    }
  }, MUTE_STORAGE_KEYS);
}

/** Atajo: navegador mudo + página muda, que es el 90 % de los usos. */
export async function newMutedPage(browser, contextOptions = {}) {
  const page = await browser.newPage(contextOptions);
  await muteGameAudio(page);
  return page;
}
