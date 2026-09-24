// ---------------------------------------------------------------------------
// precise-timers.mjs — el servidor LOCAL en Windows, a la velocidad real
// ---------------------------------------------------------------------------
//
// Lo carga `npm run dev` (tsx watch --import ./scripts/precise-timers.mjs).
// Producción NO: Railway arranca con `node dist/index.js` (Dockerfile) y en
// Linux los intervalos ya son exactos.
//
// Por qué (medido el 2026-09-24, ONLINE.md → "Suavizado online"): en Windows
// el setInterval de Node va a la granularidad del reloj del sistema
// (15,6 ms). setInterval(50) sale a ~62 ms y setInterval(33,3) a ~46 ms, así
// que el servidor local manda parches a ~16 Hz (no 20) y simula a ~21 Hz con
// dt fijo de 1/30: el juego online en local corre a ~0,72× y engaña al
// juzgar el movimiento o el suavizado.
//
// Qué hace: sustituye los setInterval cortos (10-99 ms) por un periódico con
// deriva corregida (setTimeout grueso + giro final con setImmediate). El
// giro cuesta CPU (hasta ~17 ms por intervalo; medido ~44 % de un núcleo por
// sala): por eso solo en Windows y solo en dev. PRECISE_TIMERS=off lo apaga.
// ---------------------------------------------------------------------------

const enabled = process.platform === 'win32' && process.env.PRECISE_TIMERS !== 'off';

if (enabled) {
  const nativeSetInterval = globalThis.setInterval;
  const nativeClearInterval = globalThis.clearInterval;
  const LEAD_MS = 17; // > granularidad del reloj de Windows

  let nextId = 1;
  class PreciseInterval {
    constructor(fn, ms, args) {
      this.fn = fn; this.ms = ms; this.args = args; this.id = nextId++;
      this.active = true; this.t = null; this.imm = null;
      this.next = performance.now() + ms;
      this.schedule();
    }
    schedule() {
      if (!this.active) return;
      const wait = this.next - performance.now();
      if (wait > LEAD_MS) this.t = setTimeout(() => this.schedule(), wait - LEAD_MS);
      else if (wait > 0) this.imm = setImmediate(() => this.schedule());
      else this.fire();
    }
    fire() {
      this.next += this.ms;
      const now = performance.now();
      if (now - this.next > this.ms) this.next = now + this.ms; // muy atrasado → resincronizar
      try { this.fn(...this.args); } finally { this.schedule(); }
    }
    cancel() {
      this.active = false;
      if (this.t) clearTimeout(this.t);
      if (this.imm) clearImmediate(this.imm);
    }
    unref() { return this; }
    ref() { return this; }
    hasRef() { return true; }
    refresh() { return this; }
    [Symbol.toPrimitive]() { return this.id; }
  }

  globalThis.setInterval = function (fn, ms, ...args) {
    if (typeof fn === 'function' && ms >= 10 && ms < 100) return new PreciseInterval(fn, ms, args);
    return nativeSetInterval(fn, ms, ...args);
  };
  globalThis.clearInterval = function (h) {
    if (h instanceof PreciseInterval) return h.cancel();
    return nativeClearInterval(h);
  };
  console.log('[precise-timers] Windows: setInterval de 10-99 ms con deriva corregida (solo dev; PRECISE_TIMERS=off lo apaga)');
}
