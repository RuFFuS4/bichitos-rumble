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

export interface JoinBrawlOptions {
  critterName?: string;
}

/**
 * Connect to a Colyseus server and join or create a brawl room.
 * Returns the Room instance (state auto-syncs via Colyseus patches).
 * `options.critterName` is forwarded to the server's onJoin; the server
 * validates it against its playable table and falls back if unknown.
 */
export async function connectToBrawl(serverUrl: string, options: JoinBrawlOptions = {}): Promise<Room> {
  console.log('[Network] connecting to', serverUrl, 'with options', options);
  const client = new Client(serverUrl);
  const room = await client.joinOrCreate('brawl', options);
  // H1 review (0.17): the SDK now ships auto-reconnection ENABLED by
  // default, but our server has no allowReconnection/onDrop support —
  // a mid-match hard disconnect (server restart, dropped wifi, tab
  // suspend) would silently retry ~15 times (~1 min) with the match
  // frozen and no "Disconnected" overlay, because onLeave stops firing
  // for abnormal closes. Disabling restores the 0.16 semantics: onLeave
  // fires immediately, the overlay shows, and the server-side
  // bot-takeover already covers the gameplay half. Revisit in H4 when
  // allowReconnection lands server-side.
  room.reconnection.enabled = false;
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
