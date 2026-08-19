// ---------------------------------------------------------------------------
// match-rng — seedable PRNG for deterministic offline matches
// ---------------------------------------------------------------------------
//
// CONTRATO DE DETERMINISMO (afilado — batch runner / replay):
//
// Un seed = una partida entera. Ambos arranques offline (enterCountdown y
// debugStartOfflineMatch) llaman a seedMatchRng() con EL MISMO seed que
// recibe arena.buildFromSeed(), de modo que reproducir el seed reproduce
// tanto la arena como las decisiones de la partida.
//
// QUÉ DEBE USAR matchRng():
//   Toda aleatoriedad que afecte al RESULTADO de una partida offline:
//   decisiones de bots (bot.ts), posiciones de respawn, alturas/stagger
//   del drop inicial — cualquier roll cuyo valor cambie posiciones,
//   timings o vidas.
//
// QUÉ NO DEBE USARLO (sigue en Math.random):
//   VFX puro (puffs, tumbles de fragmentos, camera shake), audio,
//   variedad de menú (shuffle del roster de bots del flujo normal),
//   identidad online. Nada de eso altera el resultado y seedearlo solo
//   acoplaría el determinismo a detalles visuales.
//
// El determinismo completo requiere además dt fijo (devApi.setFixedStep):
// con dt de reloj, la MISMA secuencia de rolls se consume en frames
// distintos y la partida diverge igualmente.
//
// Implementación: mulberry32 — 32-bit, rápido, sin dependencias.
// ---------------------------------------------------------------------------

// Unseeded fallback: random-ish start so any accidental pre-match consumer
// still behaves like Math.random. Determinism only holds after seedMatchRng.
let state = (Date.now() ^ ((Math.random() * 0xffffffff) | 0)) >>> 0;

/** Seed the match PRNG. Call once per match start with the arena seed. */
export function seedMatchRng(seed: number): void {
  state = seed >>> 0;
}

/** Drop-in replacement for Math.random(): uniform float in [0, 1). */
export function matchRng(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
