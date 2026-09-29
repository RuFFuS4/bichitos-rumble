// ---------------------------------------------------------------------------
// Audio — silencio externo (src/audio.ts setExternalMute), H5 CrazyGames
// ---------------------------------------------------------------------------
// El adaptador de plataforma silencia el juego mientras sale un anuncio
// ('ad') y mientras CrazyGames tiene el sonido quitado ('platform'). El
// contrato: gana a los botones del jugador sin tocarlos, cada motivo es
// independiente, y no se guarda nada en `bichitos.sfxMuted` /
// `bichitos.musicMuted` (de esas claves dependen las pruebas mudas). Aquí
// con un AudioContext falso: el entorno de vitest es node, sin navegador.
// ---------------------------------------------------------------------------

import { beforeAll, describe, expect, it } from 'vitest';

class FakeParam {
  value = 1;
  cancelScheduledValues(): void { /* no-op */ }
  setValueAtTime(v: number): void { this.value = v; }
  linearRampToValueAtTime(): void { /* no-op */ }
  exponentialRampToValueAtTime(): void { /* no-op */ }
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  connect<T>(next: T): T { return next; }
  start(): void { /* no-op */ }
  stop(): void { /* no-op */ }
}
const gains: FakeNode[] = [];
let oscillators = 0;
class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  sampleRate = 8000;
  destination = {};
  createGain(): FakeNode { const g = new FakeNode(); gains.push(g); return g; }
  createOscillator(): FakeNode { oscillators++; return new FakeNode(); }
  createBiquadFilter(): FakeNode { return new FakeNode(); }
  createBufferSource(): FakeNode { return new FakeNode(); }
  createBuffer(_ch: number, len: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(len) };
  }
  resume(): Promise<void> { return Promise.resolve(); }
}
const storage = new Map<string, string>();

type AudioModule = typeof import('../../src/audio');
let audio: AudioModule;
// The two buses, in the order ensureContext() creates them.
const sfxBus = (): number => gains[0].gain.value;
const musicBus = (): number => gains[1].gain.value;

beforeAll(async () => {
  Object.assign(globalThis, {
    window: { AudioContext: FakeAudioContext },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
    },
  });
  audio = await import('../../src/audio');
  audio.play('fall'); // first sound creates the context and both buses
});

describe('audio: external mute', () => {
  it('silences both buses and gives them back, saving nothing', () => {
    const sfxOn = sfxBus();
    const musicOn = musicBus();
    expect(sfxOn).toBeGreaterThan(0);
    expect(musicOn).toBeGreaterThan(0);

    audio.setExternalMute('ad', true);
    expect(audio.isExternallyMuted()).toBe(true);
    expect([sfxBus(), musicBus()]).toEqual([0, 0]);

    audio.setExternalMute('ad', false);
    expect(audio.isExternallyMuted()).toBe(false);
    expect([sfxBus(), musicBus()]).toEqual([sfxOn, musicOn]);
    expect(storage.size).toBe(0);
  });

  it('keeps each reason independent', () => {
    audio.setExternalMute('ad', true);
    audio.setExternalMute('platform', true);
    audio.setExternalMute('ad', false);
    expect(audio.isExternallyMuted()).toBe(true);
    expect(sfxBus()).toBe(0);
    audio.setExternalMute('platform', false);
    expect(sfxBus()).toBeGreaterThan(0);
  });

  it('plays no sound while externally muted', () => {
    const before = oscillators;
    audio.setExternalMute('platform', true);
    audio.play('headbuttHit');
    audio.playArenaWarning(2);
    expect(oscillators).toBe(before);
    audio.setExternalMute('platform', false);
    audio.play('headbuttHit');
    expect(oscillators).toBeGreaterThan(before);
  });

  it("leaves the player's own mute underneath, and its keys alone", () => {
    audio.toggleSfxMuted();                        // the player mutes SFX
    expect(storage.get('bichitos.sfxMuted')).toBe('1');
    audio.setExternalMute('ad', true);
    audio.setExternalMute('ad', false);
    expect(audio.isSfxMuted()).toBe(true);        // still their choice
    expect(sfxBus()).toBe(0);
    expect(musicBus()).toBeGreaterThan(0);        // music was never theirs to mute
    expect(storage.get('bichitos.sfxMuted')).toBe('1');
    expect(storage.has('bichitos.musicMuted')).toBe(false);
    audio.toggleSfxMuted();
    expect(sfxBus()).toBeGreaterThan(0);
  });
});
