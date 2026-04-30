// ---------------------------------------------------------------------------
// Bichitos Rumble — Online identity (nickname + device token)
// ---------------------------------------------------------------------------
//
// Zero-login identity layer for the Online Belts feature. A player picks
// a nickname the first time they tap "Online Multiplayer"; the client
// generates an opaque random token, stores it in localStorage, and posts
// both to the server. The server hashes the token and ties it to the
// nickname. On any subsequent visit, the same (nickname, token) pair
// reclaims the same player row — no password, no email, no signup prompt.
//
// If someone clears their browser data they lose access to their ranking
// row; that's the trade-off for "no signup". The stored token is also
// the reason someone on another device can't just write "TestPlayer"
// and steal an existing holder's ranking — the server rejects the
// claim unless the token hash matches.
//
// All state lives on `localStorage`. No cookies, no service workers.
// ---------------------------------------------------------------------------

import { getDefaultServerUrl } from './network';

const TOKEN_KEY = 'br-online-player-token';
const PLAYER_ID_KEY = 'br-online-player-id';
const NICKNAME_KEY = 'br-online-player-nickname';
// 2026-04-29 identity refinement — separate `device-stable identity`
// from the security token. The token authenticates a claim; the
// identity_id is a stable per-device fingerprint that survives even
// if the token gets rotated (or somebody clears just one of the
// localStorage keys). Server lets a nickname be re-claimed if EITHER
// matches the stored row, which is what Rafa wanted: same browser +
// same nickname after a reset just works.
const IDENTITY_ID_KEY = 'br-online-player-identity';
// 2026-05-01 last-minute — sessionStorage shadow keys. When two tabs
// of the same browser want to register DIFFERENT nicknames, each tab
// needs its own (token, identity, playerId) so the server-side
// "same playerId already in this room" check doesn't reject the
// second tab. We mirror localStorage's three keys into sessionStorage
// for that case; sessionStorage is per-tab so each tab can hold a
// distinct identity. localStorage stays as the long-lived "preferred
// identity" cache (used when only one tab is open + the user re-uses
// the cached nickname).
const SESSION_TOKEN_KEY      = 'br-online-tab-token';
const SESSION_IDENTITY_KEY   = 'br-online-tab-identity';
const SESSION_PLAYER_ID_KEY  = 'br-online-tab-player-id';
const SESSION_NICKNAME_KEY   = 'br-online-tab-nickname';

/** True when sessionStorage holds a registered identity for THIS tab.
 *  All read accessors prefer the session copy so the rest of the app
 *  doesn't need to know whether we forked or not. */
function hasSessionIdentity(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return !!sessionStorage.getItem(SESSION_PLAYER_ID_KEY) &&
         !!sessionStorage.getItem(SESSION_NICKNAME_KEY);
}

function getOrCreateSessionToken(): string {
  let t = sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (t && t.length >= 16 && t.length <= 128) return t;
  t = randomToken();
  sessionStorage.setItem(SESSION_TOKEN_KEY, t);
  return t;
}

function getOrCreateSessionIdentityId(): string {
  let id = sessionStorage.getItem(SESSION_IDENTITY_KEY);
  if (id && id.length >= 16 && id.length <= 128) return id;
  id = randomToken();
  sessionStorage.setItem(SESSION_IDENTITY_KEY, id);
  return id;
}

// ---------------------------------------------------------------------------
// Server URL resolution — the WebSocket URL tells us where the REST API lives
// ---------------------------------------------------------------------------

/**
 * The WebSocket URL is `ws://host:port` or `wss://host:port`; REST calls
 * use the same host+port over http/https. This derives one from the other
 * so we don't need a second env var.
 */
function restBase(): string {
  const wsUrl = getDefaultServerUrl();
  return wsUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
}

// ---------------------------------------------------------------------------
// Token — random 128-bit blob, base64 encoded. Stored ONCE per device.
// ---------------------------------------------------------------------------

