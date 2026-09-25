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
//     frente a 0,08). Al local se le sabe el mando, pero el servidor lo
//     recibe medio RTT después y el cliente ve el efecto un RTT después: se
//     usa el mando de hace un RTT (room.ping). Frenar en el acto dejaba un
//     diente de sierra de velocidad de ~200 ms a RTT 160. A un remoto se le
//     nota porque su empuje deducido va CONTRA su marcha. En los dos casos
//     se predice sin empuje y con esa fricción: si no, se pasa de largo y
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
  /** u — red de seguridad: si la posición visual y la del servidor se
   *  separan más, se salta sin repartir. Los teleports de verdad (blink,
   *  decoy, Grip) los caza antes `teleportDistance`, también los cortos. */
  snapDistance: 3.5,
  /** u — un estado nuevo que cae más lejos que esto de donde el servidor
   *  tenía que llevar al bicho desde el anterior, con el bicho casi parado
   *  (blink, decoy y Grip ponen v = 0), es un teleport: salto directo. Sin
   *  esto, un blink de < snapDistance se deslizaba ~200 ms a 44-53 u/s. */
  teleportDistance: 0.75,
  /** u/s — "casi parado" para lo anterior: un tick de empuje tras aterrizar
   *  deja |v| ≈ 1 u/s; un knockback, mucho más. */
  teleportMaxSpeed: 2.5,
  /** s — un frame más largo que esto (pestaña en segundo plano) salta a
   *  la posición actual en vez de recorrer el hueco. */
  maxFrameGap: 0.25,
  /** s — ventana del reloj: el desfase cliente↔servidor es el mínimo de
   *  (llegada − hora de servidor) en esta ventana. Sigue a un servidor que
   *  va algo lento (Linux dio setInterval de 34,4-35,6 ms en vez de 33,3) y
   *  se recupera de un tirón del servidor en ~1 s; con el mínimo histórico
   *  la edad se quedaba saturada en maxExtrapolation y volvían los saltos. */
  clockWindow: 1.0,
  /** s — cada cuánto se mide el RTT (room.ping) para saber cuándo le llega
   *  al servidor que el jugador local soltó el mando. */
  pingInterval: 1.0,
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
  /** Integraciones por tick del servidor (FEEL.movement.integrationSubsteps,
   *  espejo de SIM). Sin el campo, 1 (servidores anteriores a v1.9). */
  integrationSubsteps?: number;
}

/** Dónde pintar el bicho este frame. `y` = desplazamiento vertical de la
 *  caída al vacío (0 si no cae). */
export interface NetPlacement { x: number; z: number; y: number }

interface Track {
  x: number; z: number;       // posición visual
  tMs: number;                // hora del último place()
  alive: boolean; falling: boolean;
  n: number;                  // tick del último estado visto de este bicho
  sx: number; sz: number;     // su posición publicada en ese estado
  vx: number; vz: number;     // su v publicada en ese estado
  dx: number; dz: number;     // empuje de input por tick (NaN = sin historia)
  braking: boolean;           // su empuje deducido va contra su marcha
}

type SnapReason = 'first' | 'frameGap' | 'respawn' | 'teleport' | 'distance';

/** Qué trae este frame para un bicho: nada nuevo, un estado nuevo, o un
 *  estado nuevo que es un teleport. */
type StateNews = 'none' | 'new' | 'teleport';

const num = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Muestras recientes para stats() (ventana fija, sin crecer). Sin
 *  parameter properties: el type stripping de Node 22 no las admite y el
 *  banco carga este módulo tal cual. */
