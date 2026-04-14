// ---------------------------------------------------------------------------
// Vibe Jam 2026 Portal — exit portal + conditional start portal
// ---------------------------------------------------------------------------
//
// Exit portal: always present in match. Walk into it → redirect to
//   https://vibej.am/portal/2026 with player params.
//
// Start portal: only if URL has ?portal=true AND ?ref=. Lets the player
//   return to the game they came from. 5-second grace period after spawn.
//
// This module is self-contained: no imports from gameplay code (Critter,
// Game, etc.). Receives coordinates via function params.
//
// Debug traces: prefixed with [Portal] for easy filtering.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { getDisplayRoster, type RosterEntry } from './roster';
import { CRITTER_PRESETS } from './critter';

// ---------------------------------------------------------------------------
// URL params (read once at module load)
// ---------------------------------------------------------------------------

const params = new URLSearchParams(window.location.search);
let portalActive = params.get('portal') === 'true';
let refUrl = params.get('ref') || null;
const incomingUsername = params.get('username') || null;

// ---------------------------------------------------------------------------
// Portal config
// ---------------------------------------------------------------------------

// Positions: back corners of the arena — visible from the isometric camera
// but out of the main central combat lane. Arena radius 12, main combat
// happens within ±5 of center.
const EXIT_POS = new THREE.Vector3(6, 0, -6);
const START_POS = new THREE.Vector3(-6, 0, -6);
const PORTAL_RADIUS = 1.2;
const TRIGGER_DIST_MIN = 0.8;   // hitbox when minimized (tight, avoids combat accidents)
const TRIGGER_DIST_MAX = 1.5;   // hitbox when expanded (generous, easy to hit)
const GRACE_PERIOD = 5.0;       // seconds before start portal activates

const EXIT_COLOR = 0x44ff88;
const START_COLOR = 0xff8844;

// Expansion state: smoothed 0..1 value for scale/opacity/emissive lerp.
// Portals start minimized (discreet). Toggled by P key or mobile button.
const EXPAND_LERP_SPEED = 8;    // higher = snappier transition

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let exitPortal: THREE.Group | null = null;
let startPortal: THREE.Group | null = null;
let graceTimer = GRACE_PERIOD;
let redirected = false;
let expanded = false;       // target state
let expansionT = 0;         // smoothed 0..1, driven each frame

// Player info for redirect params (set by game.ts before first update)
let playerName = 'Unknown';
let playerColor = 'ffffff';
let playerSpeed = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Whether the game is currently in portal mode. */
export function isFromPortal(): boolean {
  return portalActive;
}

/**
 * Clear portal context: the game reverts to normal mode.
 * Called when the player explicitly returns to title (T key).
 * Also strips portal params from the URL bar via replaceState
 * so a page refresh doesn't re-enter portal mode.
 */
export function clearPortalContext(): void {
  if (!portalActive) return;
  portalActive = false;
  refUrl = null;

  // Clean URL bar without reload
  const url = new URL(window.location.href);
  url.searchParams.delete('portal');
  url.searchParams.delete('ref');
  url.searchParams.delete('username');
  url.searchParams.delete('color');
  url.searchParams.delete('speed');
  history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  console.debug('[Portal] context cleared, URL cleaned');
}

/**
 * Resolve which character to use when entering via portal.
 * Returns the index into displayRoster for game.ts to use as selectedIdx.
 *
 * Logic:
 *   1. If ?username= matches a playable character name → use it
 *   2. Otherwise → random playable character
 *   3. Fallback → first entry in displayRoster (should never happen)
 */
export function resolvePortalCharacter(): number {
  const display = getDisplayRoster();
  const playableIndices: number[] = [];

  for (let i = 0; i < display.length; i++) {
    if (display[i].status === 'playable') {
      playableIndices.push(i);
    }
  }

  // Try matching incoming username to a playable character
  if (incomingUsername) {
    const lower = incomingUsername.toLowerCase();
    const match = playableIndices.find(i =>
      display[i].displayName.toLowerCase() === lower,
    );
    if (match !== undefined) {
      console.debug('[Portal] matched incoming username to', display[match].displayName);
      return match;
    }
  }

  // Random playable
  if (playableIndices.length > 0) {
    const idx = playableIndices[Math.floor(Math.random() * playableIndices.length)];
    console.debug('[Portal] random playable:', display[idx].displayName);
    return idx;
  }

  // Absolute fallback (should never happen — there's always at least Sergei)
  console.warn('[Portal] no playable characters found, falling back to index 0');
  return 0;
}

/** Toggle portals between minimized (discreet) and expanded (full brightness). */
export function togglePortalExpanded(): void {
  expanded = !expanded;
  console.debug('[Portal] expanded =', expanded);
}

/** Current expansion target (not the smoothed value). */
export function isPortalExpanded(): boolean {
  return expanded;
}

/** Whether a start portal exists in this match (for HUD legend). */
export function hasStartPortal(): boolean {
  return portalActive && refUrl !== null;
}

