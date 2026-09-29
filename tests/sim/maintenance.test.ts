// ---------------------------------------------------------------------------
// Ventana de mantenimiento — la decisión pura (server/src/maintenance.ts)
// ---------------------------------------------------------------------------
//
// El fichero lo escribe server/scripts/maintenance.mjs; aquí, qué cuenta como
// ventana, cuándo cierra el online y qué texto recibe el jugador. Lo de
// verdad (onAuth, /health, el fichero en el volumen) lo prueban
// scripts/online-shutdown-e2e.mjs y el job server-docker del CI.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import {
  parseWindow, isActive, maintenanceMessage, MAX_WINDOW_MS, MAINTENANCE_TOKEN,
} from '../../server/src/maintenance';

const T = 1_790_000_000_000;
const win = { startsAt: T, endsAt: T + 20 * 60_000 };

describe('parseWindow', () => {
  it('acepta lo que escribe maintenance.mjs (con campos de más)', () => {
    expect(parseWindow({ ...win, createdAt: T })).toEqual(win);
  });
  it('rechaza lo que no es una ventana: falla abierta', () => {
    expect(parseWindow(null)).toBeNull();
    expect(parseWindow({})).toBeNull();
    expect(parseWindow({ startsAt: T })).toBeNull();
    expect(parseWindow({ startsAt: 'x', endsAt: T })).toBeNull();
    expect(parseWindow({ startsAt: T, endsAt: T })).toBeNull();
    expect(parseWindow({ startsAt: T, endsAt: T - 1 })).toBeNull();
  });
  it('tope de 2 h: una ventana más larga no cierra nada', () => {
    expect(parseWindow({ startsAt: T, endsAt: T + MAX_WINDOW_MS })).not.toBeNull();
    expect(parseWindow({ startsAt: T, endsAt: T + MAX_WINDOW_MS + 1 })).toBeNull();
  });
});

describe('isActive', () => {
  it('cierra desde startsAt (incluido) hasta endsAt (excluido)', () => {
    expect(isActive(win, T - 1)).toBe(false);
    expect(isActive(win, T)).toBe(true);
    expect(isActive(win, win.endsAt - 1)).toBe(true);
    expect(isActive(win, win.endsAt)).toBe(false);
  });
  it('sin ventana, abierto', () => {
    expect(isActive(null, T)).toBe(false);
  });
});

describe('maintenanceMessage', () => {
  it('minutos que faltan, redondeados hacia arriba y como mínimo 1', () => {
    expect(maintenanceMessage(win, T, 'es')).toContain('~20 min');
    expect(maintenanceMessage(win, T + 60_001, 'es')).toContain('~19 min');
    expect(maintenanceMessage(win, win.endsAt - 1, 'es')).toContain('~1 min');
  });
  it('español primero si el navegador lo prefiere, inglés si no', () => {
    expect(maintenanceMessage(win, T, 'es-ES,es;q=0.9')).toMatch(/^El online está en mantenimiento/);
    expect(maintenanceMessage(win, T, 'en-GB')).toMatch(/^Online is under maintenance/);
    expect(maintenanceMessage(win, T, undefined)).toMatch(/^Online is under maintenance/);
  });
  it('acaba en el token que reconoce el cliente, con la hora de vuelta', () => {
    expect(maintenanceMessage(win, T, 'es')).toMatch(new RegExp(`\\(${MAINTENANCE_TOKEN} until=${win.endsAt}\\)$`));
  });
  it('no lleva ningún token que las pestañas v1.11 ya traten de otra forma', () => {
    const msg = maintenanceMessage(win, T, 'es');
    for (const token of [
      'nickname_active_in_room', 'nickname_taken', 'identity_stale', 'room_already_started',
      'is locked', 'client_outdated', 'server_outdated', 'no_state_from_server',
    ]) expect(msg).not.toContain(token);
  });
});
