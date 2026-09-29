// ---------------------------------------------------------------------------
// Platform — the moments of the game a web portal cares about (H5)
// ---------------------------------------------------------------------------
//
// The game reports here when it loads, when a match is being played and when
// there is a natural break between matches. On the own site and on itch this
// does nothing. The CrazyGames build (`vite build --mode crazygames`, which
// sets VITE_PLATFORM) loads src/platform-crazygames.ts, which talks to their
// SDK. Plan, rules and Rafa's decisions: docs/H5_CRAZYGAMES.md.
//
// Agent surface: window.__platform — the platform name, its state and a log
// of everything reported (the smoke and the tests read it).
// ---------------------------------------------------------------------------

/** Match time played before the first ad break: CrazyGames recommends
 *  3-5 min, and their own cap is one midgame every 3 min (Rafa, 2026-09-29). */
export const FIRST_MIDGAME_AFTER_GAMEPLAY_MS = 180_000;
/** A requested ad that has not started by then lets the game go on. */
export const MIDGAME_START_TIMEOUT_MS = 30_000;
/** A started ad with no adFinished/adError by then lets the game go on. */
export const MIDGAME_PLAY_TIMEOUT_MS = 120_000;

export type ExternalMuteReason = 'ad' | 'platform';

/** What a platform implements (src/platform-crazygames.ts). */
export interface PlatformBackend {
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Requests a break ad; resolves (never rejects) with what happened,
   *  once the game may go on. Mutes through `mute` while it plays. */
  midgame(): Promise<string>;
}

/** Hands a backend the two things it may drive: the external mute and the log. */
export interface PlatformHooks {
  mute(reason: ExternalMuteReason, on: boolean): void;
  log(event: string): void;
}

const state = {
  name: 'web',
  /** 'none' on the own site; 'pending' while the backend loads; then
   *  'ready' or 'off' (no SDK: adblock, init failed, not their domain). */
  backend: 'none' as 'none' | 'pending' | 'ready' | 'off',
  gameplay: false,
  gameplayMs: 0,
  gameplaySince: 0,
  mute: { ad: false, platform: false } as Record<ExternalMuteReason, boolean>,
  log: [] as string[],
};
let backend: PlatformBackend | null = null;
const queue: Array<(b: PlatformBackend) => void> = [];
let muteListener: ((reason: ExternalMuteReason, on: boolean) => void) | null = null;

function log(event: string): void {
  state.log.push(`${Math.round(performance.now())} ${event}`);
  if (state.log.length > 200) state.log.shift();
}

function setMute(reason: ExternalMuteReason, on: boolean): void {
  if (state.mute[reason] === on) return;
  state.mute[reason] = on;
  log(`mute ${reason} ${on ? 'on' : 'off'}`);
  muteListener?.(reason, on);
}

/** Runs `fn` on the backend; queued while it loads, dropped without one. */
function call(fn: (b: PlatformBackend) => void): void {
  if (backend) {
    try { fn(backend); } catch (err) { log(`backend threw: ${err}`); }
  } else if (state.backend === 'pending') {
    queue.push(fn);
  }
}

function played(now = performance.now()): number {
  return state.gameplayMs + (state.gameplay ? now - state.gameplaySince : 0);
}

/** Once, first thing at boot (src/main.ts). Also reports the start of the
 *  loading: the SDK counts it from here. */
export function initPlatform(): void {
  (window as unknown as { __platform: unknown }).__platform = { state, played };
  if (import.meta.env.VITE_PLATFORM !== 'crazygames') return;
  state.name = 'crazygames';
  state.backend = 'pending';
  document.body.classList.add('platform-crazygames');
  loadingStart();
  import('./platform-crazygames')
    .then((m) => m.createCrazyGamesBackend({ mute: setMute, log }))
    .then((b) => {
      backend = b;
      state.backend = b ? 'ready' : 'off';
      log(`backend ${state.backend}`);
      const pending = queue.splice(0);
      if (b) for (const fn of pending) call(fn);
    })
    .catch((err) => {
      state.backend = 'off';
      queue.length = 0;
      log(`backend failed: ${err}`);
    });
}

function loadingStart(): void {
  log('loadingStart');
  call((b) => b.loadingStart());
}

/** The game is ready to play (the title is up). */
export function loadingStop(): void {
  log('loadingStop');
  call((b) => b.loadingStop());
}

/** A match is being played (true) or not: countdown, pause, end screen,
 *  menus (false). Idempotent; it also accumulates the time played. */
export function gameplay(on: boolean): void {
  if (on === state.gameplay) return;
  const now = performance.now();
  if (on) state.gameplaySince = now;
  else state.gameplayMs += now - state.gameplaySince;
  state.gameplay = on;
  log(on ? 'gameplayStart' : 'gameplayStop');
  call((b) => (on ? b.gameplayStart() : b.gameplayStop()));
}

/** The natural break between matches: an ad may play here. Resolves when
 *  the game may go on, and never rejects. Nothing happens on the own site,
 *  without the SDK, or before FIRST_MIDGAME_AFTER_GAMEPLAY_MS of play. */
export async function midgameBreak(): Promise<void> {
  if (!backend) return;
  const ms = played();
  if (ms < FIRST_MIDGAME_AFTER_GAMEPLAY_MS) {
    log(`midgame skipped (${Math.round(ms / 1000)} s played)`);
    return;
  }
  log('midgame requested');
  try {
    log(`midgame ${await backend.midgame()}`);
  } catch (err) {
    log(`midgame threw: ${err}`);
  } finally {
    setMute('ad', false);
  }
}

/** Mutes the game while an ad plays ('ad') or while CrazyGames asks for it
 *  ('platform', their settings.muteAudio, which overrides the game's own
 *  toggle). The listener gets the reasons already on right away. */
export function onExternalMute(listener: (reason: ExternalMuteReason, on: boolean) => void): void {
  muteListener = listener;
  for (const reason of Object.keys(state.mute) as ExternalMuteReason[]) {
    if (state.mute[reason]) listener(reason, true);
  }
}
