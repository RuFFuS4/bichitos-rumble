// ---------------------------------------------------------------------------
// Adaptador de plataforma (H5, src/platform.ts + src/platform-crazygames.ts)
// ---------------------------------------------------------------------------
//
// Con un SDK de CrazyGames falso: la cola hasta que init() resuelve, el
// tiempo de partida acumulado (sin la pestaña oculta), el umbral del primer
// anuncio, el silencio (anuncio, también si llega tarde, y ajuste de CG),
// que cualquier error o silencio del SDK deja seguir al juego, y que en la
// web o sin SDK no pasa nada. La build real se
// prueba con scripts/build-crazygames.mjs y scripts/smoke-crazygames.mjs.
// ---------------------------------------------------------------------------

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AdCallbacks = { adStarted?: () => void; adFinished?: () => void; adError?: (e: { code: string }) => void };

function fakeSdk(opts: { environment?: string; muteAudio?: boolean; initFails?: boolean } = {}) {
  const calls: string[] = [];
  const sdk = {
    calls,
    settingsListener: null as null | ((s: { muteAudio: boolean }) => void),
    lastAd: null as null | AdCallbacks,
    environment: opts.environment ?? 'local',
    init: vi.fn(async () => { if (opts.initFails) throw new Error('boom'); calls.push('init'); }),
    game: {
      settings: { muteAudio: !!opts.muteAudio },
      loadingStart: () => calls.push('loadingStart'),
      loadingStop: () => calls.push('loadingStop'),
      gameplayStart: () => calls.push('gameplayStart'),
      gameplayStop: () => calls.push('gameplayStop'),
      addSettingsChangeListener: (l: (s: { muteAudio: boolean }) => void) => { sdk.settingsListener = l; },
    },
    ad: {
      requestAd: (type: string, cb: AdCallbacks) => { calls.push(`requestAd ${type}`); sdk.lastAd = cb; },
    },
  };
  return sdk;
}

/** A fresh platform module, as the given build would see it. `beforeReady`
 *  runs right after initPlatform(), while the SDK is still initialising. */
async function load(
  platformName: string | undefined,
  sdk?: ReturnType<typeof fakeSdk>,
  beforeReady?: (platform: typeof import('../../src/platform')) => void,
) {
  vi.resetModules();
  vi.stubEnv('VITE_PLATFORM', platformName ?? '');
  const classes: string[] = [];
  const doc = {
    hidden: false,
    onVisibility: null as null | (() => void),
    body: { classList: { add: (c: string) => classes.push(c) } },
    addEventListener: (type: string, l: () => void) => { if (type === 'visibilitychange') doc.onVisibility = l; },
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { CrazyGames: sdk ? { SDK: sdk } : undefined, focus: vi.fn(), setTimeout, clearTimeout });
  const platform = await import('../../src/platform');
  const mutes: string[] = [];
  platform.onExternalMute((reason, on) => mutes.push(`${reason} ${on ? 'on' : 'off'}`));
  platform.initPlatform();
  const state = (globalThis.window as unknown as { __platform: { state: { name: string; backend: string; log: string[] } } }).__platform.state;
  beforeReady?.(platform);
  // Let the dynamic import and init() settle.
  await vi.waitFor(() => expect(state.backend).not.toBe('pending'));
  return { platform, state, classes, mutes, doc };
}

/** Lets the gameplay report, sent at the end of the task, go out. */
const endOfTask = () => Promise.resolve();

/** 3 min of match and the break requested: the SDK holds the ad callbacks. */
async function breakAfterAMatch(platform: typeof import('../../src/platform')) {
  platform.gameplay(true);
  vi.advanceTimersByTime(platform.FIRST_MIDGAME_AFTER_GAMEPLAY_MS);
  platform.gameplay(false);
  const done = platform.midgameBreak();
  await vi.advanceTimersByTimeAsync(0);
  return { done }; // wrapped: an async function would wait for it
}

