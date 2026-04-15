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
  type: 'charge_rush' | 'ground_pound' | 'frenzy';
  x: number;
  z: number;
  rotationY: number;
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
