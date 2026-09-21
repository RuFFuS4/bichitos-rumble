// ---------------------------------------------------------------------------
// Network client — el único módulo que INSTANCIA el SDK de Colyseus
// ---------------------------------------------------------------------------
//
// H2 slice 4: este fichero quedó reducido a lo que necesita el SDK en
// runtime (Client, Callbacks) y SOLO se importa dinámicamente
// (game.ts → connectOnline), así el chunk de @colyseus/sdk sale del
// grafo eager y un jugador offline no lo descarga jamás. Todo lo
// compartido estáticamente (interfaces de eventos, wrappers onMessage,
// sendInput, getDefaultServerUrl, tipo Room) vive en network-events.ts
// con imports type-only.
//
// H1 (Colyseus 0.17): la superficie versión-específica del SDK sigue
// concentrada aquí — el bump 0.16→0.17 fue un cambio de un fichero y
// el próximo también lo será.
// ---------------------------------------------------------------------------

import { Client, Callbacks, type Room } from '@colyseus/sdk';
// Fuente única de la versión del contrato de red, compartida con el servidor
// (sin imports dentro, por eso el cliente puede tirar de server/src).
import { NET_PROTOCOL } from '../server/src/protocol';

export interface JoinBrawlOptions {
  critterName?: string;
}

/** Tope para recibir el primer estado de la sala tras unirse. Llega en
 *  milisegundos; si no llega, no hay partida posible de todas formas. */
const FIRST_STATE_TIMEOUT_MS = 8000;
/** Tope de la sonda /health previa al join (falla abierta: pasado el tope
 *  se sigue y decide el eco, así que no merece esperar más). */
const HEALTH_PROBE_TIMEOUT_MS = 2000;
/** Tope para despedirse de una sala de otra versión (como
 *  ABANDON_ROOM_WAIT_MS en game.ts): un leave nunca debe colgar el join. */
const LEAVE_WAIT_MS = 1500;

/** Error con el token que reconoce el catch de game.ts, en formato
 *  "cliente ? servidor", igual que el texto del rechazo del servidor. */
function versionError(theirs: number): Error {
  const serverIsOlder = theirs < NET_PROTOCOL;
  const verdict = serverIsOlder ? 'server_outdated' : 'client_outdated';
  return new Error(`${verdict} (${NET_PROTOCOL}${serverIsOlder ? '>' : '<'}${theirs})`);
}

/**
 * Sonda previa al join: qué protocolo anuncia el `/health` del servidor
 * (ws(s)://host → http(s)://host/health). `undefined` = servidor anterior al
 * guard (v1.7), `null` = no se sabe.
 *
 * Por qué antes de entrar: contra un servidor viejo el eco de abajo nos saca
 * igual, pero ya habríamos ocupado asiento; como 4º humano eso le arranca la
 * cuenta atrás a la sala y le apunta una derrota a nuestra identidad
 * (reproducido en la verificación del 2026-09-21). Falla ABIERTA: si /health
 * no responde, se sigue y el eco decide.
 */
async function probeServerProtocol(serverUrl: string): Promise<number | undefined | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${serverUrl.replace(/^ws/i, 'http').replace(/\/+$/, '')}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { protocol?: unknown };
    return typeof body.protocol === 'number' ? body.protocol : undefined;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Espera al primer estado de la sala (el SDK resuelve el join ANTES de
 * recibirlo) y devuelve el `protocol` que el servidor lleva en él:
 * `undefined` = servidor anterior al guard (v1.7), `null` = no llegó ningún
 * estado (tope, o la sala murió antes).
 */
function readServerProtocol(room: Room): Promise<number | undefined | null> {
  const protocolOf = (state: unknown): number | undefined => {
    const p = (state as { protocol?: unknown } | undefined)?.protocol;
    return typeof p === 'number' ? p : undefined;
  };
  const arrived = (state: unknown) => (state as { phase?: unknown } | undefined)?.phase !== undefined;
  if (arrived(room.state)) return Promise.resolve(protocolOf(room.state));
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: number | undefined | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), FIRST_STATE_TIMEOUT_MS);
    room.onStateChange.once((state) => finish(protocolOf(state)));
    // Si la sala muere antes del primer estado no llegará ninguno: sin esto
    // el join se quedaría en "Conectando…" hasta el tope (reproducido con la
    // Room real del SDK en la verificación del 2026-09-21).
    room.onLeave(() => finish(null));
  });
}

