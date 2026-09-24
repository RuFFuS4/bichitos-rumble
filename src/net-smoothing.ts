// ---------------------------------------------------------------------------
// net-smoothing — dónde se PINTA a cada bicho online (solo visual)
// ---------------------------------------------------------------------------
//
// El servidor manda el estado a 20 Hz (un parche cada 50 ms) y simula a
// 30 Hz, así que cada parche trae 1 o 2 ticks de movimiento. Colocar al
// bicho en la última posición recibida lo mueve a saltos (2 de cada 3
// frames parado a 60 Hz, saltos de 6-12 px con Sebastian); perseguirla con
// un lerp lo deja ~80 ms detrás y pulsando entre 0,55× y 1,5× de su
// velocidad. Medido el 2026-09-24 (ONLINE.md → "Suavizado online").
//
// Aquí cada bicho tiene una posición VISUAL propia:
//   1. PREDICCIÓN (dead reckoning): desde el último estado, repite el paso
//      de integración de BrawlRoom tick a tick y EN SU ORDEN (sumar empuje →
//      mover → fricción → zona muerta → tope) hasta la hora de servidor
//      estimada de ahora. El empuje por tick se deduce de dos estados
//      seguidos del mismo bicho; un salto de v que ningún mando puede dar es
//      un golpe, no un mando.
//   2. CORRECCIÓN SUAVE: V = T + E, con T la predicción y E = V − T el error
//      visual, que decae como e^(−Δt/correctionTime). Lo bien predicho se
//      mueve solo; lo que no cuadra al llegar un parche (giro, choque) se
//      reparte en unos frames en vez de pintarse de golpe.
//
// Tres detalles que no son de gusto sino de medida:
//   · El servidor publica v DESPUÉS de la fricción del tick, pero el tick
//     siguiente avanza con v + d: en crucero el bicho recorre 1/f ≈ 1,335
//     veces la v publicada. Extrapolar con la v cruda se queda un 25 % corto.
//   · Al soltar el mando el servidor frena con la fricción de parada (0,03 s
//     frente a 0,08). Al local se le sabe el mando; a un remoto se le nota
//     porque su empuje deducido va CONTRA su marcha. En los dos casos se
//     predice sin empuje y con esa fricción: si no, se pasa de largo y
//     rebota (8-17 px medidos).
//   · La edad del estado sale del reloj de simulación que ya viaja en el
//     estado (`matchTimer` baja exactamente 1/30 por tick y solo en
//     'playing'): un parche de 1 tick y uno de 2 llegan con 0 o 16,7 ms de
//     antigüedad, y por hora de llegada no se distinguen.
//
// NO decide nada de gameplay: el servidor es la autoridad. Lo que el
// cliente lee de c.x/c.z online (malla, sombra, iconos, portal, overlay de
// veneno) pasa a leer la posición visual, que es la del servidor "ahora" en
// vez de la de hace 25-80 ms. Sin cambios de protocolo: solo lee campos que
// ya viajan.
//
// Sin imports a propósito: se prueba en node tal cual (tests/sim) y el
// banco de réplica (scripts/net-smoothing-bench.mjs) lo carga sin bundler.
// ---------------------------------------------------------------------------

/** Tuning del suavizado online. Mutable a propósito: superficie
 *  programática (`__game.netSmoother.config` en la página del juego, y
 *  `--set clave=valor` en scripts/net-smoothing-bench.mjs). */
