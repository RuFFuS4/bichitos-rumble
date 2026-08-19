// ---------------------------------------------------------------------------
// Sprite sheet preload — enables `.sprite-hud-*` / `.sprite-ability-*` CSS
// classes only if their backing images actually load. If either sheet 404s
// (asset not shipped yet), the body class never gets added and the emoji
// fallbacks stay visible. See the SPRITE ICON SYSTEMS section of
// src/hud/hud.partial.html (single source injected into index + tools).
//
// Shared by BOTH entries (src/main.ts and src/tools/main.ts) — the lab
// renders the same HUD partial, so it needs the same body-class gating or
// the lives medallions fall back to emoji.
// ---------------------------------------------------------------------------

/** Preload one sprite sheet and add `bodyClass` to <body> iff it loads. */
export function enableSpriteClassOnLoad(src: string, bodyClass: string): void {
  const img = new Image();
  img.onload = () => document.body.classList.add(bodyClass);
  img.onerror = () => {
    // Silent: the body class stays off, emoji fallbacks take over. Log
    // once in debug so we know when polish isn't visible because the
    // image hasn't been committed yet.
    console.debug('[sprites] sheet not available, using emoji fallback:', src);
  };
  img.src = src;
}

/** Kick off the preload of the two canonical sheets. Call once at boot. */
export function preloadSpriteSheets(): void {
  enableSpriteClassOnLoad('./images/hud-icons.webp', 'has-hud-sprites');
  enableSpriteClassOnLoad('./images/ability-icons.webp', 'has-ability-sprites');
}
