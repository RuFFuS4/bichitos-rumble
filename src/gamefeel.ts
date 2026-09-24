import * as THREE from 'three';
import type { Critter } from './critter';

// ---------------------------------------------------------------------------
// Tuning — ALL game feel values centralized here
// ---------------------------------------------------------------------------

export const FEEL = {
  // --- Movement ---
  movement: {
    frictionHalfLife: 0.08,   // seconds for velocity to halve (slightly less aggressive for higher top speed)
    idleFrictionHalfLife: 0.03, // much faster stop when no input is held
    maxSpeed: 20,             // raised to let Rojo actually feel fast
    // 2026-09-21 (Rafa): 1.6 → 2.2 (×1.375). La mediana del roster pasa de
    // 1,8 a 2,5 alturas/s reales, dentro de la franja de los brawlers
    // cenitales (2,0-3,2). Solo sube la punta: el tiempo de arrancada y la
    // distancia de los golpes los fija la fricción, que no se toca.
    // Espejo: SIM.movement.accelerationScale. docs/FEELING.md §7.
    accelerationScale: 2.2,
    velocityDeadZone: 0.15,   // below this speed → snap to 0 (kills micro-drift)
  },

  // --- Locomoción visual (feeling, 2026-09-21) ---
  // PRESENTACIÓN, nunca física: el ritmo de las patas y la intensidad del
  // cuerpo en carrera salen de la velocidad REAL del bicho (medida:
  // 1,4-3,1 u/s, no los 8-18 de `config.speed`, que es una aceleración).
  // La zancada de cada clip vive en critter-locomotion.ts (medida del GLB).
  locomotion: {
    runRateMin: 0.45,         // timeScale mínimo del clip Run: arrancar y frenar no van a cámara lenta
    runCadenceMaxHz: 8,       // techo de ciclos/s: por encima el pie patina antes que girar como un ventilador. 6 → 8 el 2026-09-24: solo lo tocaban Sebastian (pedía 8: pie 1,33 → 1,00, escabullirse de cangrejo) y Kurama (6,24: 1,04 → 1,00); el resto va por debajo de 4
    topSpeedReach: 0.9,       // fracción de la velocidad terminal a la que el cuerpo ya va inclinado del todo
    groundSpeedSmoothing: 0.06, // s — suavizado de la velocidad de suelo, SOLO online (absorbe los saltos de posición entre parches); offline la posición es exacta y suavizarla retrasaba las patas (FEELING §7.11)
    runBlendSpeed: 1.5,       // u/s de avance a las que la pose ya es 100 % Run; por debajo se funde con el Idle (smoothstep) y las patas frenan con el suelo
    runBlendTime: 0.1,        // s mínimos para pasar de Idle a Run del todo: un acelerón brusco (estocada, dash, empujón) no cambia la pose en un fotograma
    // Acentos de arranque y frenada (corte 2, FEELING §7.11): salen de la
    // aceleración de avance del modelo en «velocidades punta por segundo»
    // (arrancar ≈ +4, frenar en seco ≈ −8), así pesan igual en Shelly que
    // en Kurama. Llenos a `accent*Full`; en medio, proporcionales.
    accentStartFull: 4,       // aceleración a la que el acento de arranque es pleno
    accentStopFull: 6,        // deceleración a la que el de frenada es pleno
    accentStartLean: 0.14,    // rad extra hacia delante al arrancar
    accentStopLean: 0.22,     // rad hacia atrás al frenar: se planta sobre los talones
    accentStopSquash: 0.12,   // aplastón vertical al frenar
    accentSmoothing: 0.05,    // s — suavizado de la aceleración (online llega a saltos)
    accentFade: 0.08,         // s mínimos para que un acento entre o salga del todo (al empezar o acabar un cabezazo no salta)
    turnHalfLife: 0.025,      // s — el MODELO tarda esto en recorrer la mitad de un giro (≈90 % en 80 ms); la orientación de juego sigue siendo instantánea
  },

  // Cadencia de carrera por bicho (claves = RosterEntry.id), relativa a la
  // del "pie apoyado": 1 = el pie no patina; >1 = las patas van más rápido
  // que el suelo (correteo con esfuerzo); <1 = planea. Gusto, no medida.
  // 2026-09-23 (Rafa): los sesgos de Shelly 1,3, Kermit 1,6 y Cheeto 1,5
  // eran un parche para la velocidad vieja; con la de ×1,375 se quitan.
  runCadence: {
    sergei: 1.0,
    trunk: 1.0,
    kurama: 1.0,
    shelly: 1.0,
    kermit: 1.0,
    sihans: 1.0,
    kowalski: 1.0,
    cheeto: 1.0,
    sebastian: 1.0,
  },

  // --- Bot brain (balance v2, 2026-08-21) ---
  // Conciencia del borde: sin esto los bots persiguen recto hacia el
  // vacío (el audit midió 2.4-3.0 caídas/partida en todo el roster).
  bots: {
    // Fracción de la aceleración del jugador con la que corre un bot.
    // Estaba escrita a mano en bot.ts (0.55) y online no existía (1.0).
    // 2026-09-21 (Rafa): 0.7 en los dos lados — el bot corre en vez de
    // pasear y el humano le saca 1,43×. Espejo: SIM.bots.moveAccelFactor.
    moveAccelFactor: 0.7,
    edgeMargin: 1.4,      // distancia al borde donde arranca la autoconservación
    edgeSteer: 1.6,       // peso del tirón hacia el centro en pleno borde
    lookAhead: 1.1,       // sonda de vacío por delante (aware de patrones de colapso)
    defendRange: 2.8,     // enemigo a menos de esto + banda de peligro → defensiva
    // Tasas de decisión POR SEGUNDO (review 2026-08-24): las antiguas
    // probabilidades por-frame (0.02, 0.015...) asumían 60 Hz — a 144 Hz
    // los bots casteaban 2.4× más y el server a 30 Hz la mitad. Estos
    // valores son la conversión exacta 1-(1-p)^60 de aquellas, así que
    // a dt=1/60 el comportamiento (y el golden) es idéntico. El roll:
    // matchRng() < (1-(1-rate)^dt) × aggroMul.
    fireRatesPerSec: {
      mobility: 0.702,
      radial: 0.596,
      cone: 0.839,
      ranged: 0.737,
      buff: 0.382,
      // 2026-09-24 (repaso de habilidades §5): the K and L the bot never
      // cast because another slot took their tag first.
      blinkSeek: 0.702,   // Shadow Step (Cheeto K), same rate as the dash
      trap: 0.596,        // Sand Trap (Sihans K), what the server rolled for it as a radial
      grip: 0.5,          // Trunk Grip (Trunk L)
      // All-in (Sebastian L), the rate it had as a buff. Offline only: the
      // online bot doesn't cast it (server/src/sim/bot.ts says why).
      risky: 0.382,
    },
    // Enemies counted as "nearby" (surrounded) and the cap on a radial K's
    // radius when the bot judges it (Trunk Slam reaches 7 u; with the cap
    // it is judged like today). Mirror: SIM.bots.nearbyRadius.
    nearbyRadius: 4.0,
    // A pushing radial K also fires on a single enemy this close, as a
    // fraction of min(radius, nearbyRadius): Sergei's Shockwave never came
    // out in a 1v1 (0 of 81). Mirror: SIM.bots.radialSoloFrac.
    radialSoloFrac: 0.7,
    // Void probe along the FACING before a J (the dash leaves by the
    // facing, not toward the target): both points must be live floor.
    // Sihans fell 0.01-0.14 s after 12 of her 16 falls following a J.
    // Mirror: SIM.bots.dashProbeNear/Far.
    dashProbeNear: 1.0,
    dashProbeFar: 3.0,
    // Snowball only within ±this of the facing: it flies along it, and
    // 17 of 51 audited throws started with the target 150°+ off.
    // Mirror: SIM.bots.rangedAimDeg.
    rangedAimDeg: 35,
    // Grip and Shadow Step aren't spent on someone already at headbutt
    // range. Mirror: SIM.bots.targetedMinRange (Shadow Step).
    targetedMinRange: 3.0,
    // Trunk Grip reaches 28 u, more than the arena's diameter: the bot
    // doesn't yank from the far side. Mirror: SIM.bots.gripMaxRange.
    gripMaxRange: 10,
    // Sand Trap when the nearest enemy stands within zone.radius × this of
    // the bot, so the quicksand left behind catches them.
    // Mirror: SIM.bots.trapRadiusFrac.
    trapRadiusFrac: 0.8,
    // A 'buff' L (Frenzy, Saw Shell, Toxic Touch...) with the nearest enemy
    // closer than this. Mirror: SIM.bots.buffRange.
    buffRange: 3.5,
    // Frozen Floor needs min(2, enemies alive) within floorRadius × this.
    // Mirror: SIM.bots.floorCastRadiusFrac.
    floorCastRadiusFrac: 0.6,
    // Sebastian's All-in: a miss falls into the void. The bot charges only
    // with someone inside the real hit lane narrowed by this inset (u),
    // holds for allInReactionSec like a player would, then re-checks the
    // full lane: a hit resolves, an empty lane drops the charge without
    // spending the cooldown.
    allInLaneInset: 0.4,
    allInReactionSec: 0.5,
  },

  // --- Headbutt ---
  headbutt: {
    anticipation: {
      duration: 0.12,         // wind-up time (readable but quick)
      headRetract: -0.30,     // head pulls back (visible coil)
      bodySquash: 0.70,       // body compresses during wind-up
    },
    lunge: {
      duration: 0.15,         // snap forward (shorter = sharper)
      headExtend: 0.45,       // head reaches further
      velocityBoost: 4.7,     // micro-lunge: critter steps into the hit (4.0 × √1.375 with the 2026-09-21 speed-up, so it still stands out from the run)
    },
    cooldown: 0.45,           // recovery time
    recoilFactor: 0.35,       // attacker bounces back on connect
  },

  // --- Collision ---
  collision: {
    normalPushForce: 3.0,     // casual bumps are gentle nudges
    headbuttMultiplier: 3.5,  // headbutt = headbuttForce * this (Rojo: 14*3.5=49)
    anchoredBounceFactor: 1.925, // × normalPushForce — rebound applied to whoever runs into an anchored critter (Shelly Steel Shell). 1.4 × 1.375 with the 2026-09-21 speed-up: a faster runner must still bounce off
    shellReflectFactor: 0.85,  // headbutting an anchored critter reflects the attacker's OWN force × this (balance v2 mechanic)
    stunnedVulnerability: 4,  // knockback multiplier while stunTimer > 0 (Trunk Slam/Grip follow-ups)
  },

  // --- Charge Rush ---
  chargeRush: {
    impulse: 20,              // directional velocity burst (+25% 2026-04-27 — dash needed more reach across the roster)
    speedMultiplier: 2.5,     // speed during charge
    massMultiplier: 2.0,      // weight during charge (freight train)
    duration: 0.30,           // shorter but intense
    cooldown: 4.0,
    steerFactor: 0.15,        // input reduced to 15% during charge (commitment)
    windUp: 0.06,             // micro-anticipation before launch
  },

  // --- Ground Pound ---
  groundPound: {
    windUp: 0.35,             // visible charge-up
    slowDuringWindUp: 0.15,   // nearly rooted
    radius: 3.5,
    force: 28,                // strong radial knockback
    cooldown: 6.0,
    duration: 0.05,           // instant after wind-up
    windUpSquash: 0.50,       // extreme body compression during wind-up
    windUpHeadDrop: -0.15,    // head sinks during wind-up
  },

  // --- Frenzy (buff ultimate) ---
  frenzy: {
    speedMultiplier: 1.3,     // conservative: 30% faster, tweak after playtest
    massMultiplier: 1.35,     // conservative: harder to push, not unstoppable
    duration: 4.0,            // buff window
    windUp: 0.4,              // visible charge-up before buff starts
    slowDuringWindUp: 0.1,    // nearly rooted while channeling
    cooldown: 18.0,           // ultimate-tier cooldown
  },

  // --- All-in (Sebastian L) resolution. Mirror: SIM.allIn ---
  allIn: {
    hitMargin: 0.55,          // lane half-width = caster radius + target radius + this; only targets ahead count
    missProbeStep: 0.5,       // a miss walks the dash line in these steps to the first point off the arena and falls there
    aimTurnDegPerSec: 360,    // while charging (rooted) the stick turns the facing, and the line with it, this fast: 90° in 0.25 s, a full flip in 0.5 s. Online reader pending in BrawlRoom (DISTRIBUCIÓN)
  },

  // --- Blink landing (Sand Trap, Shadow Step). Mirror: SIM.blink ---
  blink: {
    landingProbeStep: 0.5,    // a target off live floor steps back toward the origin in these steps; none on floor = stay put
  },

  // --- Cone Pulse (Cheeto L) waves. Mirror: SIM.conePulse, which the room
  // doesn't read yet: BrawlRoom writes its own 1.4 / 2.0 (DISTRIBUCIÓN) ---
  // Pulse N is a band waveThickness wide centred N × waveStep ahead, so the
  // last one (pulseCount 6) reaches 6 × 1.4 + 1.0 = 9.4 u: the depth of the
  // cone its entry wedge paints (abilities-runtime spawnLEntryVfx).
  conePulse: {
    waveStep: 1.4,
    waveThickness: 2.0,
  },

  // --- Trunk Grip look. Visual only, no SIM mirror ---
  grip: {
    yankVisualTime: 0.15,     // s the victim's model takes to slide in after the yank; its position is there at once (up to ~7 u in one step)
  },

  // --- Mirror Trick (Kurama K) look. Visual only, no SIM mirror ---
  decoy: {
    ghostAlpha: 0.08,         // Kurama's own opacity while the trick lasts: the decoy is the Kurama on screen (Rafa 2026-05-01: «invisible o casi invisible»)
    fadeFrom: 0.7,            // share of the decoy's life it stays solid, outline included; it fades out over the rest
    arrivalPuffs: 2,          // dust puffs where she reappears: a hint for whoever looks, not a beacon
  },

  // --- L contact passes (Saw Shell, Stampede ram, Toxic Touch). Mirror: SIM.abilities ---
  // Here and not in the ability defs: a def field that a copied L must
  // carry has to join COPYCAT_KEYS on both sides (src/abilities.ts and
  // server/src/sim/abilities.ts); this cooldown belongs to every contact
  // pass, copied or not.
  abilities: {
    contactRehitCooldown: 0.3, // s before the same caster can contact-hit the same victim again (it used to land every frame)
  },

  // --- Match ---
  match: {
    duration: 120,            // seconds total (raised from 90 for 3-life matches)
    countdown: 3,             // seconds before match starts
    // Arena collapse timing lives in `arena-fragments.ts` FRAG config
    // (replaces the old ring-based collapseInterval).
  },

  // --- Lives & Respawn ---
  lives: {
    default: 3,               // lives per critter (may vary per critter later)
    immunityDuration: 1.5,    // seconds of invulnerability after respawn
    respawnDelay: 0.8,        // seconds before critter reappears after falling
    blinkRate: 8,             // blinks per second during immunity
    fallSpeed: 12,            // visual fall speed while descending into the void
  },

  // --- Hit Stop ---
  hitStop: {
    headbutt: 0.07,           // perceptible freeze on headbutt
    groundPound: 0.09,        // heavy slam
    ability: 0.04,            // generic ability hit
    dashHit: 0.03,            // a J's dashHitForce landing (physics.ts rushContact): two frames, a slap next to the headbutt's 0.07
  },

  // --- Camera Shake ---
  shake: {
    headbutt: 0.22,           // amplitude when a headbutt connects
    groundPound: 0.45,        // stronger, it's a slam
    chargeRush: 0.15,         // online dash broadcast; offline, a dash's first contact with each victim (physics.ts rushContact) — fireChargeRush itself has no shake (known drift)
    frenzyFactor: 0.55,       // × groundPound on frenzy activation (offline fireFrenzy and the online event)
    blinkImpactFactor: 0.7,   // × headbutt when a blink's landing hits someone (Cheeto Shadow Step); a miss doesn't shake
    decay: 0.18,              // how fast the shake fades (seconds)
  },

  // --- State glow (Critter.updateVisuals). Visual only, no SIM mirror ---
  // Emissive tint while a headbutt or an ability runs, by kind. The K's
  // wind-up warns «get away, it's coming»; the L's is a buff charging, and
  // until 2026-09-24 both were the same yellow in the nine critters. An
  // ability def can take its own colours: activeGlowHex, activeGlowIntensity
  // and windUpGlowHex (a projectile or blink wind-up only glows with one).
  // Pulsing glows: intensity × (floor + (1 − floor) × wave), wave 0..1 at
  // pulseHz.
  stateGlow: {
    headbuttWindUp: { hex: 0xffffff, intensity: 0.4 },
    headbutt: { hex: 0xffcc00, intensity: 0.8 },
    dash: { hex: 0xff8800, intensity: 0.7 },
    kWindUp: { hex: 0xffff00, intensity: 0.5 },
    kActive: { hex: 0xff2200, intensity: 0.7 },
    lWindUp: { hex: 0xb01000, intensity: 1.0, floor: 0.25, pulseHz: 5 },   // dark red heartbeat: two beats in a 0.4 s wind-up
    lActive: { hex: 0xff1100, intensity: 1.0, floor: 0.6, pulseHz: 1.27 }, // the red pulse the L always had (0.6-1.0)
    cooldownDim: 0.5,         // × intensity while the headbutt is on cooldown
  },

  // --- Hit Flash ---
  hitFlash: {
    duration: 0.11,           // seconds of white-out on target critter
  },

  // --- Scale Feedback ---
  impact: {
    scaleX: 1.35,             // X/Z stretch on receiving hit
    scaleY: 0.6,              // Y squash on receiving hit
    duration: 0.2,
    bounceOvershoot: 1.08,    // slight overshoot before settling
  },

  dash: {
    scaleX: 0.75,             // compressed sideways during dash
    scaleY: 0.80,
    scaleZ: 1.5,              // stretched forward strongly
    duration: 0.2,
    bounceOvershoot: 1.05,
  },

  landing: {
    scaleX: 1.5,              // wide pancake spread
    scaleY: 0.4,              // extreme squash
    duration: 0.3,
    bounceOvershoot: 1.12,    // bouncy recovery
  },

  // --- Headbutt Recovery (visual-only) ---
  headbuttRecovery: {
    headOvershoot: -0.12,     // head bounces back briefly after lunge
    bodyStretch: 1.15,        // body stretches Y on recovery
    duration: 0.12,           // time of recovery pose before neutral
  },

  // --- Knockback Reaction (visual tilt when hit) ---
  // The whole model leans ALONG the knockback — the top goes first, the
  // feet drag — so the critter reads as taking the blow, not just
  // flashing. Fast attack, then a damped return with one small
  // counter-swing. The hit-stop frame already shows `impactLean` of the
  // peak, so the frozen instant reads as the impact pose. The peak lands
  // as the hit flash fades (≈0.12 s after the freeze): under the white
  // the lean doesn't read (measured, docs/FEELING.md §7.10).
  knockbackReaction: {
    tiltAngle: 0.38,          // rad of peak lean along the knockback
    duration: 0.5,            // s, lean + return
    attack: 0.25,             // fraction of the duration spent reaching the peak
    impactLean: 0.55,         // fraction of the peak already on the hit frame
  },

  // --- Accessibility (H4 — prefers-reduced-motion) ---
  // Multiplicador global de los efectos de movimiento de PANTALLA.
  // Cubre: amplitud del camera shake y duración del hit-stop — ambos se
  // escalan en su punto central (triggerCameraShake / triggerHitStop,
  // más abajo), nunca en los callers. NO cubre: squash/stretch, tilt de
  // knockback, hit flash ni animaciones de gameplay — esos comunican
  // QUIÉN recibió el golpe (visibilidad ≠ mareo); el vector de mareo es
  // el movimiento de cámara/congelación de frame. main.ts lo baja a 0.3
  // en el arranque si el SO reporta prefers-reduced-motion: reduce.
  // (El `as` interno mantiene motionScale mutable dentro del `as const`
  // del record — es el único leaf de FEEL que se escribe en runtime.)
  accessibility: {
    motionScale: 1.0,
  } as { motionScale: number },

  // --- Contorno de los bichos (mejora gráfica, 2026-09-24) ---
  // PRESENTACIÓN: casco invertido alrededor de cada bicho (critter-look.ts,
  // regla en STYLE_LOCK.md). Rafa: «contorno» sobre el sombreado actual,
  // sin toon. El ancho va en unidades de MUNDO (~4,5 % del alto de 1,7),
  // así crece con el tamaño del bicho en pantalla, y se recorta a
  // [outlineMinPx, outlineMaxPx] px CSS: se lee en la arena y no se vuelve
  // un marco grueso en los primeros planos. Mutable en vivo (tuner / DevApi).
  look: {
    outline: 1,               // 1 = contorno, 0 = sin él (también `?look=plain`)
    outlineWidth: 0.075,      // u de mundo
    outlineMinPx: 1,          // px CSS. 2 → 1 el 2026-09-24 (Rafa, viendo móvil: «¿quizás es muy grueso?»): en un móvil apaisado los bichos miden 20-25 px y el suelo de 2 px por lado se comía la silueta; en escritorio queda ~1,5 px (lo decide el ancho de mundo)
    outlineMaxPx: 5,          // px CSS
    outlineDepthPush: 0.12,   // u: el casco se aparta hacia el fondo (solo en profundidad, sin moverse en pantalla) para no manchar los huecos del propio bicho (brazos de Kermit, patas de Cheeto)
  } as { outline: number; outlineWidth: number; outlineMinPx: number; outlineMaxPx: number; outlineDepthPush: number },
} as const;

