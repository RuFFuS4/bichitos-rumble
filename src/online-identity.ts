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

/** Returns the cached identity or null if the user has never registered. */
export function getCachedIdentity(): OnlineIdentity | null {
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
 */
export async function registerNickname(nickname: string): Promise<OnlineIdentity> {
  const token = getOrCreateToken();
  let res: Response;
  try {
    res = await fetch(restBase() + '/api/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, token }),
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
  localStorage.setItem(PLAYER_ID_KEY, identity.playerId);
  localStorage.setItem(NICKNAME_KEY, identity.nickname);
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
 *  with the first WebSocket message for per-request verification. */
export function getDeviceToken(): string {
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
