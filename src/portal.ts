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

const EXIT_POS = new THREE.Vector3(0, 0, -9);
const START_POS = new THREE.Vector3(0, 0, -4);
const PORTAL_RADIUS = 1.2;
const TRIGGER_DIST = 1.5;
const GRACE_PERIOD = 5.0; // seconds before start portal activates

const EXIT_COLOR = 0x44ff88;
const START_COLOR = 0xff8844;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let exitPortal: THREE.Group | null = null;
let startPortal: THREE.Group | null = null;
let graceTimer = GRACE_PERIOD;
let redirected = false;

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

  // Exit portal — always present
  exitPortal = createPortalMesh(EXIT_COLOR);
  exitPortal.position.copy(EXIT_POS);
  scene.add(exitPortal);
  console.debug('[Portal] exit portal created at', EXIT_POS.x, EXIT_POS.z);

  // Start portal — only if in portal mode with a ref URL
  if (portalActive && refUrl) {
    startPortal = createPortalMesh(START_COLOR);
    startPortal.position.copy(START_POS);
    scene.add(startPortal);
    console.debug('[Portal] start portal created at', START_POS.x, START_POS.z);
  }
}

/**
 * Animate portals and check player collision. Call every frame during 'playing'.
 * Returns 'exit' | 'start' if a redirect was triggered, null otherwise.
 */
export function updatePortals(playerX: number, playerZ: number, dt: number): 'exit' | 'start' | null {
  if (redirected) return null;

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
    if (Math.sqrt(dx * dx + dz * dz) < TRIGGER_DIST) {
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
    if (Math.sqrt(dx * dx + dz * dz) < TRIGGER_DIST) {
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

function createPortalMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  // Outer ring — torus standing upright
  const torusGeo = new THREE.TorusGeometry(PORTAL_RADIUS, 0.12, 12, 32);
  const torusMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.9,
  });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  torus.rotation.x = Math.PI / 2; // stand upright
  torus.position.y = PORTAL_RADIUS + 0.15;
  group.add(torus);

  // Inner disc — semitransparent fill
  const discGeo = new THREE.CircleGeometry(PORTAL_RADIUS * 0.85, 24);
  const discMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = Math.PI / 2;
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

  return group;
}

function animatePortal(portal: THREE.Group, _dt: number): void {
  const t = Date.now() * 0.001;

  // Slow Y rotation on the whole group
  portal.children[0].rotation.z = t * 0.5;

  // Pulse emissive on the torus
  const torus = portal.children[0] as THREE.Mesh;
  const mat = torus.material as THREE.MeshStandardMaterial;
  mat.emissiveIntensity = 0.5 + Math.sin(t * 2) * 0.3;

  // Pulse disc opacity
  const disc = portal.children[1] as THREE.Mesh;
  const discMat = disc.material as THREE.MeshStandardMaterial;
  discMat.opacity = 0.2 + Math.sin(t * 3) * 0.1;
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
