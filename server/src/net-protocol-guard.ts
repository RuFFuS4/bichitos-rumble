// ---------------------------------------------------------------------------
// Guard de versión del join — decisión pura, sin Colyseus (testeable)
// ---------------------------------------------------------------------------
//
// BrawlRoom.onAuth (estático) llama aquí. En joinOrCreate, create y join
// corre ANTES de buscar o crear sala; en joinById, después de encontrar la
// sala y comprobar que no está cerrada, pero siempre antes de reservar
// asiento. Un Error lanzado desde onAuth llega al cliente como
// MatchMakeError (HTTP 523) con este texto. Los clientes v1.7 lo pintan tal
// cual en su alert genérico ("El servidor dice: …"), así que el texto va en
// los dos idiomas y NUNCA contiene los tokens que v1.7 reconoce
// (nickname_active_in_room, nickname_taken, identity_stale,
// room_already_started, is locked).
//
// Interruptor de emergencia: NET_PROTOCOL_GUARD=off en el entorno apaga el
// rechazo del SERVIDOR sin revertir main. Rescata un fallo del propio guard
// y deja jugar a las pestañas v1.7 (desincronizadas: solo emergencias). NO
// rescata a un cliente ≥ v1.8 de otro número: ese se para solo con la
// sonda /health o el eco (src/network.ts). Un desparejo de versiones se
// arregla con rollback de los dos lados.
// ---------------------------------------------------------------------------

import { NET_PROTOCOL } from './protocol.js';

export type ProtocolVerdict = 'ok' | 'client_outdated' | 'server_outdated';

/** Sin campo = cliente anterior al guard (v1.7) = protocolo 1. Un valor que
 *  no es un entero positivo se trata como viejo: nunca se deja pasar. */
export function clientProtocolOf(raw: unknown): number {
  if (raw === undefined) return 1;
  const n = typeof raw === 'number' ? raw : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function judgeProtocol(clientProtocol: number, serverProtocol = NET_PROTOCOL): ProtocolVerdict {
  if (clientProtocol === serverProtocol) return 'ok';
  return clientProtocol < serverProtocol ? 'client_outdated' : 'server_outdated';
}

/** Solo se apaga con "off" (sin distinguir mayúsculas ni espacios): una
 *  errata en una emergencia no debe dejarlo encendido sin avisar. */
export function isGuardEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.NET_PROTOCOL_GUARD ?? '').trim().toLowerCase() !== 'off';
}

/** Texto del rechazo: español primero si el navegador lo prefiere. Acaba en
 *  un token técnico que el cliente nuevo reconoce (src/game.ts). */
export function rejectMessage(
  verdict: Exclude<ProtocolVerdict, 'ok'>,
  clientProtocol: number,
  acceptLanguage: string | null | undefined,
  serverProtocol = NET_PROTOCOL,
): string {
  const [es, en] = verdict === 'client_outdated'
    ? ['Hay una versión nueva del juego: recarga la página para jugar online.',
       'A new version of the game is out: reload the page to play online.']
    : ['El servidor se está actualizando: prueba otra vez en un minuto.',
       'The server is updating: try again in a minute.'];
  const esFirst = /^\s*es\b/i.test(acceptLanguage ?? '');
  const sign = verdict === 'client_outdated' ? '<' : '>';
  return `${esFirst ? es : en} / ${esFirst ? en : es} (${verdict} ${clientProtocol}${sign}${serverProtocol})`;
}

/** Contador de rechazos desde el arranque, para /health. */
let rejected = 0;
export function countRejection(): void { rejected++; }
export function rejectedJoins(): number { return rejected; }