export const NET_SMOOTHING = {
  /** 'dr' = predicción + corrección. 'legacy' = lo de antes (snap local,
   *  lerp remoto), para A/B: `?netsmooth=legacy` en la URL. */
  mode: 'dr' as 'dr' | 'legacy',
  /** Suavizar también a los rivales (si no, lerp legacy):
   *  `?netsmooth=localonly` lo apaga. */
  remotes: true,
  /** s — constante de tiempo con la que el error visual converge al
   *  servidor (63 % en este tiempo, 95 % en el triple). Banco: 45-80 ms
   *  igual de bien; menos = más fiel en giros, más = más liso. */
  correctionTime: 0.06,
  /** s — edad máxima que se extrapola un estado: un parche normal llega
   *  con ≤ 67 ms. Tapa parches perdidos o un servidor que se para sin que
   *  el bicho se escape. */
  maxExtrapolation: 0.15,
  /** u — si la posición visual y la del servidor se separan más, se salta
   *  (blink 4,5-6,5 u, decoy 7 u). Por encima del peor error de predicción
   *  razonable: maxSpeed 20 u/s × (2 ticks + margen) ≈ 3,3 u. */
  snapDistance: 3.5,
  /** s — un frame más largo que esto (pestaña en segundo plano) salta a
   *  la posición actual en vez de recorrer el hueco. */
  maxFrameGap: 0.25,
  /** s/s — lo que puede crecer por segundo la estimación de latencia (la
   *  mínima observada). Deja seguir a una red que empeora (+50 ms en 2,5 s)
   *  sin flotar por encima del mínimo con jitter. */
  clockCreep: 0.02,
  /** Hz — tick de simulación del servidor (espejo de SIM.tickRate; lo
   *  amarra tests/sim/net-smoothing.test.ts). */
  serverTickHz: 30,
  /** 1/s — el lerp remoto de antes, solo para mode 'legacy'. */
  legacyRemoteLerp: 15,
};

export type NetSmoothingConfig = typeof NET_SMOOTHING;

// A/B en la carga (mismo patrón que `?look=plain`, src/critter-look.ts).
// En node no hay `location`.
if (typeof location !== 'undefined') {
  const q = new URLSearchParams(location.search).get('netsmooth');
  if (q === 'legacy') NET_SMOOTHING.mode = 'legacy';
  else if (q === 'localonly') NET_SMOOTHING.remotes = false;
}

/** Lo que el suavizado lee de un jugador del estado (PlayerSchema). Los
 *  campos pueden faltar en el primer parche tras unirse. */
export interface NetPlayerState {
  x?: number; z?: number; vx?: number; vz?: number;
  alive?: boolean; falling?: boolean; fallY?: number;
}

/** Números de movimiento del servidor que necesita la predicción. Se
 *  inyectan desde FEEL (espejo de SIM, lo amarra feel-sim-parity.test.ts):
 *  si PERSONAJES los cambia, la predicción los sigue sola. */
export interface NetMovement {
  frictionHalfLife: number;
  idleFrictionHalfLife: number;
  maxSpeed: number;
  velocityDeadZone: number;
  /** u/s — velocidad de caída al vacío (FEEL.lives.fallSpeed). */
  fallSpeed: number;
}

/** Dónde pintar el bicho este frame. `y` = desplazamiento vertical de la
 *  caída al vacío (0 si no cae). */
export interface NetPlacement { x: number; z: number; y: number }

interface Track {
  x: number; z: number;       // posición visual
  tMs: number;                // hora del último place()
  alive: boolean; falling: boolean;
  n: number;                  // tick del último estado visto de este bicho
  vx: number; vz: number;     // su v publicada en ese estado
  dx: number; dz: number;     // empuje de input por tick (NaN = sin historia)
  braking: boolean;           // su empuje deducido va contra su marcha
}

type SnapReason = 'first' | 'frameGap' | 'respawn' | 'distance';

const num = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Muestras recientes para stats() (ventana fija, sin crecer). */
class Ring {
  private buf: number[] = [];
  private i = 0;
  constructor(private readonly size: number) {}
  push(v: number): void {
    if (this.buf.length < this.size) this.buf.push(v);
    else { this.buf[this.i] = v; this.i = (this.i + 1) % this.size; }
  }
  pct(p: number): number {
    if (!this.buf.length) return NaN;
    const s = [...this.buf].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }
  get count(): number { return this.buf.length; }
}

/**
 * Posición visual de cada bicho online. Una instancia por Game; las pistas
 * se indexan por el objeto Critter (WeakMap: se van con él).
 */