// ---------------------------------------------------------------------------
// Hit Stop — global time scale pause
// ---------------------------------------------------------------------------

let hitStopTimer = 0;

export function triggerHitStop(duration: number): void {
  // Reduced-motion: escalado en el punto central único — ningún caller
  // necesita conocer el ajuste (ver FEEL.accessibility).
  hitStopTimer = Math.max(hitStopTimer, duration * FEEL.accessibility.motionScale);
}

// The gameplay ticks that run outside game.update (ability zones, offline
// L mechanics, projectiles) must freeze with it. applyHitStop runs once
// per offline 'playing' step: `simStep` counts those calls and
// `frozenStep` marks the last one that froze.
let simStep = 0;
let frozenStep = -1;

export function applyHitStop(dt: number): number {
  simStep++;
  if (hitStopTimer > 0) {
    hitStopTimer -= dt;
    frozenStep = simStep;
    return 0;
  }
  return dt;
}

/**
 * A reader of the hit-stop freeze for one of those ticks: call the
 * returned function once at the top of the tick and skip the tick when it
 * says true. It is true only when a step ran since the previous call AND
 * that step froze, so a freeze can't go stale once applyHitStop stops
 * running (pause menu, title, online — where the ticks must keep going).
 */
export function createFrozenFrameGate(): () => boolean {
  let seen = simStep;
  return () => {
    const frozen = simStep !== seen && frozenStep === simStep;
    seen = simStep;
    return frozen;
  };
}

