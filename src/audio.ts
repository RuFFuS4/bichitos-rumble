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

/**
 * Background music tracks. Each maps to a file in `public/audio/`. The
 * track names are stable identifiers — the caller asks for `'intro'` or
 * `'ingame'` and this module loads the actual file on demand.
 *
 * When we wire music into gameplay, the plan is:
 *   title           → 'intro'
 *   countdown/play  → 'ingame'
 *   ended (win)     → 'special'
 */
export type MusicTrack = 'intro' | 'ingame' | 'special';

const MUSIC_FILES: Record<MusicTrack, string> = {
  intro:   '/audio/intro.mp3',
  ingame:  '/audio/ingame.mp3',
  special: '/audio/special.mp3',
};

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;    // SFX bus
let musicGain: GainNode | null = null;      // Music bus (independent from SFX)
let sfxMuted = false;
let musicMuted = false;

const MASTER_VOLUME = 0.35;   // SFX bus level
const MUSIC_VOLUME = 0.22;    // Music bus level (below SFX so combat stays legible)
const CROSSFADE_SEC = 1.2;    // Default crossfade time between music tracks

// Loaded music buffers (lazy, cached).
const musicBuffers = new Map<MusicTrack, AudioBuffer>();
// Active music source node + its gain (so crossfade can fade it out).
let currentMusic: { track: MusicTrack; source: AudioBufferSourceNode; gain: GainNode } | null = null;

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
    // Two independent buses. Each respects its own mute state at creation
    // time so a user who muted music before any track played doesn't get
    // a burst of audio when the context comes up.
    masterGain = ctx.createGain();
    masterGain.gain.value = sfxMuted ? 0 : MASTER_VOLUME;
    masterGain.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = musicMuted ? 0 : MUSIC_VOLUME;
    musicGain.connect(ctx.destination);
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
 * Mute/unmute the Music channel. Applies INSTANTLY to the music bus, same
 * pattern as SFX — if a track is playing, it goes silent without waiting
 * for any ramp. Persisted to localStorage.
 */
export function setMusicMuted(value: boolean): void {
  musicMuted = value;
  try {
    localStorage.setItem(STORAGE_KEY_MUSIC, value ? '1' : '0');
  } catch { /* ignore */ }
  if (musicGain && ctx) {
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(value ? 0 : MUSIC_VOLUME, ctx.currentTime);
  }
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

// ---------------------------------------------------------------------------
// Background music — lazy-load MP3s, per-track crossfade
// ---------------------------------------------------------------------------
//
// Usage (once gameplay wires it up):
//   playMusic('intro')           — starts or crossfades to the intro loop
//   playMusic('ingame')          — switches to the in-game track
//   stopMusic()                  — fades out whatever is playing
//
// Design:
//   - Tracks live at public/audio/*.mp3 (fetched on first request, cached).
//   - Each track loops automatically.
//   - Asking for the current track is a no-op.
//   - Asking for a different track crossfades CROSSFADE_SEC between them.
//   - All music goes through `musicGain` — independent from SFX mute.
//   - Safe to call before AudioContext init: it lazily creates the context
//     just like play(). Obviously needs a prior user gesture in browsers
//     that block autoplay.

/**
 * Fetch + decode an MP3 into an AudioBuffer. Cached per-track for the
 * lifetime of the page.
 */
async function loadMusicBuffer(track: MusicTrack): Promise<AudioBuffer | null> {
  if (musicBuffers.has(track)) return musicBuffers.get(track)!;
  if (!ctx) return null;
  try {
    const resp = await fetch(MUSIC_FILES[track]);
    if (!resp.ok) {
      console.warn('[Audio] music fetch failed', track, resp.status);
      return null;
    }
    const arrayBuf = await resp.arrayBuffer();
    const buf = await ctx.decodeAudioData(arrayBuf);
    musicBuffers.set(track, buf);
    return buf;
  } catch (err) {
    console.warn('[Audio] music load error', track, err);
    return null;
  }
}

/**
 * Play a background track. If another track is already playing, crossfades
 * over CROSSFADE_SEC. If the SAME track is already playing, this is a no-op.
 */
export async function playMusic(track: MusicTrack): Promise<void> {
  if (!ensureContext() || !ctx || !musicGain) return;
  if (currentMusic?.track === track) return;

  const buffer = await loadMusicBuffer(track);
  if (!buffer || !ctx || !musicGain) return;

  // New source with its own gain so we can fade it in while the previous
  // fades out. Both gains funnel into musicGain (which is mute-controlled).
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain).connect(musicGain);
  const startAt = ctx.currentTime;
  source.start(startAt);
  gain.gain.linearRampToValueAtTime(1.0, startAt + CROSSFADE_SEC);

  // Fade out the previous track and stop it when the crossfade finishes.
  const prev = currentMusic;
  currentMusic = { track, source, gain };
  if (prev) {
    const endAt = startAt + CROSSFADE_SEC;
    prev.gain.gain.cancelScheduledValues(startAt);
    prev.gain.gain.setValueAtTime(prev.gain.gain.value, startAt);
    prev.gain.gain.linearRampToValueAtTime(0, endAt);
    try { prev.source.stop(endAt + 0.02); } catch { /* already stopped */ }
  }
}

/** Fade out the current track (if any) over CROSSFADE_SEC and release it. */
export function stopMusic(): void {
  if (!ctx || !currentMusic) return;
  const now = ctx.currentTime;
  const { source, gain } = currentMusic;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SEC);
  try { source.stop(now + CROSSFADE_SEC + 0.02); } catch { /* already stopped */ }
  currentMusic = null;
}

/** True if the given track is currently playing (may still be ramping in). */
export function isMusicPlaying(track?: MusicTrack): boolean {
  if (!currentMusic) return false;
  if (!track) return true;
  return currentMusic.track === track;
}

/**
 * Preload a track's buffer without starting playback. Optional — `playMusic`
 * will load on demand, but calling this earlier (e.g. on title screen)
 * avoids a brief silence when the first transition lands.
 */
export async function preloadMusic(track: MusicTrack): Promise<void> {
  if (!ensureContext()) return;
  await loadMusicBuffer(track);
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