/** Set player info used in redirect query params. Call before first update. */
export function setPortalPlayerInfo(name: string, colorHex: number, speed: number): void {
  playerName = name;
  playerColor = colorHex.toString(16).padStart(6, '0');
  playerSpeed = Math.round(speed);
}

/** Create portal meshes and add them to the scene. */
export function initPortals(scene: THREE.Scene): void {
  disposePortals();
  redirected = false;
  graceTimer = GRACE_PERIOD;
  expanded = false;
  expansionT = 0;

  // Exit portal — always present
  exitPortal = createPortalMesh(EXIT_COLOR, 'NEXT GAME');
  exitPortal.position.copy(EXIT_POS);
  scene.add(exitPortal);
  console.debug('[Portal] exit portal created at', EXIT_POS.x, EXIT_POS.z);

  // Start portal — only if in portal mode with a ref URL
  if (portalActive && refUrl) {
    startPortal = createPortalMesh(START_COLOR, 'GO BACK');
    startPortal.position.copy(START_POS);
    scene.add(startPortal);
    console.debug('[Portal] start portal created at', START_POS.x, START_POS.z);
  }

  // Apply initial minimized visual state immediately, so countdown and the
  // first frame of 'playing' both render the portal at 0.5× scale / low glow
  // instead of a visible pop from 1.0× to 0.5× when the match starts.
  if (exitPortal) animatePortal(exitPortal, 0);
  if (startPortal) animatePortal(startPortal, 0);
}

/**
 * Animate portals and check player collision. Call every frame during 'playing'.
 * Returns 'exit' | 'start' if a redirect was triggered, null otherwise.
 *
 * IMPORTANT: this function must ONLY be called with the local player's
 * coordinates. Bots must never trigger a portal redirect. The portal meshes
 * have no physics hitbox — bots pass through them visually but do not
 * interact with collision or redirect logic.
 */
export function updatePortals(playerX: number, playerZ: number, dt: number): 'exit' | 'start' | null {
  if (redirected) return null;

  // Smooth expansion toward target (0 or 1)
  const target = expanded ? 1 : 0;
  const k = Math.min(1, dt * EXPAND_LERP_SPEED);
  expansionT += (target - expansionT) * k;

  // Dynamic hitbox: tight when minimized, generous when expanded
  const triggerDist = TRIGGER_DIST_MIN + (TRIGGER_DIST_MAX - TRIGGER_DIST_MIN) * expansionT;

  // Animate
  if (exitPortal) animatePortal(exitPortal, dt);
  if (startPortal) animatePortal(startPortal, dt);

  // Grace timer for start portal
  if (graceTimer > 0) {
    graceTimer -= dt;
  }

  // Check exit portal collision
  if (exitPortal) {
    const dx = playerX - EXIT_POS.x;
    const dz = playerZ - EXIT_POS.z;
    if (Math.sqrt(dx * dx + dz * dz) < triggerDist) {
      redirected = true;
      console.debug('[Portal] exit portal triggered');
      redirectToPortalHub();
      return 'exit';
    }
  }

  // Check start portal collision (with grace period)
  if (startPortal && graceTimer <= 0 && refUrl) {
    const dx = playerX - START_POS.x;
    const dz = playerZ - START_POS.z;
    if (Math.sqrt(dx * dx + dz * dz) < triggerDist) {
      redirected = true;
      console.debug('[Portal] start portal triggered → returning to', refUrl);
      redirectToRef();
      return 'start';
    }
  }

  return null;
}

/** Remove portal meshes from scene and release GPU resources. */
export function disposePortals(): void {
  if (exitPortal) {
    exitPortal.parent?.remove(exitPortal);
    disposeMesh(exitPortal);
    exitPortal = null;
  }
  if (startPortal) {
    startPortal.parent?.remove(startPortal);
    disposeMesh(startPortal);
    startPortal = null;
  }
}

// ---------------------------------------------------------------------------
// Visual construction
// ---------------------------------------------------------------------------

function createPortalMesh(color: number, label: string): THREE.Group {
  const group = new THREE.Group();

  // Outer ring — torus tilted slightly toward the camera (75°)
  // so the "hole" of the portal reads clearly from the isometric view.
  const TILT = Math.PI / 2; // perpendicular to ground (standing like a door)
  const torusGeo = new THREE.TorusGeometry(PORTAL_RADIUS, 0.12, 12, 32);
  const torusMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.9,
  });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  torus.rotation.x = TILT;
  torus.position.y = PORTAL_RADIUS + 0.15;
  group.add(torus);

  // Inner disc — semitransparent fill
  const discGeo = new THREE.CircleGeometry(PORTAL_RADIUS * 0.85, 24);
  const discMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = TILT;
  disc.position.y = PORTAL_RADIUS + 0.15;
  group.add(disc);

  // Ground glow ring
  const glowGeo = new THREE.RingGeometry(PORTAL_RADIUS * 0.6, PORTAL_RADIUS * 1.1, 32);
  const glowMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2; // flat on ground
  glow.position.y = 0.02;
  group.add(glow);

  // Label sprite floating above the portal
  const labelSprite = createLabelSprite(label, color);
  labelSprite.position.y = PORTAL_RADIUS * 2 + 0.6;
  group.add(labelSprite);

  // Lightweight particles orbiting the torus
  const particles = createPortalParticles(color);
  group.add(particles);

  return group;
}