// ---------------------------------------------------------------------------
// Scale Feedback — per-critter deformation state
// ---------------------------------------------------------------------------

interface ScaleEffect {
  targetX: number;
  targetY: number;
  targetZ: number;
  duration: number;
  elapsed: number;
  overshoot: number;
}

const activeEffects = new WeakMap<Critter, ScaleEffect>();

/** `dirX/dirZ`: world direction the hit pushes the critter (any length).
 *  Omitted (a self pulse, an attacker whose push we don't know) → squash
 *  and flash without the lean. */
export function applyImpactFeedback(critter: Critter, dirX = 0, dirZ = 0): void {
  activeEffects.set(critter, {
    targetX: FEEL.impact.scaleX,
    targetY: FEEL.impact.scaleY,
    targetZ: FEEL.impact.scaleX,
    duration: FEEL.impact.duration,
    elapsed: 0,
    overshoot: FEEL.impact.bounceOvershoot,
  });
  // Knockback tilt: lean along the push
  applyKnockbackTilt(critter, dirX, dirZ);
  // Flash white briefly to clearly read the hit
  applyHitFlash(critter);
  // The hit stop that usually follows freezes the game before the next
  // update: show the impact pose now so the freeze is the blow landing.
  critter.showImpactFrame();
}

export function applyDashFeedback(critter: Critter): void {
  activeEffects.set(critter, {
    targetX: FEEL.dash.scaleX,
    targetY: FEEL.dash.scaleY,
    targetZ: FEEL.dash.scaleZ,
    duration: FEEL.dash.duration,
    elapsed: 0,
    overshoot: FEEL.dash.bounceOvershoot,
  });
}

