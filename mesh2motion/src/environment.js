// ---------------------------------------------------------------------------
// Environment info — Bichitos Rumble adaptation
// ---------------------------------------------------------------------------
//
// Upstream reads a Cloudflare-specific `PROCESS_ENV` define from
// vite.config.js. We don't deploy to Cloudflare, so we drop the define
// and keep the globals set to simple identifiers so any UI that reads
// them (e.g. build-version footer) still finds something.
// ---------------------------------------------------------------------------

window.CLOUDFLARE_COMMIT_SHA = 'bichitos-rumble';
window.CLOUDFLARE_BRANCH = 'integrated';