export class NetSmoother {
  readonly config: NetSmoothingConfig;
  /** FEEL.movement + fallSpeed (se inyecta: módulo sin imports). */
  private readonly movement: () => NetMovement;
  private tracks = new WeakMap<object, Track>();
  // Reloj de servidor: offset = hora cliente − hora servidor (ms), la
  // mínima observada (≈ entrega sin cola), con permiso de subir despacio.
  private offsetMs = NaN;
  private stateMs = NaN;     // hora de servidor del último estado (ms)
  private lastMt = NaN;
  private lastNowMs = NaN;
  private playing = false;
  private nowMs = 0;
  /** ¿El jugador local está empujando? (undefined = aún no se sabe). */
  private localHeld: boolean | undefined;
  // stats()
  private ages = new Ring(240);
  private corrections = new Ring(240);
  private snaps: Record<SnapReason, number> = { first: 0, frameGap: 0, respawn: 0, distance: 0 };
  private frames = 0;

  constructor(movement: () => NetMovement, config: NetSmoothingConfig = NET_SMOOTHING) {
    this.movement = movement;
    this.config = config;
  }

  /** Hora exacta de llegada de un parche (room.onStateChange). Solo cuenta
   *  en 'playing': fuera, matchTimer está quieto o vale otra cosa y
   *  desviaría el reloj. Opcional: sin ella la llegada se toma en el primer
   *  frame que lo ve (hasta un frame tarde). */
  notePatch(arrivalMs: number, matchTimer: number | undefined, phase?: string): void {
    if (phase !== undefined && phase !== 'playing') return;
    if (typeof matchTimer !== 'number' || !Number.isFinite(matchTimer) || matchTimer === this.lastMt) return;
    const s = -matchTimer * 1000;
    if (Number.isFinite(this.lastNowMs) && Number.isFinite(this.offsetMs)) {
      this.offsetMs += this.config.clockCreep * Math.max(0, arrivalMs - this.lastNowMs);
    }
    this.lastNowMs = Math.max(arrivalMs, Number.isFinite(this.lastNowMs) ? this.lastNowMs : arrivalMs);
    // Primer parche o partida nueva (matchTimer vuelve arriba): rearmar.
    if (!Number.isFinite(this.offsetMs) || !(s > this.stateMs)) this.offsetMs = arrivalMs - s;
    else this.offsetMs = Math.min(this.offsetMs, arrivalMs - s);
    this.stateMs = s;
    this.lastMt = matchTimer;
  }

  /** Una vez por frame, antes de colocar a nadie. `playing` = el servidor
   *  está integrando posiciones (phase 'playing'). */
  beginFrame(nowMs: number, matchTimer: number | undefined, playing: boolean): void {
    this.nowMs = nowMs;
    this.frames++;
    this.playing = playing && typeof matchTimer === 'number' && Number.isFinite(matchTimer);
    if (!this.playing) {
      this.offsetMs = NaN; this.lastMt = NaN; this.stateMs = NaN; this.lastNowMs = NaN;
      return;
    }
    this.notePatch(nowMs, matchTimer);          // sin hook: llega "ahora"
    if (Number.isFinite(this.lastNowMs) && Number.isFinite(this.offsetMs) && nowMs > this.lastNowMs) {
      this.offsetMs += this.config.clockCreep * (nowMs - this.lastNowMs);
      this.lastNowMs = nowMs;
    }
    this.ages.push(this.ageAt(nowMs) * 1000);
  }

  /** El mando del jugador local este frame (el mismo que se manda con
   *  sendInput). Umbral del servidor: |input| > 0,01 cuenta como empuje. */
  noteLocalInput(mx: number, mz: number): void {
    this.localHeld = Math.hypot(mx, mz) > 0.01;
  }

