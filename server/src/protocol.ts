// ---------------------------------------------------------------------------
// NET_PROTOCOL — la versión del contrato de red cliente↔servidor
// ---------------------------------------------------------------------------
//
// El servidor solo manda arenaSeed + arenaPackId + nivel y lote del colapso:
// CADA CLIENTE deriva en local qué fragmentos caen (src/arena.ts ←
// src/arena-fragments.ts). Un cliente de una versión contra un servidor de
// otra pinta suelo donde la física del servidor ya lo tiró. Este número lo
// impide: el cliente lo manda al unirse (src/network.ts), BrawlRoom.onAuth
// rechaza si no coincide (net-protocol-guard.ts) y el estado lo devuelve
// (GameState.protocol) para que el cliente detecte un servidor viejo.
//
// FUENTE ÚNICA: el servidor lo compila y el cliente lo importa con
// `../server/src/protocol`. Por eso este fichero NO puede tener imports (el
// cliente no compila Node y el servidor no ve nada fuera de server/src).
//
// CUÁNDO SUBIR NET_PROTOCOL (y AÑADIR su fila a LAYOUT_BY_PROTOCOL):
//   - Cambia el reparto del suelo que deriva el cliente. Lo fuerza
//     tests/sim/net-protocol.test.ts: si el golden de layout se mueve, el
//     test falla y dice qué poner.
//   - A mano: quitar o renombrar un campo del estado, cambiar la forma de un
//     mensaje, cambiar el significado de una opción de join, o añadir algo
//     que un cliente viejo no sepa pintar (un bicho nuevo).
// NO hace falta por: balance y física (manda el servidor), campos NUEVOS al
// final del estado, packs (el cliente degrada a 'jungle') ni cambios que
// solo tocan el cliente.
//
// Protocolo 1 = v1.7, anterior al guard: no manda nada y se trata como 1.
// Detalle y runbook: ONLINE.md → "Versión de protocolo".
// ---------------------------------------------------------------------------

export const NET_PROTOCOL = 2;

/** Huella (FNV-1a 32) del golden de layout con la que salió cada protocolo.
 *  Al subir NET_PROTOCOL se AÑADE una fila; las viejas no se tocan. */
export const LAYOUT_BY_PROTOCOL: Readonly<Record<number, string>> = {
  2: 'dbf21526', // v1.8-terreno-v2 (H4.5)
};

/** Huella (FNV-1a 32) del cuerpo de server/src/sim/arena-fragments.ts. Si el
 *  código del generador cambia sin mover el golden, el test obliga a decidir:
 *  subir NET_PROTOCOL o, si no afecta a lo que deriva el cliente, actualizar
 *  solo esta línea. */
export const GENERATOR_FINGERPRINT = 'b36f9bff';