export function applyLandingFeedback(critter: Critter): void {
  activeEffects.set(critter, {
    targetX: FEEL.landing.scaleX,
    targetY: FEEL.landing.scaleY,
    targetZ: FEEL.landing.scaleX,
    duration: FEEL.landing.duration,
    elapsed: 0,
    overshoot: FEEL.landing.bounceOvershoot,
  });
}

/** Update scale deformation with bounce overshoot. */
export function updateScaleFeedback(critter: Critter, dt: number): void {
  const fx = activeEffects.get(critter);
  if (!fx) {
    lerpMeshScale(critter, 1, 1, 1, dt, 10);
    return;
  }

  fx.elapsed += dt;
  const t = Math.min(fx.elapsed / fx.duration, 1);

  // Ease with bounce overshoot: deform → return → slight overshoot → settle
  const ease = bounceEase(t, fx.overshoot);
  const sx = lerp(fx.targetX, 1, ease);
  const sy = lerp(fx.targetY, 1, ease);
  const sz = lerp(fx.targetZ, 1, ease);
  critter.mesh.scale.set(sx, sy, sz);

  if (t >= 1) {
    activeEffects.delete(critter);
  }
}

/** Ease out with overshoot: goes past 1.0 briefly then settles. */
function bounceEase(t: number, overshoot: number): number {
  if (t < 0.6) {
    // Quick return to normal
    const sub = t / 0.6;
    return sub * sub;
  } else if (t < 0.8) {
    // Overshoot past normal
    const sub = (t - 0.6) / 0.2;
    return 1.0 + (overshoot - 1.0) * Math.sin(sub * Math.PI);
  } else {
    // Settle back to 1.0
    const sub = (t - 0.8) / 0.2;
    return 1.0 + (overshoot - 1.0) * (1 - sub) * 0.3;
  }
}

