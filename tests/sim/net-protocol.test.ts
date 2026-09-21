// ---------------------------------------------------------------------------
// Guard de versión cliente↔servidor — que nadie tenga que acordarse
// ---------------------------------------------------------------------------
//
// NET_PROTOCOL (server/src/protocol.ts) solo protege a los jugadores si se
// mueve cuando se mueve el contrato. Lo que cada cliente deriva en local es
// el reparto del suelo (arena-fragments), así que aquí se amarra a dos
// huellas:
//   1. La del golden de layout (tests/sim/arena-layout-golden.json), que
//      arena-layout.test.ts mantiene igual al generador. Si se mueve, el
//      reparto cambió: hay que subir NET_PROTOCOL y añadir su fila.
//   2. La del CÓDIGO del generador (server/src/sim/arena-fragments.ts), que
//      tapa lo que el golden no hashea (FRAG, radios, pointInFragment). Si se
//      mueve sin mover el golden, hay que decidir: subir, o si no afecta a lo
//      que deriva el cliente, actualizar solo GENERATOR_FINGERPRINT.
// Más la tabla de verdad del guard del servidor (net-protocol-guard.ts).
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENERATOR_FINGERPRINT,
  LAYOUT_BY_PROTOCOL,
  NET_PROTOCOL,
} from '../../server/src/protocol';
import {
  clientProtocolOf,
  isGuardEnabled,
  judgeProtocol,
  rejectMessage,
} from '../../server/src/net-protocol-guard';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** FNV-1a 32 bits, el mismo hash que usa el golden de layout. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function layoutFingerprint(): string {
  const golden = JSON.parse(read('tests/sim/arena-layout-golden.json')) as { seeds: Record<string, string> };
  const lines = Object.entries(golden.seeds)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([seed, hash]) => `${seed}:${hash}`);
  return fnv1a(lines.join('\n'));
}

/** Cuerpo del espejo del servidor: sin la cabecera `//` (que es documentación
 *  por copia, como en scripts/check-sim-parity.mjs). */
function generatorFingerprint(): string {
  const lines = read('server/src/sim/arena-fragments.ts').split('\n');
  let n = 0;
  while (n < lines.length && lines[n].startsWith('//')) n++;
  return fnv1a(lines.slice(n).join('\n'));
}

describe('NET_PROTOCOL se mueve cuando se mueve el reparto del suelo', () => {
  it('protocol.ts no tiene imports (lo compilan el cliente y el servidor)', () => {
    expect(read('server/src/protocol.ts')).not.toMatch(/^\s*import\b/m);
  });

  it('NET_PROTOCOL es la última fila de LAYOUT_BY_PROTOCOL', () => {
    const rows = Object.keys(LAYOUT_BY_PROTOCOL).map(Number);
    expect(Math.max(...rows), 'Al subir NET_PROTOCOL se AÑADE su fila a LAYOUT_BY_PROTOCOL').toBe(NET_PROTOCOL);
  });

  it('el golden de layout coincide con el de este protocolo', () => {
    const now = layoutFingerprint();
    expect(now,
      `El reparto del suelo ha cambiado: un cliente de la versión desplegada pintaría suelo que el servidor ya tiró.\n` +
      `  En server/src/protocol.ts: NET_PROTOCOL = ${NET_PROTOCOL + 1}, añade la fila ${NET_PROTOCOL + 1}: '${now}' ` +
      `a LAYOUT_BY_PROTOCOL y pon GENERATOR_FINGERPRINT = '${generatorFingerprint()}'.`,
    ).toBe(LAYOUT_BY_PROTOCOL[NET_PROTOCOL]);
  });

  it('el código del generador es el registrado', () => {
    const now = generatorFingerprint();
    expect(now,
      `server/src/sim/arena-fragments.ts ha cambiado sin mover el golden. Decide:\n` +
      `  - si cambia algo que el cliente deriva (FRAG, radios, pointInFragment…): sube NET_PROTOCOL como dice el test de arriba;\n` +
      `  - si no (comentario, refactor sin efecto): pon GENERATOR_FINGERPRINT = '${now}' en server/src/protocol.ts.`,
    ).toBe(GENERATOR_FINGERPRINT);
  });
});

describe('guard del join (BrawlRoom.onAuth)', () => {
  it('sin campo = v1.7 = protocolo 1; lo que no es un entero positivo no pasa nunca', () => {
    expect(clientProtocolOf(undefined)).toBe(1);
    expect(clientProtocolOf(NET_PROTOCOL)).toBe(NET_PROTOCOL);
    for (const bad of ['2', 1.5, -1, 0, null, Number.NaN, {}]) {
      expect(judgeProtocol(clientProtocolOf(bad))).not.toBe('ok');
    }
  });

  it('decide en los dos sentidos', () => {
    expect(judgeProtocol(NET_PROTOCOL)).toBe('ok');
    expect(judgeProtocol(1, 2)).toBe('client_outdated');
    expect(judgeProtocol(3, 2)).toBe('server_outdated');
  });

  it('el interruptor de emergencia solo se apaga con NET_PROTOCOL_GUARD=off', () => {
    expect(isGuardEnabled({})).toBe(true);
    expect(isGuardEnabled({ NET_PROTOCOL_GUARD: 'on' })).toBe(true);
    expect(isGuardEnabled({ NET_PROTOCOL_GUARD: 'off' })).toBe(false);
    expect(isGuardEnabled({ NET_PROTOCOL_GUARD: ' OFF ' })).toBe(false);
    expect(isGuardEnabled({ NET_PROTOCOL_GUARD: 'false' })).toBe(true);
  });

  it('el texto del rechazo lleva su token, va en los dos idiomas y no confunde a v1.7', () => {
    // Tokens que el catch de src/game.ts de v1.7 ya reconoce: si el texto
    // contuviera alguno, una pestaña vieja pintaría un aviso equivocado.
    const v17Tokens = ['nickname_active_in_room', 'nickname_taken', 'identity_stale', 'room_already_started', 'is locked'];
    for (const verdict of ['client_outdated', 'server_outdated'] as const) {
      for (const lang of ['es-ES,es;q=0.9', 'en-US,en;q=0.9', null]) {
        const msg = rejectMessage(verdict, 1, lang, 2);
        expect(msg).toContain(verdict);
        for (const token of v17Tokens) expect(msg).not.toContain(token);
      }
    }
    expect(rejectMessage('client_outdated', 1, 'es-ES', 2)).toMatch(/^Hay una versión nueva.* \/ A new version.*\(client_outdated 1<2\)$/);
    expect(rejectMessage('client_outdated', 1, 'en-GB', 2)).toMatch(/^A new version.* \/ Hay una versión nueva/);
    expect(rejectMessage('server_outdated', 3, null, 2)).toMatch(/\(server_outdated 3>2\)$/);
  });
});
