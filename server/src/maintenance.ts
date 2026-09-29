// ---------------------------------------------------------------------------
// Ventana de mantenimiento — cerrar el online sin reiniciar el servidor
// ---------------------------------------------------------------------------
//
// Norma de Rafa (2026-09-26): si hay partidas vivas al desplegar, primero se
// avisa con un mensaje de mantenimiento, y la subida y las comprobaciones van
// dentro del tiempo anunciado.
//
// El interruptor es un fichero en el volumen, `${DATA_DIR}/maintenance.json`,
// que escribe `node scripts/maintenance.mjs on --for <min>` desde la shell del
// contenedor (Rafa, 2026-09-29). Nada reinicia: el servidor lo relee con una
// caché de 3 s. Mientras la ventana está activa, BrawlRoom.onAuth rechaza
// cualquier entrada nueva (partida rápida, sala privada, enlace de amigo) con
// un 523 y este texto; las partidas en marcha terminan normal (las
// reconexiones no pasan por onAuth) y el online vacío se puede desplegar.
// Sobrevive a la subida (el fichero está en el volumen) y caduca solo.
//
// Falla abierta: sin fichero, corrupto, vencido o de más de 2 h, el online
// queda abierto. /health dice 'invalid' si el fichero no se puede leer.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

/** Una ventana de mantenimiento, en epoch ms. */
export interface MaintenanceWindow {
  startsAt: number;
  endsAt: number;
}

/** Tope de una ventana: nadie deja el online cerrado por un olvido. */
export const MAX_WINDOW_MS = 120 * 60_000;

/** Token técnico al final del texto del rechazo, que reconoce el cliente
 *  (src/game.ts). Distinto de todos los que ya reconocen las pestañas
 *  v1.11: esas lo enseñan dentro de su aviso genérico. */
export const MAINTENANCE_TOKEN = 'maintenance_window';

/** El contenido del fichero, validado: null si no es una ventana. */
export function parseWindow(raw: unknown): MaintenanceWindow | null {
  const w = raw as Partial<MaintenanceWindow> | null;
  const startsAt = Number(w?.startsAt);
  const endsAt = Number(w?.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return null;
  if (endsAt <= startsAt || endsAt - startsAt > MAX_WINDOW_MS) return null;
  return { startsAt, endsAt };
}

/** Si la ventana cierra el online en `now`. */
export function isActive(win: MaintenanceWindow | null, now: number): boolean {
  return win !== null && now >= win.startsAt && now < win.endsAt;
}

/** Texto del rechazo, con los minutos que faltan (redondeados hacia arriba,
 *  mínimo 1): español primero si el navegador lo prefiere, como el guard. */
export function maintenanceMessage(
  win: MaintenanceWindow,
  now: number,
  acceptLanguage: string | null | undefined,
): string {
  const min = Math.max(1, Math.ceil((win.endsAt - now) / 60_000));
  const es = `El online está en mantenimiento: vuelve en ~${min} min. Mientras, puedes jugar offline.`;
  const en = `Online is under maintenance: back in ~${min} min. Meanwhile, you can play offline.`;
  const esFirst = /^\s*es\b/i.test(acceptLanguage ?? '');
  return `${esFirst ? es : en} / ${esFirst ? en : es} (${MAINTENANCE_TOKEN} until=${win.endsAt})`;
}

// --- El fichero -----------------------------------------------------------

const CACHE_MS = 3_000;
let cached: { at: number; win: MaintenanceWindow | null; invalid: boolean } | null = null;
let loggedInvalid = false;
let rejected = 0;

/** La misma resolución de DATA_DIR que db.ts y scripts/maintenance.mjs. */
function windowFile(): string {
  return `${process.env.DATA_DIR ?? './data'}/maintenance.json`;
}

function readWindow(now: number): { win: MaintenanceWindow | null; invalid: boolean } {
  if (cached && now - cached.at < CACHE_MS) return cached;
  let win: MaintenanceWindow | null = null;
  let invalid = false;
  try {
    win = parseWindow(JSON.parse(readFileSync(windowFile(), 'utf8')));
    invalid = win === null;
  } catch (err) {
    // Sin fichero es lo normal (online abierto); cualquier otro fallo, no.
    invalid = (err as NodeJS.ErrnoException)?.code !== 'ENOENT';
  }
  if (invalid && !loggedInvalid) {
    loggedInvalid = true;
    console.warn(`[maintenance] ${windowFile()} no es una ventana válida — el online sigue abierto`);
  }
  if (!invalid) loggedInvalid = false;
  cached = { at: now, win, invalid };
  return cached;
}

/** La ventana activa ahora mismo, o null (online abierto). */
export function activeWindow(now = Date.now()): MaintenanceWindow | null {
  const { win } = readWindow(now);
  return isActive(win, now) ? win : null;
}

/** El estado para /health. */
export function maintenanceStatus(now = Date.now()): {
  stage: 'none' | 'active' | 'invalid';
  endsAt: number | null;
  rejectedJoins: number;
} {
  const { win, invalid } = readWindow(now);
  const active = isActive(win, now);
  return {
    stage: invalid ? 'invalid' : active ? 'active' : 'none',
    endsAt: active ? win!.endsAt : null,
    rejectedJoins: rejected,
  };
}

/** Contador de entradas rechazadas por mantenimiento desde el arranque. */
export function countMaintenanceRejection(): void { rejected++; }