class Ring {
  private buf: number[] = [];
  private i = 0;
  private readonly size: number;
  constructor(size: number) { this.size = size; }
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
  // Reloj de servidor: offset = hora cliente − hora servidor (ms), el mínimo
  // de (llegada − hora de servidor) en los últimos clockWindow s (≈ entrega
  // sin cola).
  private offsetMs = NaN;
  private clockSamples: Array<[arrivalMs: number, offsetMs: number]> = [];
  private stateMs = NaN;     // hora de servidor del último estado (ms)
  private lastMt = NaN;
  private playing = false;
  private nowMs = 0;
  // Mando local: cambios [hora, empuja] y RTT (room.ping) para mirar el
  // mando de hace un RTT, que es el que ya ha visto el servidor.
  private localInput: Array<[tMs: number, held: boolean]> = [];
  private rtts: number[] = [];
  private rttMs = NaN;
  private lastPingMs = -Infinity;
  // stats()
  private ages = new Ring(240);
  private corrections = new Ring(240);
  private snaps: Record<SnapReason, number> = { first: 0, frameGap: 0, respawn: 0, teleport: 0, distance: 0 };
  private saturated = 0;
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
    // Primer parche o partida nueva (matchTimer vuelve arriba): rearmar.
    if (!Number.isFinite(this.offsetMs) || !(s > this.stateMs)) this.clockSamples = [];
    const win = this.clockSamples;
    win.push([arrivalMs, arrivalMs - s]);
    while (win.length > 1 && win[0][0] < arrivalMs - this.config.clockWindow * 1000) win.shift();
    let min = Infinity;
    for (const [, o] of win) if (o < min) min = o;
    this.offsetMs = min;
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
      this.offsetMs = NaN; this.lastMt = NaN; this.stateMs = NaN; this.clockSamples = [];
      return;
    }
    this.notePatch(nowMs, matchTimer);          // sin hook: llega "ahora"
    const age = this.ageAt(nowMs);
    this.ages.push(age * 1000);
    if (age >= this.config.maxExtrapolation) this.saturated++;
  }

  /** El mando del jugador local (el mismo que se manda con sendInput), con
   *  la hora a la que se envía. Umbral del servidor: |input| > 0,01. */
  noteLocalInput(mx: number, mz: number, tMs: number = this.nowMs): void {
    const held = Math.hypot(mx, mz) > 0.01;
    const log = this.localInput;
    if (!log.length || log[log.length - 1][1] !== held) log.push([tMs, held]);
    // Basta con lo que cabe en un RTT generoso.
    while (log.length > 2 && log[1][0] < tMs - 2000) log.shift();
  }

  /** RTT medido (ms): room.ping. Se usa la mediana de los últimos 5. */
  noteRtt(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.rtts.push(ms);
    if (this.rtts.length > 5) this.rtts.shift();
    const s = [...this.rtts].sort((a, b) => a - b);
    this.rttMs = s[s.length >> 1];
  }

  /** Pide un ping como mucho cada pingInterval s: `ping` = (cb) =>
   *  room.ping(cb). Una línea en el bucle online y el módulo sigue sin
   *  saber nada de Colyseus. */
  maybePing(nowMs: number, ping: (cb: (ms: number) => void) => void): void {
    if (nowMs - this.lastPingMs < this.config.pingInterval * 1000) return;
    this.lastPingMs = nowMs;
    ping((ms) => this.noteRtt(ms));
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
        tr = this.fresh(sx, sz, sx, sz, svx, svz, alive, falling);
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
    const brakeBefore = this.brakes(tr, isLocal);
    const news: StateNews = tr && moving ? this.estimateDrive(tr, sx, sz, svx, svz, brakeBefore, mv) : 'none';
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
          : news === 'teleport' ? 'teleport'
            : Math.hypot(tx - tr.x, tz - tr.z) > cfg.snapDistance ? 'distance'
              : null;
    if (!tr || snap) {
      this.snaps[snap ?? 'first']++;
      const fr = this.fresh(tx, tz, sx, sz, svx, svz, alive, falling);
      if (tr) { fr.n = tr.n; fr.dx = tr.dx; fr.dz = tr.dz; fr.braking = tr.braking; }
      this.tracks.set(key, fr);
      return { x: fr.x, z: fr.z, y };
    }
    if (falling) {
      // Quien cae ya no se mueve en el servidor: se queda donde se le ve
      // caer. Corregir hacia el punto del servidor lo hacía retroceder
      // 10-18 px hacia la arena tras un golpe.
      tr.tMs = this.nowMs; tr.alive = alive; tr.falling = falling;
      return { x: tr.x, z: tr.z, y };
    }
    if (gap > 0) {
      // E = V − T(frame anterior), con el modelo de AHORA; decae y se suma
      // a la predicción de ahora.
      const [px, pz] = moving ? this.predict(tr, brake, sx, sz, svx, svz, this.ageAt(tr.tMs), mv) : [sx, sz];
      const ex = tr.x - px, ez = tr.z - pz;
      if (news !== 'none') this.corrections.push(Math.hypot(ex, ez));
      const k = Math.exp(-gap / cfg.correctionTime);
      tr.x = tx + ex * k;
      tr.z = tz + ez * k;
    }
    tr.tMs = this.nowMs; tr.alive = alive; tr.falling = falling;
    return { x: tr.x, z: tr.z, y };
  }

  /** Para medir contra un servidor real (`__game.netSmoother.stats()`):
   *  desfase del reloj, edad de los estados que se extrapolan (y cuántos
   *  frames la tenían saturada en maxExtrapolation: si sube, el reloj no
   *  sigue al servidor), RTT, tamaño de las correcciones al llegar un estado
   *  nuevo y saltos directos por motivo. */
  stats() {
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      mode: this.config.mode,
      remotes: this.config.remotes,
      playing: this.playing,
      clockOffsetMs: r(this.offsetMs),
      rttMs: r(this.rttMs),
      stateAgeMs: { p50: r(this.ages.pct(0.5)), p95: r(this.ages.pct(0.95)), samples: this.ages.count },
      saturatedFrames: this.saturated,
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

  private fresh(x: number, z: number, sx: number, sz: number, vx: number, vz: number, alive: boolean, falling: boolean): Track {
    return { x, z, tMs: this.nowMs, alive, falling, n: NaN, sx, sz, vx, vz, dx: NaN, dz: NaN, braking: false };
  }

  /** ¿Empujaba el jugador local a la hora `tMs`? (undefined = no se sabe). */
  private localHeldAt(tMs: number): boolean | undefined {
    let held: boolean | undefined;
    for (const [t, h] of this.localInput) {
      if (t > tMs) break;
      held = h;
    }
    return held;
  }

  /** ¿Predecir frenada (sin empuje, fricción de parada)? Al local se le
   *  sabe el mando: el de hace un RTT, que es el que ya ha visto el
   *  servidor del estado que se está extrapolando. Sin RTT todavía, o a un
   *  remoto, se le deduce. */
  private brakes(tr: Track | undefined, isLocal: boolean): boolean {
    if (isLocal && Number.isFinite(this.rttMs)) {
      const held = this.localHeldAt(this.nowMs - this.rttMs);
      if (held !== undefined) return !held;
    }
    return !!tr?.braking;
  }

  /** Posición de servidor predicha a `age` s del último estado: el paso de
   *  integración de BrawlRoom tick a tick — sumar el empuje del mando (uno
   *  por tick) y, en cada uno de sus `integrationSubsteps` sub-pasos, mover
   *  → fricción → zona muerta → tope. Los sub-pasos dan dónde ACABA cada
   *  tick; dentro del tick se interpola en línea recta. El servidor solo
   *  existe en los ticks: pintar la forma de los sub-pasos metía un diente
   *  de sierra de velocidad del 13 % a 30 Hz (medido con el banco). */
  private predict(tr: Track | undefined, brake: boolean, x: number, z: number, vx: number, vz: number, age: number, mv: NetMovement): [number, number] {
    const dt = 1 / this.config.serverTickHz;
    const n = Math.max(1, Math.round(mv.integrationSubsteps ?? 1));
    const h = dt / n;
    // Fricción por tick = (fricción por sub-paso)^n: la deducción del empuje
    // (estimateDrive) no depende de los sub-pasos.
    const fDrive = Math.pow(0.5, dt / mv.frictionHalfLife);
    let dx = 0, dz = 0;
    if (!brake) {
      // Sin historia: suponer crucero (d = v·(1/f − 1)).
      dx = tr && Number.isFinite(tr.dx) ? tr.dx : vx * (1 / fDrive - 1);
      dz = tr && Number.isFinite(tr.dz) ? tr.dz : vz * (1 / fDrive - 1);
    }
    const fSub = Math.pow(0.5, h / (brake ? mv.idleFrictionHalfLife : mv.frictionHalfLife));
    // Zona muerta del servidor: solo en inercia, que incluye un empuje que
    // ni a velocidad terminal supera el umbral (BrawlRoom, pushTerminal).
    const coasting = brake || (Math.hypot(dx, dz) / dt) * mv.frictionHalfLife / Math.LN2 < mv.velocityDeadZone;
    const tick = (): void => {
      let wx = vx + dx, wz = vz + dz;
      for (let s = 0; s < n; s++) {
        x += wx * h; z += wz * h;
        wx *= fSub; wz *= fSub;
        const sp = Math.hypot(wx, wz);
        if (coasting && sp < mv.velocityDeadZone) { wx = 0; wz = 0; }
        else if (sp > mv.maxSpeed) { wx *= mv.maxSpeed / sp; wz *= mv.maxSpeed / sp; }
      }
      vx = wx; vz = wz;
    };
    // Tick a medias (y, con age ≤ 0, el frame anterior al estado): la
    // fracción del recorrido de ese tick entero.
    const partial = (frac: number): [number, number] => {
      const x0 = x, z0 = z;
      tick();
      return [x0 + (x - x0) * frac, z0 + (z - z0) * frac];
    };
    if (age <= 0) return partial(age / dt);
    let ticks = age / dt;
    for (; ticks >= 1; ticks -= 1) tick();
    return ticks > 1e-9 ? partial(ticks) : [x, z];
  }

  /** Lo que trae este frame para el bicho y, si es un estado nuevo, su
   *  empuje de input por tick a partir de dos estados separados m ticks:
   *  v_k = v_{k−m}·f^m + d·(f + … + f^m).
   *   · Parado (|v| < zona muerta) → sin empuje: si no, frenar hasta 0 se
   *     leía como un empuje hacia atrás y el bicho reculaba un parche.
   *   · Empuje CONTRA la marcha → frenada (o cambio de sentido): se predice
   *     sin empuje y con fricción de parada. Se mira antes que el tamaño,
   *     porque frenar desde crucero da un "empuje" mayor que el máximo.
   *   · Empuje imposible a favor de la marcha o de lado → golpe (choque,
   *     cabezazo, knockback): no es mando, se sigue con el de antes.
   *   · Lejos de donde el paso de integración lo tenía que llevar y casi
   *     parado → teleport (blink, decoy y Grip ponen v = 0). */
  private estimateDrive(tr: Track, sx: number, sz: number, vx: number, vz: number, brake: boolean, mv: NetMovement): StateNews {
    const hz = this.config.serverTickHz;
    const n = Math.round((this.stateMs / 1000) * hz);
    if (n === tr.n) return 'none';
    const m = n - tr.n;
    let news: StateNews = 'new';
    if (m >= 1 && m <= 4) {
      const [ex, ez] = this.predict(tr, brake, tr.sx, tr.sz, tr.vx, tr.vz, m / hz, mv);
      if (Math.hypot(sx - ex, sz - ez) > this.config.teleportDistance && Math.hypot(vx, vz) < this.config.teleportMaxSpeed) {
        news = 'teleport';
      }
      const f = Math.pow(0.5, 1 / hz / mv.frictionHalfLife);
      const fm = Math.pow(f, m);
      const S = (f * (1 - fm)) / (1 - f);
      const dx = (vx - tr.vx * fm) / S, dz = (vz - tr.vz * fm) / S;
      const plausible = Math.hypot(dx, dz) <= mv.maxSpeed * (1 - f);
      if (Math.hypot(vx, vz) < mv.velocityDeadZone) {
        tr.braking = true; tr.dx = 0; tr.dz = 0;
      } else if (dx * vx + dz * vz < 0) {
        tr.braking = true;
        if (plausible) { tr.dx = dx; tr.dz = dz; }
      } else if (plausible) {
        tr.braking = false; tr.dx = dx; tr.dz = dz;
      }
    } else {
      tr.dx = NaN; tr.dz = NaN; tr.braking = false;
    }
    tr.n = n; tr.sx = sx; tr.sz = sz; tr.vx = vx; tr.vz = vz;
    return news;
  }
}
