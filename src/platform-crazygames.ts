// ---------------------------------------------------------------------------
// Platform backend: CrazyGames (HTML5 SDK v3) — only in the CrazyGames build
// ---------------------------------------------------------------------------
//
// src/platform.ts imports this dynamically when VITE_PLATFORM is
// 'crazygames', so the own site and itch never download it. The SDK script
// itself is injected by vite.config.ts in that build mode only. Rules
// followed here (https://docs.crazygames.com/requirements/ads/):
//   - mute only when the ad really starts (adStarted), not on the request;
//   - the game goes on after adFinished or adError (unfilled, adblock,
//     cooldown, ads disabled in Basic Launch...), or after a timeout if the
//     SDK never answers — it must never stay stuck;
//   - settings.muteAudio overrides the game's own sound toggle.
// ---------------------------------------------------------------------------

import {
  MIDGAME_START_TIMEOUT_MS, MIDGAME_PLAY_TIMEOUT_MS,
  type PlatformBackend, type PlatformHooks,
} from './platform';

/** The backend, or null when the SDK is unusable: missing (an adblocker
 *  blocked the script), init failed, or not on a CrazyGames domain. */
export async function createCrazyGamesBackend(hooks: PlatformHooks): Promise<PlatformBackend | null> {
  const sdk = window.CrazyGames?.SDK;
  if (!sdk) {
    hooks.log('sdk missing');
    return null;
  }
  try {
    await sdk.init();
  } catch (err) {
    hooks.log(`sdk init failed: ${err}`);
    return null;
  }
  hooks.log(`sdk environment ${sdk.environment}`);
  if (sdk.environment === 'disabled') return null;

  hooks.mute('platform', !!sdk.game.settings?.muteAudio);
  sdk.game.addSettingsChangeListener((settings) => hooks.mute('platform', !!settings.muteAudio));

  return {
    loadingStart: () => sdk.game.loadingStart(),
    loadingStop: () => sdk.game.loadingStop(),
    gameplayStart: () => sdk.game.gameplayStart(),
    gameplayStop: () => sdk.game.gameplayStop(),
    midgame: () => new Promise<string>((resolve) => {
      let settled = false;
      let playTimer = 0;
      const startTimer = window.setTimeout(() => settle('timeout before adStarted'), MIDGAME_START_TIMEOUT_MS);
      /** The game may go on (once). */
      function settle(outcome: string): void {
        if (settled) return;
        settled = true;
        window.clearTimeout(startTimer);
        // The ad took the focus inside CrazyGames' page: give the keyboard back.
        window.focus();
        resolve(outcome);
      }
      /** The ad is over, or given up on: the sound comes back. */
      function adOver(): void {
        window.clearTimeout(playTimer);
        hooks.mute('ad', false);
      }
      try {
        sdk.ad.requestAd('midgame', {
          adStarted: () => {
            // After the start cap the game already went on: the ad covers
            // it, so at least it plays silent and gets its sound back when
            // the ad ends (docs/H5_CRAZYGAMES.md §«Sin verificar»).
            if (settled) hooks.log('adStarted late: the game already went on');
            window.clearTimeout(startTimer);
            hooks.mute('ad', true);
            playTimer = window.setTimeout(() => { adOver(); settle('timeout before adFinished'); }, MIDGAME_PLAY_TIMEOUT_MS);
          },
          adFinished: () => { adOver(); settle('finished'); },
          adError: (error) => { adOver(); settle(`error ${error?.code ?? error}`); },
        });
      } catch (err) {
        settle(`requestAd threw: ${err}`);
      }
    }),
  };
}