  /**
   * Dónde pintar `key` (el Critter) este frame. `dt` es el del bucle (con
   * su tope): solo lo usa el modo legacy; el resto va con la hora real.
   */
  place(key: object, p: NetPlayerState, isLocal: boolean, dt: number): NetPlacement {
    const cfg = this.config;
    let tr = this.tracks.get(key);
    const sx = num(p.x, tr?.x ?? 0), sz = num(p.z, tr?.z ?? 0);
    const svx = num(p.vx, 0), svz = num(p.vz, 0);
    const alive = p.alive ?? true, falling = p.falling ?? false;
    const fallY = num(p.fallY, 0);

    if (cfg.mode !== 'dr' || (!isLocal && !cfg.remotes)) {
      // Comportamiento anterior (A/B): snap local, lerp remoto.
      if (!tr || isLocal) {
        tr = this.fresh(sx, sz, svx, svz, alive, falling);
        this.tracks.set(key, tr);
      } else {
        const a = Math.min(1, dt * cfg.legacyRemoteLerp);
        tr.x += (sx - tr.x) * a;
        tr.z += (sz - tr.z) * a;
      }
      tr.tMs = this.nowMs; tr.alive = alive; tr.falling = falling;
      return { x: tr.x, z: tr.z, y: fallY };
    }

    // El servidor solo integra a los vivos que no caen y solo en 'playing';
    // fuera de eso v puede quedarse con el último valor y no hay que usarla.
    const moving = this.playing && alive && !falling;
    const mv = this.movement();
    const fresh = tr && moving ? this.estimateDrive(tr, svx, svz, mv) : false;
    const brake = this.brakes(tr, isLocal);

    const [tx, tz] = moving ? this.predict(tr, brake, sx, sz, svx, svz, this.ageAt(this.nowMs), mv) : [sx, sz];
    // La caída baja a velocidad constante: se extrapola exacta, sin corregir.
    const y = this.playing && alive && falling
      ? fallY - mv.fallSpeed * Math.max(0, this.ageAt(this.nowMs))
      : fallY;

    const gap = tr ? (this.nowMs - tr.tMs) / 1000 : Infinity;
    const snap: SnapReason | null = !tr ? 'first'
      : gap > cfg.maxFrameGap ? 'frameGap'
        : (tr.falling && !falling) || (!tr.alive && alive) ? 'respawn'
          : Math.hypot(tx - tr.x, tz - tr.z) > cfg.snapDistance ? 'distance'
            : null;
    if (!tr || snap) {
      this.snaps[snap ?? 'first']++;
      const fr = this.fresh(tx, tz, svx, svz, alive, falling);
      if (tr) { fr.n = tr.n; fr.dx = tr.dx; fr.dz = tr.dz; fr.braking = tr.braking; }
      this.tracks.set(key, fr);
      return { x: fr.x, z: fr.z, y };
    }
    if (gap > 0) {
      // E = V − T(frame anterior), con el modelo de AHORA; decae y se suma
      // a la predicción de ahora.
      const [px, pz] = moving ? this.predict(tr, brake, sx, sz, svx, svz, this.ageAt(tr.tMs), mv) : [sx, sz];
      const ex = tr.x - px, ez = tr.z - pz;
      if (fresh) this.corrections.push(Math.hypot(ex, ez));
      const k = Math.exp(-gap / cfg.correctionTime);
      tr.x = tx + ex * k;
      tr.z = tz + ez * k;
    }
    tr.tMs = this.nowMs; tr.alive = alive; tr.falling = falling;
    return { x: tr.x, z: tr.z, y };
  }