// ---------------------------------------------------------------------------
// Knockback tilt — critter leans along the push when hit
// ---------------------------------------------------------------------------

interface KnockbackTilt {
  elapsed: number;
  dirX: number;  // unit world direction of the push
  dirZ: number;
}

const activeTilts = new WeakMap<Critter, KnockbackTilt>();
const _tiltAxis = new THREE.Vector3();

function applyKnockbackTilt(critter: Critter, dirX: number, dirZ: number): void {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) return;
  activeTilts.set(critter, { elapsed: 0, dirX: dirX / len, dirZ: dirZ / len });
}

/** True while the knockback lean plays (the turn lag holds meanwhile). */
export function isKnockbackLeaning(critter: Critter): boolean {
  return activeTilts.has(critter);
}

/** 0..1 lean envelope: from `impactLean` up to the peak in `attack`, then
 *  back to upright through one small counter-swing (≈ −11 %). */
function knockbackLeanShape(t: number): number {
  const { attack, impactLean } = FEEL.knockbackReaction;
  if (t < attack) {
    return impactLean + (1 - impactLean) * Math.sin((t / attack) * Math.PI * 0.5);
  }
  const u = (t - attack) / (1 - attack);
  return (1 - u) * (1 - u) * Math.cos(u * Math.PI * 1.5);
}

