// ---------------------------------------------------------------------------
// Client error observability — Sentry, lazy-loaded and env-driven
// ---------------------------------------------------------------------------
//
// H0 (2026-08-17). Until now production was blind: terser strips
// console.log/debug and there was no error reporter, so a crash on a
// player's device was invisible. This wires Sentry with two constraints
// from the ROADMAP:
//
//   1. Zero cost to time-to-interactive. The SDK (~25 kB gz) is a
//      SEPARATE async chunk, dynamically imported on the first idle
//      moment after boot — never on the critical path. Errors thrown
//      before the SDK lands are caught by two tiny pre-init listeners,
//      buffered, and flushed to Sentry once it initialises.
//
//   2. Completely inert without configuration. Activation is driven by
//      the VITE_SENTRY_DSN env var (set in Vercel → Environment
//      Variables; it is baked into the bundle at build time and is NOT
//      a secret — DSNs are public by design). No DSN → initObservability
//      returns immediately, the Sentry chunk is never fetched, zero
//      listeners registered.
//
// Tracing/replay are deliberately OFF (tracesSampleRate 0 — we want
// crash reports, not performance telemetry). Error sampleRate is 1.0:
// current traffic is tiny, every report matters. Revisit both when the
// user-acquisition hitos (H2+) raise volume.
// ---------------------------------------------------------------------------

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

interface BufferedEvent {
  kind: 'error' | 'rejection';
  payload: unknown;
}

const preInitBuffer: BufferedEvent[] = [];
const BUFFER_CAP = 20; // a crash loop before init shouldn't grow unbounded

function onEarlyError(ev: ErrorEvent): void {
  if (preInitBuffer.length < BUFFER_CAP) {
    preInitBuffer.push({ kind: 'error', payload: ev.error ?? ev.message });
  }
}

function onEarlyRejection(ev: PromiseRejectionEvent): void {
  if (preInitBuffer.length < BUFFER_CAP) {
    preInitBuffer.push({ kind: 'rejection', payload: ev.reason });
  }
}

/**
 * Call once at boot (main.ts). Registers the pre-init buffer listeners
 * and schedules the real SDK load for the first idle slot. No-op when
 * VITE_SENTRY_DSN is absent (local dev, forks, CI).
 */
export function initObservability(): void {
  if (!DSN) return;

  window.addEventListener('error', onEarlyError);
  window.addEventListener('unhandledrejection', onEarlyRejection);

  const start = () => { void loadAndInitSentry(); };
  if ('requestIdleCallback' in window) {
    // timeout guarantees init even if the main thread never goes idle
    // (e.g. the player jumps straight into a match).
    requestIdleCallback(start, { timeout: 5000 });
  } else {
    setTimeout(start, 3000);
  }
}

async function loadAndInitSentry(): Promise<void> {
  try {
    // The Sentry code lives in observability-sentry.ts with STATIC
    // named imports — that module is what we load dynamically, so the
    // async chunk is tree-shaken to just the pieces we use. Importing
    // '@sentry/browser' directly here would defeat tree-shaking (a
    // dynamic namespace import carries the whole SDK).
    const { initSentry } = await import('./observability-sentry');

    initSentry(DSN!, preInitBuffer);

    // Sentry's global handlers are live from here — retire the
    // pre-init listeners.
    window.removeEventListener('error', onEarlyError);
    window.removeEventListener('unhandledrejection', onEarlyRejection);
    preInitBuffer.length = 0;
  } catch (e) {
    // Loading the SDK failed (offline, blocked, CDN-less build issue).
    // Not worth surfacing to the player; keep the console breadcrumb.
    console.warn('[observability] Sentry init failed:', e);
  }
}
