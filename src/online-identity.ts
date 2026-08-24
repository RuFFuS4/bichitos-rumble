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

import { getDefaultServerUrl } from './network-events';

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
  /** true solo cuando el server acaba de CREAR la fila (primer registro
   *  de ese nick). El modal lo usa para decidir si muestra el paso de
   *  "apúntate el código de recuperación". */
  isNew?: boolean;
}

/**
 * 2026-05-01 final block — identity model rebuilt for predictability.
 *
 * The nickname-modal opens whenever sessionStorage doesn't already
 * carry a confirmed identity for THIS tab. localStorage is reserved
 * for "preferred nickname on this device" — it pre-fills the modal
 * but never auto-logs the user in. Concretely:
 *
 *   · First tab of a fresh browser session → modal opens, localStorage
 *     nickname (if any) is pre-filled, user just hits Enter to accept
 *     and the registration runs as a reclaim.
 *   · Tab refresh after a successful registration → sessionStorage is
 *     populated, modal is skipped.
 *   · Second tab opened in the same browser → sessionStorage empty,
 *     modal opens. User changes nick → forked session. User keeps
 *     same nick → server's "nickname_active_in_room" check rejects
 *     the second tab when it tries to join the same room.
 *
 * `getCachedIdentity()` therefore returns sessionStorage only.
 */
export function getCachedIdentity(): OnlineIdentity | null {
  if (typeof sessionStorage === 'undefined') return null;
  const playerId = sessionStorage.getItem(SESSION_PLAYER_ID_KEY);
  const nickname = sessionStorage.getItem(SESSION_NICKNAME_KEY);
  if (!playerId || !nickname) return null;
  return { playerId, nickname };
}

/** Read the user's "preferred" nickname from localStorage — used
 *  ONLY to pre-fill the nickname modal. Returns '' when no identity
 *  has been registered on this device yet. */
export function getPreferredNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? '';
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

  const body = (await res.json()) as { id: string; nickname: string; isNew?: boolean };
  const identity: OnlineIdentity = {
    playerId: body.id,
    nickname: body.nickname,
    isNew: body.isNew === true,
  };
  // 2026-05-01 final block — every registration writes to
  // sessionStorage (this tab's confirmed identity, used by
  // `getCachedIdentity` to skip the modal on refresh). Forks STOP
  // there — localStorage stays as the device-preferred nickname.
  // Non-fork (same as preferred or first-ever registration) ALSO
  // updates localStorage so the device picks up the freshly
  // claimed playerId for any future session.
  sessionStorage.setItem(SESSION_PLAYER_ID_KEY, identity.playerId);
  sessionStorage.setItem(SESSION_NICKNAME_KEY, identity.nickname);
  // 2026-08-24 H4 fix — espejar TAMBIÉN el token/identity usados en el
  // registro. Sin esto, en el camino no-fork getDeviceToken() (que tras
  // escribir la identidad de sesión prefiere sessionStorage) inventaba
  // un token de pestaña que el server nunca había visto → verifyPlayer
  // fallaba en el join y el jugador quedaba como guest. En el camino
  // fork es un no-op (los valores ya viven en sessionStorage).
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  sessionStorage.setItem(SESSION_IDENTITY_KEY, identityId);
  if (!forkSession) {
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
// Recovery code — identidad cross-device sin login (H4 retención)
// ---------------------------------------------------------------------------
//
// El server solo guarda un hash salteado del código, así que "ver mi
// código" no puede releerlo del server: cada petición al endpoint genera
// (y ROTA) uno nuevo. Para no rotar por accidente, el cliente cachea en
// localStorage el último código conocido — el que generó aquí o el que
// el jugador tecleó en una recuperación con éxito. Guardarlo en local
// tiene la misma postura de seguridad que el device token que ya vive
// ahí: quien lea este localStorage ya posee la sesión entera.
const RECOVERY_CODE_KEY = 'br-online-recovery-code'; // JSON { playerId, code }

function cacheRecoveryCode(playerId: string, code: string): void {
  try {
    localStorage.setItem(RECOVERY_CODE_KEY, JSON.stringify({ playerId, code }));
  } catch { /* modo privado — el código simplemente no se cachea */ }
}

/** Último código conocido en este dispositivo PARA ese playerId (una
 *  pestaña forkeada con otra identidad no ve el código del nick
 *  preferido del dispositivo). */
export function getCachedRecoveryCode(playerId: string): string | null {
  try {
    const raw = localStorage.getItem(RECOVERY_CODE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { playerId?: string; code?: string };
    if (parsed.playerId === playerId && typeof parsed.code === 'string') return parsed.code;
    return null;
  } catch {
    return null;
  }
}

/**
 * Devuelve el código de recuperación de la identidad activa: el cacheado
 * si existe (sin tocar el server → no rota), o pide uno nuevo al server
 * (que invalida cualquier código anterior) y lo cachea. Lanza con un
 * reason-code machine-readable en caso de fallo.
 */
export async function getOrFetchRecoveryCode(): Promise<string> {
  const identity = getCachedIdentity();
  if (!identity) throw new Error('no_identity');
  const cached = getCachedRecoveryCode(identity.playerId);
  if (cached) return cached;

  let res: Response;
  try {
    res = await fetch(restBase() + '/api/identity/recovery-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: identity.playerId, token: getDeviceToken() }),
    });
  } catch {
    throw new Error('network_error');
  }
  if (!res.ok) {
    let reason = 'server_error';
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') reason = body.error;
    } catch { /* body no-JSON → server_error */ }
    throw new Error(reason);
  }
  const body = (await res.json()) as { code: string };
  cacheRecoveryCode(identity.playerId, body.code);
  return body.code;
}

/**
 * Recupera una identidad existente en ESTE dispositivo con (nickname +
 * código de recuperación). El server verifica el hash y rota el device
 * token al que generamos aquí — a partir de ese momento este dispositivo
 * es dueño de la fila (el original conserva su vía de reclamo por
 * identity_id). Al éxito se persiste igual que un registro no-fork:
 * identidad preferida del dispositivo (localStorage) + sesión de la
 * pestaña (sessionStorage), y se cachea el código tecleado (sigue
 * siendo válido — el server no lo invalida al usarse).
 */
export async function recoverIdentity(code: string, nickname: string): Promise<OnlineIdentity> {
  const token = getOrCreateToken();
  const identityId = getOrCreateIdentityId();

  let res: Response;
  try {
    res = await fetch(restBase() + '/api/identity/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, code, token, identityId }),
    });
  } catch {
    throw new Error('network_error');
  }
  if (!res.ok) {
    let reason = 'server_error';
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') reason = body.error;
    } catch { /* body no-JSON → server_error */ }
    throw new Error(reason);
  }

  const body = (await res.json()) as { id: string; nickname: string };
  const identity: OnlineIdentity = { playerId: body.id, nickname: body.nickname, isNew: false };
  sessionStorage.setItem(SESSION_PLAYER_ID_KEY, identity.playerId);
  sessionStorage.setItem(SESSION_NICKNAME_KEY, identity.nickname);
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  sessionStorage.setItem(SESSION_IDENTITY_KEY, identityId);
  localStorage.setItem(PLAYER_ID_KEY, identity.playerId);
  localStorage.setItem(NICKNAME_KEY, identity.nickname);
  cacheRecoveryCode(identity.playerId, code);
  return identity;
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