/** Visual lean when hit. GLB critters tilt their `reactionRig` (the model
 *  sits under it) toward the push; the procedural placeholder keeps its
 *  body/head pitch. */
export function updateKnockbackTilt(critter: Critter, dt: number): void {
  const tilt = activeTilts.get(critter);
  if (!tilt) return;

  tilt.elapsed += dt;
  const t = Math.min(tilt.elapsed / FEEL.knockbackReaction.duration, 1);
  const angle = t >= 1 ? 0 : FEEL.knockbackReaction.tiltAngle * knockbackLeanShape(t);
  critter.body.rotation.x = angle;
  critter.head.rotation.x = angle * 0.5;

  const rig = critter.reactionRig;
  if (rig) {
    // World push → the rig's frame (mesh.rotation.y is the facing, and it
    // may turn during the knockback: recomputed every frame so the lean
    // stays on the push, not on the model).
    const yaw = critter.mesh.rotation.y;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const lx = tilt.dirX * c - tilt.dirZ * s;
    const lz = tilt.dirX * s + tilt.dirZ * c;
    // Tip +Y toward (lx, 0, lz): rotate about (lz, 0, −lx).
    rig.quaternion.setFromAxisAngle(_tiltAxis.set(lz, 0, -lx), angle);
  }

  if (t >= 1) activeTilts.delete(critter);
}