// The first dynamic import of the backend pays Vite's transform: warm it.
beforeAll(async () => { await import('../../src/platform-crazygames'); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('en la web propia (sin VITE_PLATFORM)', () => {
  it('no hace nada: ni clase, ni backend, y el descanso no espera', async () => {
    const sdk = fakeSdk();
    const { platform, state, classes } = await load(undefined, sdk);
    expect(state.name).toBe('web');
    expect(state.backend).toBe('none');
    expect(classes).toEqual([]);
    platform.gameplay(true);
    vi.advanceTimersByTime(10 * 60_000);
    platform.gameplay(false);
    await platform.midgameBreak();
    expect(sdk.calls).toEqual([]);
  });
});

describe('en la build de CrazyGames', () => {
  it('pone la clase y encola lo de antes de init(), en orden', async () => {
    const sdk = fakeSdk();
    const { state, classes } = await load('crazygames', sdk, (platform) => {
      platform.loadingStop();
      expect(sdk.calls).toEqual([]); // nothing reaches the SDK before init()
    });
    expect(classes).toEqual(['platform-crazygames']);
    expect(state.backend).toBe('ready');
    expect(sdk.calls).toEqual(['init', 'loadingStart', 'loadingStop']);
  });

  it('gameplay es idempotente', async () => {
    const sdk = fakeSdk();
    const { platform } = await load('crazygames', sdk);
    platform.gameplay(true);
    platform.gameplay(true);
    await endOfTask();
    platform.gameplay(false);
    platform.gameplay(false);
    await endOfTask();
    expect(sdk.calls.filter((c) => c.startsWith('gameplay'))).toEqual(['gameplayStart', 'gameplayStop']);
  });

  it('un vaivén dentro de la misma tarea no llega a CG (reanudar para reiniciar o salir)', async () => {
    const sdk = fakeSdk();
    const { platform } = await load('crazygames', sdk);
    platform.gameplay(true);
    await endOfTask();
    platform.gameplay(false); // ESC: la pausa
    await endOfTask();
    platform.gameplay(true); // «Reiniciar» quita la pausa...
    platform.gameplay(false); // ...y entra en la cuenta atrás en el mismo clic
    await endOfTask();
    expect(sdk.calls.filter((c) => c.startsWith('gameplay'))).toEqual(['gameplayStart', 'gameplayStop']);
  });

  it('el tiempo con la pestaña oculta no cuenta para el primer anuncio', async () => {
    const sdk = fakeSdk();
    const { platform, doc } = await load('crazygames', sdk);
    platform.gameplay(true);
    vi.advanceTimersByTime(60_000);
    doc.hidden = true;
    doc.onVisibility!();
    vi.advanceTimersByTime(10 * 60_000); // la partida sigue en una pestaña de fondo
    doc.hidden = false;
    doc.onVisibility!();
    vi.advanceTimersByTime(60_000);
    platform.gameplay(false);
    await platform.midgameBreak();
    expect(sdk.calls).not.toContain('requestAd midgame'); // 2 min, no 12
  });

  it('no pide anuncio hasta 3 min de partida acumulada', async () => {
    const sdk = fakeSdk();
    const { platform } = await load('crazygames', sdk);
    platform.gameplay(true);
    vi.advanceTimersByTime(platform.FIRST_MIDGAME_AFTER_GAMEPLAY_MS - 1000);
    platform.gameplay(false);
    await platform.midgameBreak();
    expect(sdk.calls).not.toContain('requestAd midgame');
    // La pantalla final no cuenta: solo el tiempo jugando.
    vi.advanceTimersByTime(10 * 60_000);
    await platform.midgameBreak();
    expect(sdk.calls).not.toContain('requestAd midgame');
    platform.gameplay(true);
    vi.advanceTimersByTime(2000);
    platform.gameplay(false);
    const done = platform.midgameBreak();
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.calls).toContain('requestAd midgame');
    sdk.lastAd!.adError!({ code: 'unfilled' });
    await done;
  });

  it('silencia solo cuando el anuncio empieza, y suelta al acabar', async () => {
    const sdk = fakeSdk();
    const { platform, mutes, state } = await load('crazygames', sdk);
    platform.gameplay(true);
    vi.advanceTimersByTime(platform.FIRST_MIDGAME_AFTER_GAMEPLAY_MS);
    platform.gameplay(false);
    let resolved = false;
    const done = platform.midgameBreak().then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(mutes).toEqual([]);
    sdk.lastAd!.adStarted!();
    expect(mutes).toEqual(['ad on']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolved).toBe(false); // bloqueado mientras se ve
    sdk.lastAd!.adFinished!();
    await done;
    expect(mutes).toEqual(['ad on', 'ad off']);
    expect(state.log.some((l) => l.endsWith('midgame finished'))).toBe(true);
  });

  it.each(['adsDisabledBasicLaunch', 'unfilled', 'adblock', 'adCooldown', 'other'])(
    'con adError %s el juego sigue y sin silencio',
    async (code) => {
      const sdk = fakeSdk();
      const { platform, mutes } = await load('crazygames', sdk);
      platform.gameplay(true);
      vi.advanceTimersByTime(platform.FIRST_MIDGAME_AFTER_GAMEPLAY_MS);
      platform.gameplay(false);
      const done = platform.midgameBreak();
      await vi.advanceTimersByTimeAsync(0);
      sdk.lastAd!.adError!({ code });
      await done;
      expect(mutes).toEqual([]);
    },
  );

  it('si el SDK no contesta, los topes dejan seguir', async () => {
    const sdk = fakeSdk();
    const { platform, mutes, state } = await load('crazygames', sdk);
    platform.gameplay(true);
    vi.advanceTimersByTime(platform.FIRST_MIDGAME_AFTER_GAMEPLAY_MS);
    platform.gameplay(false);
    // Ni adStarted: el tope de la petición.
    let done = platform.midgameBreak();
    await vi.advanceTimersByTimeAsync(platform.MIDGAME_START_TIMEOUT_MS);
    await done;
    expect(state.log.some((l) => l.endsWith('timeout before adStarted'))).toBe(true);
    // Empieza y no acaba: el tope del anuncio, y el silencio se suelta.
    done = platform.midgameBreak();
    await vi.advanceTimersByTimeAsync(0);
    sdk.lastAd!.adStarted!();
    await vi.advanceTimersByTimeAsync(platform.MIDGAME_PLAY_TIMEOUT_MS);
    await done;
    expect(state.log.some((l) => l.endsWith('timeout before adFinished'))).toBe(true);
    expect(mutes).toEqual(['ad on', 'ad off']);
  });

  it('un anuncio que empieza tras el tope se ve en silencio y suelta el silencio al acabar', async () => {
    const sdk = fakeSdk();
    const { platform, mutes, state } = await load('crazygames', sdk);
    const { done } = await breakAfterAMatch(platform);
    await vi.advanceTimersByTimeAsync(platform.MIDGAME_START_TIMEOUT_MS);
    await done; // el juego ya siguió
    sdk.lastAd!.adStarted!();
    expect(mutes).toEqual(['ad on']);
    expect(state.log.some((l) => l.endsWith('adStarted late: the game already went on'))).toBe(true);
    sdk.lastAd!.adFinished!();
    expect(mutes).toEqual(['ad on', 'ad off']);
  });

  it('un adStarted después de adFinished no deja el silencio puesto', async () => {
    const sdk = fakeSdk();
    const { platform, mutes } = await load('crazygames', sdk);
    const { done } = await breakAfterAMatch(platform);
    sdk.lastAd!.adFinished!();
    await done;
    sdk.lastAd!.adStarted!();
    expect(mutes).toEqual(['ad on']);
    await vi.advanceTimersByTimeAsync(platform.MIDGAME_PLAY_TIMEOUT_MS);
    expect(mutes).toEqual(['ad on', 'ad off']);
  });

  it('el silencio de CG (settings.muteAudio) manda y se sigue en vivo', async () => {
    const sdk = fakeSdk({ muteAudio: true });
    const { mutes } = await load('crazygames', sdk);
    expect(mutes).toEqual(['platform on']);
    sdk.settingsListener!({ muteAudio: false });
    expect(mutes).toEqual(['platform on', 'platform off']);
  });

  it.each([
    ['sin SDK (adblock)', undefined],
    ['con init() que falla', fakeSdk({ initFails: true })],
    ['fuera de sus dominios (disabled)', fakeSdk({ environment: 'disabled' })],
  ])('%s no hace nada y el descanso no espera', async (_label, sdk) => {
    const { platform, state } = await load('crazygames', sdk);
    expect(state.backend).toBe('off');
    platform.gameplay(true);
    vi.advanceTimersByTime(10 * 60_000);
    platform.gameplay(false);
    await platform.midgameBreak();
    expect(sdk?.calls.filter((c) => c !== 'init') ?? []).toEqual([]);
  });
});