/** Salir de una sala de otra versión sin reconexión ni cuelgues. */
async function leaveQuietly(room: Room): Promise<void> {
  room.reconnection.enabled = false;
  // Con el socket ya cerrado, leave() nunca emite onLeave: esperaríamos el
  // tope entero para nada.
  if (room.connection?.isOpen !== true) return;
  await Promise.race([
    room.leave(true).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, LEAVE_WAIT_MS)),
  ]);
}

/** How to land in a room (H4 — private rooms):
 *  - omitted/'quick': joinOrCreate against the public pool (as always).
 *  - {createPrivate}: create a NEW private room (setPrivate server-side;
 *    joinOrCreate never matches it) — share its roomId by link.
 *  - {joinRoomId}: joinById a specific room (the ?room=XYZ link path).
 *    Works for private rooms and, deliberately, for public ones too. */
export type BrawlJoinMode =
  | { createPrivate: true }
  | { joinRoomId: string }
  | undefined;

/**
 * Connect to a Colyseus server and join or create a brawl room.
 * Returns the Room instance (state auto-syncs via Colyseus patches).
 * `options.critterName` is forwarded to the server's onJoin; the server
 * validates it against its playable table and falls back if unknown.
 */
export async function connectToBrawl(
  serverUrl: string,
  options: JoinBrawlOptions = {},
  mode: BrawlJoinMode = undefined,
): Promise<Room> {
  console.log('[Network] connecting to', serverUrl, 'with options', options, 'mode', mode ?? 'quick');
  // Guard de versión (ONLINE.md → "Versión de protocolo"), en tres capas:
  // 1. la sonda /health evita sentarse en una sala de otra versión;
  const advertised = await probeServerProtocol(serverUrl);
  if (advertised !== null && advertised !== NET_PROTOCOL) throw versionError(advertised ?? 1);
  // 2. el servidor rechaza en su onAuth un protocol distinto del suyo;
  const client = new Client(serverUrl);
  const joinOptions = { ...options, protocol: NET_PROTOCOL };
  let room: Room;
  if (mode && 'createPrivate' in mode) {
    room = await client.create('brawl', { ...joinOptions, private: true });
  } else if (mode && 'joinRoomId' in mode) {
    room = await client.joinById(mode.joinRoomId, joinOptions);
  } else {
    room = await client.joinOrCreate('brawl', joinOptions);
  }
  // 3. el eco: un servidor VIEJO no tiene guard y nos deja entrar si la
  // sonda no llegó a saberlo. Su estado no trae `protocol` (o trae otro):
  // salir antes de jugar. Los tokens los reconoce el catch de game.ts.
  const serverProtocol = await readServerProtocol(room);
  if (serverProtocol !== NET_PROTOCOL) {
    await leaveQuietly(room);
    if (serverProtocol === null) throw new Error('no_state_from_server');
    throw versionError(serverProtocol ?? 1);
  }
  // H4 reconnect (2026-08-24): allowReconnection YA está en el server
  // (BrawlRoom.onLeave, gracia de 30 s con bot-takeover mientras tanto),
  // así que la auto-reconexión del SDK vuelve a estar activa (su
  // default). El cliente muestra "Reconnecting…" en onDrop y limpia en
  // onReconnect (game.ts); onLeave solo llega cuando los reintentos se
  // agotan o el server rechaza el rejoin. Cap de reintentos alineado
  // con la gracia del server: no tiene sentido insistir minutos contra
  // un asiento que expiró a los 30 s.
  room.reconnection.maxRetries = 8;
  console.log('[Network] joined room', room.roomId, 'as', room.sessionId);
  return room;
}

/**
 * Register add/remove listeners on the players MapSchema. `onAdd` also
 * fires for players already present when the listener attaches (SDK
 * behaviour, both v3 proxies and v4 Callbacks) — the caller doesn't need
 * a separate initial sweep.
 *
 * game.ts recibe esta función vía el import dinámico y la pasa a
 * enterOnline (tipo `PlayersChangeBinder` en network-events.ts).
 */
export function onPlayersChange(
  room: Room,
  handlers: {
    onAdd: (playerState: any, sessionId: string) => void;
    onRemove: (playerState: any, sessionId: string) => void;
  },
): void {
  // This client is schema-blind (no shared schema types — state is read
  // defensively as plain properties), so the SDK types the map key as
  // unknown; normalise at the boundary.
  const callbacks = Callbacks.get(room);
  callbacks.onAdd('players', (playerState, sessionId) =>
    handlers.onAdd(playerState, String(sessionId)));
  callbacks.onRemove('players', (playerState, sessionId) =>
    handlers.onRemove(playerState, String(sessionId)));
}