// ---------------------------------------------------------------------------
// Yank slide — a one-step teleport shown as a short slide (visual only)
// ---------------------------------------------------------------------------
// Trunk Grip moves its victim up to ~7 u in a single step. The position
// (physics) lands there at once; the model trails behind on the reaction
// rig and catches up over FEEL.grip.yankVisualTime, fast at first and
// settling as it arrives, so the yank reads as a pull instead of a jump
// cut. The placeholder
// mesh (no rig) just snaps.

interface YankSlide {
  elapsed: number;
  offX: number;  // world offset of the model from the position at the start
  offZ: number;
}

const activeYanks = new WeakMap<Critter, YankSlide>();

/** Start the slide of a critter that was just moved from (fromX, fromZ)
 *  to where it is now. */
export function applyYankVisual(critter: Critter, fromX: number, fromZ: number): void {
  if (!critter.reactionRig) return;
  activeYanks.set(critter, { elapsed: 0, offX: fromX - critter.x, offZ: fromZ - critter.z });
  updateYankVisual(critter, 0);
}

export function updateYankVisual(critter: Critter, dt: number): void {
  const yank = activeYanks.get(critter);
  const rig = critter.reactionRig;
  if (!yank || !rig) return;
  yank.elapsed += dt;
  const t = Math.min(yank.elapsed / FEEL.grip.yankVisualTime, 1);
  const left = (1 - t) * (1 - t);
  // World offset → the rig's parent frame (the mesh: facing yaw, then the
  // squash scale), as the knockback lean does for its axis.
  const wx = yank.offX * left;
  const wz = yank.offZ * left;
  const yaw = critter.mesh.rotation.y;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const scale = critter.mesh.scale;
  rig.position.set((wx * c - wz * s) / scale.x, 0, (wx * s + wz * c) / scale.z);
  if (t >= 1) activeYanks.delete(critter);
}

