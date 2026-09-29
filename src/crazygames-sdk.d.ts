// Minimal types of the CrazyGames HTML5 SDK v3 — only what
// src/platform-crazygames.ts uses. There is no npm package nor official
// typings: the SDK is a script from their CDN, loaded only by the
// CrazyGames build (docs/H5_CRAZYGAMES.md, https://docs.crazygames.com/sdk/).

interface CrazyGamesAdError {
  /** adsDisabledBasicLaunch | unfilled | adblock | adCooldown | other */
  code: string;
  message?: string;
}

interface CrazyGamesSettings {
  muteAudio: boolean;
  disableChat?: boolean;
}

interface CrazyGamesSDK {
  init(): Promise<void>;
  /** 'local' on localhost (demo ads), 'crazygames' on their domains,
   *  'disabled' anywhere else (every call throws). */
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    settings: CrazyGamesSettings;
    addSettingsChangeListener(listener: (settings: CrazyGamesSettings) => void): void;
  };
  ad: {
    requestAd(
      type: 'midgame' | 'rewarded',
      callbacks: {
        adStarted?: () => void;
        adFinished?: () => void;
        adError?: (error: CrazyGamesAdError) => void;
      },
    ): void;
  };
}

interface Window {
  CrazyGames?: { SDK: CrazyGamesSDK };
}
