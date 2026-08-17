// ---------------------------------------------------------------------------
// Sentry init — isolated module so tree-shaking actually works
// ---------------------------------------------------------------------------
//
// observability.ts loads THIS module dynamically (async chunk off the
// critical path). The @sentry/browser imports here are STATIC named
// imports — that's what lets Rollup tree-shake the SDK down to the
// pieces we use. Importing '@sentry/browser' directly via `await
// import()` would pull the entire namespace (~450 kB raw, measured)
// because dynamic namespace objects can't be shaken.
//
// Deliberately minimal client: fetch transport + stack parser + global
// error/rejection handlers + dedupe. No tracing, no replay, no
// breadcrumbs machinery.
// ---------------------------------------------------------------------------

import {
  BrowserClient,
  getCurrentScope,
  defaultStackParser,
  makeFetchTransport,
  globalHandlersIntegration,
  dedupeIntegration,
  captureException,
} from '@sentry/browser';

export interface PreInitEvent {
  kind: 'error' | 'rejection';
  payload: unknown;
}

/**
 * Create + install the minimal Sentry client and flush any errors the
 * pre-init buffer caught while the chunk was loading.
 */
export function initSentry(dsn: string, buffered: PreInitEvent[]): void {
  const client = new BrowserClient({
    dsn,
    release: __BUILD_COMMIT__,
    environment: import.meta.env.MODE,
    sampleRate: 1.0,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [globalHandlersIntegration(), dedupeIntegration()],
  });
  getCurrentScope().setClient(client);
  client.init();

  for (const ev of buffered) {
    const value = ev.payload instanceof Error
      ? ev.payload
      : new Error(String(ev.payload ?? `unknown ${ev.kind}`));
    captureException(value, { tags: { preInitBuffer: 'true' } });
  }
}