  /** Para medir contra un servidor real (`__game.netSmoother.stats()`):
   *  desfase del reloj, edad de los estados que se extrapolan, tamaño de
   *  las correcciones al llegar un estado nuevo y saltos directos. */
  stats() {
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      mode: this.config.mode,
      remotes: this.config.remotes,
      playing: this.playing,
      clockOffsetMs: r(this.offsetMs),
      stateAgeMs: { p50: r(this.ages.pct(0.5)), p95: r(this.ages.pct(0.95)), samples: this.ages.count },
      correctionU: { p50: r(this.corrections.pct(0.5) * 100) / 100, p95: r(this.corrections.pct(0.95) * 100) / 100, samples: this.corrections.count },
      snaps: { ...this.snaps },
      frames: this.frames,
    };
  }

  /** s desde el estado más reciente a la hora `tMs` (tope maxExtrapolation;
   *  negativa si `tMs` es anterior al estado). */
  private ageAt(tMs: number): number {
    if (!Number.isFinite(this.offsetMs)) return 0;
    return Math.min((tMs - this.offsetMs - this.stateMs) / 1000, this.config.maxExtrapolation);
  }

  private fresh(x: number, z: number, vx: number, vz: number, alive: boolean, falling: boolean): Track {
    return { x, z, tMs: this.nowMs, alive, falling, n: NaN, vx, vz, dx: NaN, dz: NaN, braking: false };
  }

  /** ¿Predecir frenada (sin empuje, fricción de parada)? Al local se le
   *  sabe el mando; a un remoto se le deduce. */
  private brakes(tr: Track | undefined, isLocal: boolean): boolean {
    if (isLocal && this.localHeld !== undefined) return !this.localHeld;
    return !!tr?.braking;
  }

  /** Posición de servidor predicha a `age` s del último estado: el paso de
   *  integración de BrawlRoom (sumar empuje → mover → fricción → zona muerta
   *  → tope), tick a tick. */
  private predict(tr: Track | undefined, brake: boolean, x: number, z: number, vx: number, vz: number, age: number, mv: NetMovement): [number, number] {
    const dt = 1 / this.config.serverTickHz;
    const fDrive = Math.pow(0.5, dt / mv.frictionHalfLife);
    let dx = 0, dz = 0;
    if (!brake) {
      // Sin historia: suponer crucero (d = v·(1/f − 1)).
      dx = tr && Number.isFinite(tr.dx) ? tr.dx : vx * (1 / fDrive - 1);
      dz = tr && Number.isFinite(tr.dz) ? tr.dz : vz * (1 / fDrive - 1);
    }
    const f = brake ? Math.pow(0.5, dt / mv.idleFrictionHalfLife) : fDrive;
    // Zona muerta del servidor: solo en inercia, que incluye un empuje que
    // ni a velocidad terminal supera el umbral (BrawlRoom, pushTerminal).
    const coasting = brake || (Math.hypot(dx, dz) / dt) * mv.frictionHalfLife / Math.LN2 < mv.velocityDeadZone;
    // Hacia atrás (frame anterior al estado): lineal con la v del tick siguiente.
    if (age <= 0) return [x + (vx + dx) * age, z + (vz + dz) * age];
    for (let ticks = age / dt; ticks > 0; ticks -= 1) {
      const frac = Math.min(1, ticks);
      let wx = vx + dx, wz = vz + dz;
      x += wx * dt * frac; z += wz * dt * frac;
      wx *= f; wz *= f;
      const s = Math.hypot(wx, wz);
      if (coasting && s < mv.velocityDeadZone) { wx = 0; wz = 0; }
      else if (s > mv.maxSpeed) { wx *= mv.maxSpeed / s; wz *= mv.maxSpeed / s; }
      vx = wx; vz = wz;
    }
    return [x, z];
  }

  /** Empuje de input por tick a partir de dos estados del bicho separados
   *  m ticks: v_k = v_{k−m}·f^m + d·(f + … + f^m). Devuelve true si este
   *  frame trae un estado nuevo del bicho.
   *   · Empuje CONTRA la marcha → frenada (o cambio de sentido): se predice
   *     sin empuje y con fricción de parada. Se mira antes que el tamaño,
   *     porque frenar desde crucero da un "empuje" mayor que el máximo.
   *   · Empuje imposible a favor de la marcha o de lado → golpe (choque,
   *     cabezazo, knockback): no es mando, se sigue con el de antes. */
  private estimateDrive(tr: Track, vx: number, vz: number, mv: NetMovement): boolean {
    const hz = this.config.serverTickHz;
    const n = Math.round((this.stateMs / 1000) * hz);
    if (n === tr.n) return false;
    const m = n - tr.n;
    if (m >= 1 && m <= 4) {
      const f = Math.pow(0.5, 1 / hz / mv.frictionHalfLife);
      const fm = Math.pow(f, m);
      const S = (f * (1 - fm)) / (1 - f);
      const dx = (vx - tr.vx * fm) / S, dz = (vz - tr.vz * fm) / S;
      const plausible = Math.hypot(dx, dz) <= mv.maxSpeed * (1 - f);
      if (dx * vx + dz * vz < 0) {
        tr.braking = true;
        if (plausible) { tr.dx = dx; tr.dz = dz; }
      } else if (plausible) {
        tr.braking = false; tr.dx = dx; tr.dz = dz;
      }
    } else {
      tr.dx = NaN; tr.dz = NaN; tr.braking = false;
    }
    tr.n = n; tr.vx = vx; tr.vz = vz;
    return true;
  }
}
