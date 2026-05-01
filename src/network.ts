// ---------------------------------------------------------------------------
// Network client — Colyseus wrapper for online multiplayer mode
// ---------------------------------------------------------------------------
//
// Thin abstraction over colyseus.js. Exposes:
//   - connectToBrawl(serverUrl): join or create a 'brawl' room
//   - sendInput(room, payload): send current input to the server each frame
//   - The raw Room is returned for state access; game.ts reads state directly
//     via room.state.players (MapSchema) and listens to ability events.
// ---------------------------------------------------------------------------

import { Client, Room } from 'colyseus.js';

export interface NetworkInput {
  moveX: number;
  moveZ: number;
  headbutt: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
}

export interface AbilityFiredEvent {
  sessionId: string;
  type: 'charge_rush' | 'ground_pound' | 'frenzy' | 'blink';
  x: number;
  z: number;
  rotationY: number;
}

/**
 * One-shot broadcast from the server when a slow zone (Kermit Poison
 * Cloud / Kowalski Arctic Burst) lands. The server is authoritative
 * for the slow effect itself; this event only carries enough info for
 * clients to render the matching visible disc + ring with the same
 * lifetime so everyone sees the hazard. Caster identity is included
 * for any future "you're standing in your own zone" UI hint.
 */
export interface ZoneSpawnedEvent {
  x: number;
  z: number;
  radius: number;
  duration: number;
  slowMultiplier: number;
  ownerSid: string;
  /** 2026-04-30 — Kowalski Frozen Floor slippery flag. */
  slippery?: boolean;
  /** 2026-04-30 — Sihans Sinkhole flag. */
  sinkhole?: boolean;
}

export function onZoneSpawned(room: Room, cb: (ev: ZoneSpawnedEvent) => void): void {
  room.onMessage('zoneSpawned', cb);
}

/**
 * 2026-04-29 K-session — projectile broadcast events. Server emits
 * one `projectileSpawned` per snowball fired, then exactly one of
 * `projectileHit` (if it found a target) or `projectileExpired`
 * (if the TTL ran out / it left the arena). Clients run the same
 * straight-line motion locally so the visual mesh moves smoothly
 * between state patches; server still owns collision.
 */
export interface ProjectileSpawnedEvent {
  id: number;
  ownerSid: string;
  ownerCritter: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  ttl: number;
  radius: number;
}

export interface ProjectileHitEvent {
  id: number;
  victimSid: string;
  x: number;
  z: number;
}

export interface ProjectileExpiredEvent {
  id: number;
  x: number;
  z: number;
}

export function onProjectileSpawned(room: Room, cb: (ev: ProjectileSpawnedEvent) => void): void {
  room.onMessage('projectileSpawned', cb);
}
export function onProjectileHit(room: Room, cb: (ev: ProjectileHitEvent) => void): void {
  room.onMessage('projectileHit', cb);
}
export function onProjectileExpired(room: Room, cb: (ev: ProjectileExpiredEvent) => void): void {
  room.onMessage('projectileExpired', cb);
}

/**
 * 2026-04-30 final-polish — Sihans Sinkhole real-hole broadcast.
 * Server picks the fragments inside the sinkhole disc, marks them
 * dead in `arenaSim.alive[]`, and emits this event so clients can
 * knock the same indices out of their local Arena (visual fall +
 * `alive[]` mirror so the local prediction also reads "void here").
 */
export interface ArenaFragmentsKilledEvent {
  indices: number[];
}
export function onArenaFragmentsKilled(room: Room, cb: (ev: ArenaFragmentsKilledEvent) => void): void {
  room.onMessage('arenaFragmentsKilled', cb);
}

/**
 * 2026-05-01 final block — Cheeto Cone Pulse per-pulse broadcast.
 * Server emits one event per pulse so clients can spawn the matching
 * wave VFX (arc of dust puffs + accent ring) at the correct radius.
 * Falls back gracefully if the server is on the older protocol — the
 * `count` / `waveCenter` / `waveThickness` fields default to 0 and
 * the offline-style handler picks sensible defaults.
 */
export interface LPulseEvent {
  sessionId: string;
  x: number;
  z: number;
  rotationY: number;
  radius: number;
  angleDeg: number;
  waveCenter?: number;
  waveThickness?: number;
  count?: number;
}
export function onLPulse(room: Room, cb: (ev: LPulseEvent) => void): void {
  room.onMessage('lPulse', cb);
}

/**
 * 2026-05-01 final block — Sebastian All-in charge-start broadcast.
 * Server emits this when a Sebastian player starts holding the L
 * input. Carries the pre-picked dash direction so remote viewers
 * can paint the same trajectory preview the local Sebastian sees.
 */
export interface LChargeStartEvent {
  sessionId: string;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  range: number;
  maxMs: number;
}
export function onLChargeStart(room: Room, cb: (ev: LChargeStartEvent) => void): void {
  room.onMessage('lChargeStart', cb);
}

export interface JoinBrawlOptions {
  critterName?: string;
}

/**
 * Connect to a Colyseus server and join or create a brawl room.
 * Returns the Room instance (state auto-syncs via Colyseus patches).
 * `options.critterName` is forwarded to the server's onJoin; the server
 * validates it against its playable table and falls back if unknown.
 */
export async function connectToBrawl(serverUrl: string, options: JoinBrawlOptions = {}): Promise<Room> {
  console.log('[Network] connecting to', serverUrl, 'with options', options);
  const client = new Client(serverUrl);
  const room = await client.joinOrCreate('brawl', options);
  console.log('[Network] joined room', room.roomId, 'as', room.sessionId);
  return room;
}

/** Send one input frame to the server. Safe to call every client tick. */
export function sendInput(room: Room, input: NetworkInput): void {
  room.send('input', input);
}

/** Register a handler for remote ability fire events (for VFX). */
export function onAbilityFired(room: Room, cb: (ev: AbilityFiredEvent) => void): void {
  room.onMessage('abilityFired', cb);
}

/** Payload broadcast by BrawlRoom when an Online Belt changes hands. */
export interface BeltChangedEvent {
  belt:
    | 'throne-online'
    | 'flash-online'
    | 'ironclad-online'
    | 'slayer-online'
    | 'hot-streak-online';
  nickname: string;
  playerId: string;
  value: number;
}

export function onBeltChanged(room: Room, cb: (ev: BeltChangedEvent) => void): void {
  room.onMessage('beltChanged', cb);
}

/**
 * Resolve the server URL to use.
 *
 * In dev (import.meta.env.DEV): default to localhost:2567 unless VITE_SERVER_URL
 * is set. This lets us test locally without extra config.
 *
 * In prod: requires VITE_SERVER_URL to be set at build time. If missing,
 * throws — we don't want to fail silently with a bad URL.
 */
export function getDefaultServerUrl(): string {
  const fromEnv = (import.meta.env as Record<string, string | undefined>).VITE_SERVER_URL;
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return 'ws://localhost:2567';
  throw new Error('[Network] VITE_SERVER_URL not set in production build');
}