function randomToken(): string {
  // Prefer the platform CSPRNG; fall back to Math.random if it's ever
  // unavailable (shouldn't happen in any browser we target).
  const bytes = new Uint8Array(24);
  const g = (typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : null);
  if (g?.getRandomValues) g.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  // Base64-url encode: 24 bytes → 32 chars, no padding, URL-safe.
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getOrCreateToken(): string {
  let t = localStorage.getItem(TOKEN_KEY);
  if (t && t.length >= 16 && t.length <= 128) return t;
  t = randomToken();
  localStorage.setItem(TOKEN_KEY, t);
  return t;
}

/**
 * Device-stable identity id. Generated on first use, persisted
 * independently from the auth token. The server uses it as a
 * second key (alongside the token) to allow same-device nickname
 * reuse — if either matches the stored row, the claim succeeds.
 */
function getOrCreateIdentityId(): string {
  let id = localStorage.getItem(IDENTITY_ID_KEY);
  if (id && id.length >= 16 && id.length <= 128) return id;
  id = randomToken();
  localStorage.setItem(IDENTITY_ID_KEY, id);
  return id;
}

/** Read-only accessor for the device identity id — used by the
 *  network layer when joining a brawl room so the server can
 *  enforce in-room duplicate detection. Returns the per-tab session
 *  identity when this tab forked (different nickname than the
 *  browser-wide cache), or the persistent localStorage identity
 *  otherwise. */
export function getDeviceIdentityId(): string {
  if (hasSessionIdentity()) return getOrCreateSessionIdentityId();
  return getOrCreateIdentityId();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Identity returned after successful registration / reclaim. The game
 * holds on to this for the lifetime of the tab; it's also written back
 * to localStorage so the next reload skips straight past the modal.
 */
export interface OnlineIdentity {
  playerId: string;
  nickname: string;
}

/** Returns the cached identity or null if the user has never
 *  registered. Prefers the per-tab session identity over the
 *  browser-wide localStorage cache so a forked tab keeps its own
 *  nickname after a refresh. */
export function getCachedIdentity(): OnlineIdentity | null {
  if (hasSessionIdentity()) {
    return {
      playerId: sessionStorage.getItem(SESSION_PLAYER_ID_KEY) ?? '',
      nickname: sessionStorage.getItem(SESSION_NICKNAME_KEY) ?? '',
    };
  }
  const playerId = localStorage.getItem(PLAYER_ID_KEY);
  const nickname = localStorage.getItem(NICKNAME_KEY);
  if (!playerId || !nickname) return null;
  return { playerId, nickname };
}

/**
 * Register a new nickname (or reclaim an existing one if the token matches).
 * Returns the canonical identity on success or throws with a machine-readable
 * reason code (e.g. 'nickname_taken', 'too_short', 'network_error') so the
 * caller can show a localised message in the modal.
 *
 * 2026-05-01 last-minute — multi-tab fork: when this tab is asking
 * for a nickname DIFFERENT from the one the browser has cached in
 * localStorage, we register with a per-tab `sessionStorage` token +
 * identity so the server creates a fresh player row. The result is
 * stored in sessionStorage too — this tab keeps the new identity
 * for its lifetime, but other tabs (and the next browser session)
 * still see the persistent localStorage identity. Same nickname or
 * first-time registration uses the persistent identity exactly like
 * before, so the no-fork path is unchanged.
 */
export async function registerNickname(nickname: string): Promise<OnlineIdentity> {
  const trimmedTarget = nickname.trim();
  const cachedNick = localStorage.getItem(NICKNAME_KEY);
  // Fork conditions:
  //   - this tab already holds a session identity (the user reloaded
  //     a forked tab and the same nickname is being claimed again),
  //   OR
  //   - the browser already cached a different nickname in
  //     localStorage and we're now picking a new one (second tab).
  const forkSession =
    hasSessionIdentity() ||
    (cachedNick !== null && cachedNick.trim().toLowerCase() !== trimmedTarget.toLowerCase());

  const token = forkSession ? getOrCreateSessionToken() : getOrCreateToken();
  const identityId = forkSession ? getOrCreateSessionIdentityId() : getOrCreateIdentityId();

  let res: Response;
  try {
    res = await fetch(restBase() + '/api/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, token, identityId }),
    });
  } catch (err) {
    console.warn('[online-identity] network error:', err);
    throw new Error('network_error');
  }

  if (!res.ok) {
    let reason = 'server_error';
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') reason = body.error;
    } catch {}
    throw new Error(reason);
  }

  const body = (await res.json()) as { id: string; nickname: string };
  const identity: OnlineIdentity = { playerId: body.id, nickname: body.nickname };
  if (forkSession) {
    // Per-tab identity. Keep localStorage untouched so other tabs
    // (and future browser sessions) still see the original
    // nickname as the preferred identity.
    sessionStorage.setItem(SESSION_PLAYER_ID_KEY, identity.playerId);
    sessionStorage.setItem(SESSION_NICKNAME_KEY, identity.nickname);
  } else {
    localStorage.setItem(PLAYER_ID_KEY, identity.playerId);
    localStorage.setItem(NICKNAME_KEY, identity.nickname);
  }
  return identity;
}

/** Wipe cached identity. Used by the "reset" button in settings / end-screen. */
export function forgetIdentity(): void {
  localStorage.removeItem(PLAYER_ID_KEY);
  localStorage.removeItem(NICKNAME_KEY);
  // NB: token is kept so if the user re-registers the same nickname on
  // the same device they reclaim ownership instead of being locked out.
}

/** The device token, exposed read-only so the network layer can send it
 *  with the first WebSocket message for per-request verification.
 *  Returns the per-tab session token when this tab forked, or the
 *  persistent localStorage token otherwise. */
export function getDeviceToken(): string {
  if (hasSessionIdentity()) return getOrCreateSessionToken();
  return getOrCreateToken();
}

// ---------------------------------------------------------------------------
// Leaderboard fetch
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  value: number;
  secondaryValue?: number;
}

export type OnlineBeltId =
  | 'throne-online'
  | 'flash-online'
  | 'ironclad-online'
  | 'slayer-online'
  | 'hot-streak-online';

/** Fetch the current top-N for every online belt in one request. */
export async function fetchAllLeaderboards(): Promise<Record<OnlineBeltId, LeaderboardEntry[]>> {
  const res = await fetch(restBase() + '/api/leaderboard');
  if (!res.ok) throw new Error('leaderboard_fetch_failed');
  return (await res.json()) as Record<OnlineBeltId, LeaderboardEntry[]>;
}
