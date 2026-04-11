// ---------------------------------------------------------------------------
// Audio — synthesized SFX via Web Audio API
// ---------------------------------------------------------------------------
//
// No external asset files, no Howler dependency. All sounds are generated
// on the fly with oscillators + noise buffers. Ships with the bundle, works
// offline, zero latency.
//
// Browser policy: AudioContext must be created or resumed after a user
// interaction. We lazily initialize on the first play() call (which is
// always triggered by a keypress or click since all gameplay events come
// from user input chains).
// ---------------------------------------------------------------------------

export type SoundName =
  | 'headbuttHit'
  | 'groundPound'
  | 'abilityFire'
  | 'fall'
  | 'respawn'
  | 'victory';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
// SFX channel (all current sounds go here)
let sfxMuted = false;
// Music channel (no music yet — flag reserved for future)
let musicMuted = false;

const MASTER_VOLUME = 0.35;

// Shared noise buffer (generated once, reused by every noise-based sound)
let noiseBuffer: AudioBuffer | null = null;

function ensureContext(): boolean {
  if (ctx) {
    // Some browsers suspend the context if not used — try to resume
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* ignore */ });
    }
    return true;
  }
  try {
    // Browsers may not have AudioContext on very old devices
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return false;
    ctx = new AC();
    masterGain = ctx.createGain();
    // Respect the current sfx mute state at context creation time. Without
    // this, a user who muted before any sound played would have masterGain
    // start at full volume when the context was lazily created.
    masterGain.gain.value = sfxMuted ? 0 : MASTER_VOLUME;
    masterGain.connect(ctx.destination);
    return true;
  } catch {
    return false;
  }
}

function getNoiseBuffer(): AudioBuffer | null {
  if (!ctx) return null;
  if (noiseBuffer) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 1.0); // 1 second of noise is plenty
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buf;
  return buf;
}

// ---------------------------------------------------------------------------
// Public API — two independent channels: SFX and Music
// ---------------------------------------------------------------------------
//
// SFX = all gameplay sounds (headbutt, ground pound, ability fire, fall,
//       respawn, victory). Currently the only populated channel.
// Music = background music. No sources yet — the toggle exists so the UI
//         is ready for when we add it.
// ---------------------------------------------------------------------------

const STORAGE_KEY_SFX = 'bichitos.sfxMuted';
const STORAGE_KEY_MUSIC = 'bichitos.musicMuted';

/** Load both mute states from localStorage. Called once at init. */
export function loadMutedState(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY_SFX) === '1') sfxMuted = true;
    if (localStorage.getItem(STORAGE_KEY_MUSIC) === '1') musicMuted = true;
  } catch { /* ignore private-mode errors */ }
}

/**
 * Mute/unmute the SFX channel. Applies INSTANTLY via setValueAtTime
 * (not setTargetAtTime) so there's no audible tail when muting mid-combat.
 * Any in-flight oscillators stop being audible immediately because their
 * output flows through the masterGain node which is now at 0.
 */
export function setSfxMuted(value: boolean): void {
  sfxMuted = value;
  try {
    localStorage.setItem(STORAGE_KEY_SFX, value ? '1' : '0');
  } catch { /* ignore */ }
  if (masterGain && ctx) {
    // Clear any pending scheduled values and jump the gain instantly.
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setValueAtTime(value ? 0 : MASTER_VOLUME, ctx.currentTime);
  }
}

export function toggleSfxMuted(): boolean {
  setSfxMuted(!sfxMuted);
  return sfxMuted;
}

export function isSfxMuted(): boolean {
  return sfxMuted;
}

/**
 * Mute/unmute the Music channel. Placeholder for when we add background
 * music — currently does nothing audible, but the state is persisted and
 * the HUD button respects it.
 */
export function setMusicMuted(value: boolean): void {
  musicMuted = value;
  try {
    localStorage.setItem(STORAGE_KEY_MUSIC, value ? '1' : '0');
  } catch { /* ignore */ }
  // TODO: connect to musicGain when music is added
}

export function toggleMusicMuted(): boolean {
  setMusicMuted(!musicMuted);
  return musicMuted;
}

export function isMusicMuted(): boolean {
  return musicMuted;
}

export function play(sound: SoundName): void {
  if (sfxMuted) return;
  if (!ensureContext() || !ctx || !masterGain) return;

  switch (sound) {
    case 'headbuttHit':  playHeadbuttHit();  break;
    case 'groundPound':  playGroundPound();  break;
    case 'abilityFire':  playAbilityFire();  break;
    case 'fall':         playFall();         break;
    case 'respawn':      playRespawn();      break;
    case 'victory':      playVictory();      break;
  }
}

// ---------------------------------------------------------------------------
// Individual sound functions
// ---------------------------------------------------------------------------

/** Sharp thump + quick noise burst. ~120ms. */
function playHeadbuttHit(): void {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const duration = 0.14;

  // Low-pitched body thump
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(170, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + duration);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.8, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(oscGain).connect(masterGain);
  osc.start(now);
  osc.stop(now + duration);

  // Short noise burst for the "crack"
  const nb = getNoiseBuffer();
  if (nb) {
    const src = ctx.createBufferSource();
    src.buffer = nb;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    src.connect(hp).connect(noiseGain).connect(masterGain);
    src.start(now);
    src.stop(now + 0.06);
  }
}

/** Deep rumble + slam. ~400ms. */
function playGroundPound(): void {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const duration = 0.45;

  // Very low sub-bass sweep
  const sub = ctx.createOscillator();
  sub.type = 'sawtooth';
  sub.frequency.setValueAtTime(80, now);
  sub.frequency.exponentialRampToValueAtTime(35, now + duration);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.9, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  sub.connect(subGain).connect(masterGain);
  sub.start(now);
  sub.stop(now + duration);

  // Noise rumble (low-passed for "earth")
  const nb = getNoiseBuffer();
  if (nb) {
    const src = ctx.createBufferSource();
    src.buffer = nb;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, now);
    lp.frequency.exponentialRampToValueAtTime(100, now + duration);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(lp).connect(noiseGain).connect(masterGain);
    src.start(now);
    src.stop(now + duration);
  }
}

/** Rising whoosh. ~200ms. */
function playAbilityFire(): void {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const duration = 0.18;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + duration);

  // Subtle noise layer for texture
  const nb = getNoiseBuffer();
  if (nb) {
    const src = ctx.createBufferSource();
    src.buffer = nb;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, now);
    bp.frequency.exponentialRampToValueAtTime(2000, now + duration);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(bp).connect(noiseGain).connect(masterGain);
    src.start(now);
    src.stop(now + duration);
  }
}

/** Descending sad trombone-ish whoop. ~500ms. */
function playFall(): void {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const duration = 0.55;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.55, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + duration);
}

/** Sparkly ascending arpeggio (C→E→G). ~300ms total. */
function playRespawn(): void {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
  const step = 0.09;
  const each = 0.14;

  for (let i = 0; i < notes.length; i++) {
    const start = now + i * step;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(notes[i], start);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, start);
    gain.gain.linearRampToValueAtTime(0.4, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + each);
    osc.connect(gain).connect(masterGain);
    osc.start(start);
    osc.stop(start + each);
  }
}

/** Major chord held ~900ms. C5 E5 G5 C6. */
function playVictory(): void {
  if (!ctx || !masterGain) return;
  const now = ctx.currentTime;
  const chord = [523.25, 659.25, 783.99, 1046.5];
  const duration = 0.9;

  for (const freq of chord) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(masterGain);
    osc.start(now);
    osc.stop(now + duration);
  }
}