/** Drop a slide in progress (respawn, new match): the model snaps home. */
export function cancelYankVisual(critter: Critter): void {
  activeYanks.delete(critter);
  critter.reactionRig?.position.set(0, 0, 0);
}

// ---------------------------------------------------------------------------
// Headbutt recovery pose
// ---------------------------------------------------------------------------

const activeRecoveries = new WeakMap<Critter, { elapsed: number }>();

export function applyHeadbuttRecovery(critter: Critter): void {
  activeRecoveries.set(critter, { elapsed: 0 });
}

export function updateHeadbuttRecovery(critter: Critter, dt: number): void {
  const rec = activeRecoveries.get(critter);
  if (!rec) return;

  rec.elapsed += dt;
  const t = Math.min(rec.elapsed / FEEL.headbuttRecovery.duration, 1);
  // Head bounces back, body stretches up
  critter.head.position.z = FEEL.headbuttRecovery.headOvershoot * (1 - t);
  critter.body.scale.y = lerp(FEEL.headbuttRecovery.bodyStretch, 1.0, t);

  if (t >= 1) {
    critter.head.position.z = 0;
    critter.body.scale.y = 1.0;
    activeRecoveries.delete(critter);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpMeshScale(critter: Critter, tx: number, ty: number, tz: number, dt: number, speed: number): void {
  const s = critter.mesh.scale;
  const f = Math.min(dt * speed, 1);
  s.x += (tx - s.x) * f;
  s.y += (ty - s.y) * f;
  s.z += (tz - s.z) * f;
}

// ---------------------------------------------------------------------------
// Camera shake — global, decays over time
// ---------------------------------------------------------------------------

let shakeAmount = 0;
let shakeTimer = 0;

/** Trigger a shake with given peak amplitude. Stacks by taking the max.
 *  Reduced-motion: la amplitud se escala AQUÍ (punto central único) por
 *  FEEL.accessibility.motionScale — ver el comentario de ese bloque. */
export function triggerCameraShake(intensity: number): void {
  shakeAmount = Math.max(shakeAmount, intensity * FEEL.accessibility.motionScale);
  shakeTimer = FEEL.shake.decay;
}

/**
 * Apply the current shake to the camera.
 * Caller provides the base (unshaken) camera position so this function can
 * always write an absolute value (no accumulation errors).
 */
export function updateCameraShake(
  camera: THREE.PerspectiveCamera,
  baseX: number, baseY: number, baseZ: number,
  dt: number,
): void {
  if (shakeTimer <= 0) {
    camera.position.set(baseX, baseY, baseZ);
    shakeAmount = 0;
    return;
  }
  shakeTimer -= dt;
  const tNorm = Math.max(0, shakeTimer / FEEL.shake.decay); // 1 → 0
  const amp = shakeAmount * tNorm * tNorm;                   // quadratic fade
  camera.position.x = baseX + (Math.random() - 0.5) * 2 * amp;
  camera.position.y = baseY + (Math.random() - 0.5) * 2 * amp;
  // Don't shake Z — keeps arena framing stable
  camera.position.z = baseZ;
}

// ---------------------------------------------------------------------------
// Hit Flash — target critter flashes white briefly on impact
// ---------------------------------------------------------------------------

const hitFlashTimers = new WeakMap<Critter, number>();

function applyHitFlash(critter: Critter): void {
  hitFlashTimers.set(critter, FEEL.hitFlash.duration);
}

/** Returns the current flash intensity 0..1, or 0 if inactive. Ticks internally. */
export function tickHitFlash(critter: Critter, dt: number): number {
  const t = hitFlashTimers.get(critter);
  if (t === undefined) return 0;
  const newT = t - dt;
  if (newT <= 0) {
    hitFlashTimers.delete(critter);
    return 0;
  }
  hitFlashTimers.set(critter, newT);
  return newT / FEEL.hitFlash.duration;
}