/** Canvas-texture sprite with the portal label, colored to match. */
function createLabelSprite(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const hex = '#' + color.toString(16).padStart(6, '0');

  ctx.font = 'bold 36px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Black stroke for contrast + colored fill
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 6;
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = hex;
  ctx.fillText(text, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.8, 0.45, 1);
  return sprite;
}

/** Small particle ring around the portal — ~12 points, very light. */
function createPortalParticles(color: number): THREE.Points {
  const COUNT = 12;
  const positions = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * PORTAL_RADIUS;
    positions[i * 3 + 1] = PORTAL_RADIUS + 0.15 + Math.sin(a) * PORTAL_RADIUS * 0.3;
    positions[i * 3 + 2] = Math.sin(a) * PORTAL_RADIUS * 0.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: 0.1,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

function animatePortal(portal: THREE.Group, _dt: number): void {
  const t = Date.now() * 0.001;
  const T = expansionT; // 0..1 smoothed

  // Uniform scale on the whole group: 0.5× minimized → 1.0× expanded
  const s = 0.5 + T * 0.5;
  portal.scale.setScalar(s);

  // (children: [torus, disc, glow, label, particles])
  const torus = portal.children[0] as THREE.Mesh;
  const disc = portal.children[1] as THREE.Mesh;
  const glow = portal.children[2] as THREE.Mesh;
  const label = portal.children[3] as THREE.Sprite;
  const particles = portal.children[4] as THREE.Points;

  // Slow rotation on the torus
  torus.rotation.z = t * 0.4;

  // Torus emissive: dim (0.15) when minimized, bright with pulse (0.3-0.5) when expanded
  const torusMat = torus.material as THREE.MeshStandardMaterial;
  const baseGlow = 0.15 + T * 0.25;
  const pulseAmt = T * 0.15;
  torusMat.emissiveIntensity = baseGlow + Math.sin(t * 1.8) * pulseAmt;
  torusMat.opacity = 0.5 + T * 0.4;

  // Disc: subtle when minimized, visible with pulse when expanded
  const discMat = disc.material as THREE.MeshStandardMaterial;
  discMat.opacity = 0.05 + T * 0.15 + Math.sin(t * 2) * T * 0.05;

  // Ground glow: very subtle when minimized
  const glowMat = glow.material as THREE.MeshStandardMaterial;
  glowMat.opacity = 0.05 + T * 0.15;

  // Label: fade in with expansion
  const labelMat = label.material as THREE.SpriteMaterial;
  labelMat.opacity = 0.35 + T * 0.65;

  // Particles: fade + bob
  const pointsMat = particles.material as THREE.PointsMaterial;
  pointsMat.opacity = 0.25 + T * 0.65;
  if (particles.isPoints) {
    const posAttr = particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const COUNT = arr.length / 3;
    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2 + t * 0.5;
      arr[i * 3] = Math.cos(angle) * PORTAL_RADIUS;
      arr[i * 3 + 1] = PORTAL_RADIUS + 0.15 + Math.sin(angle) * PORTAL_RADIUS * 0.3
        + Math.sin(t * 2 + i) * 0.08;
      arr[i * 3 + 2] = Math.sin(angle) * PORTAL_RADIUS * 0.2;
    }
    posAttr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Redirect URLs (used by game.ts end screen)
// ---------------------------------------------------------------------------

/** Full URL for "next game" in the webring. Always available. */
export function getPortalExitUrl(): string {
  return `https://vibej.am/portal/2026?${buildParams()}`;
}

/** Full URL to return to the game that sent the player, or null. */
export function getPortalReturnUrl(): string | null {
  if (!refUrl) return null;
  const separator = refUrl.includes('?') ? '&' : '?';
  return `${refUrl}${separator}${buildParams()}&portal=true`;
}

// ---------------------------------------------------------------------------
// Redirect logic
// ---------------------------------------------------------------------------

function buildParams(): string {
  const p = new URLSearchParams();
  p.set('username', playerName);
  p.set('color', playerColor);
  p.set('speed', String(playerSpeed));
  p.set('ref', window.location.origin);
  return p.toString();
}

function redirectToPortalHub(): void {
  const url = `https://vibej.am/portal/2026?${buildParams()}`;
  console.debug('[Portal] redirecting to:', url);
  window.location.href = url;
}

function redirectToRef(): void {
  if (!refUrl) return;
  // Append portal params to the ref URL so the receiving game gets context
  const separator = refUrl.includes('?') ? '&' : '?';
  const url = `${refUrl}${separator}${buildParams()}&portal=true`;
  console.debug('[Portal] redirecting to ref:', url);
  window.location.href = url;
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

function disposeMesh(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const m = child as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) {
      for (const mm of mat) mm.dispose();
    } else if (mat) {
      mat.dispose();
    }
  });
}
