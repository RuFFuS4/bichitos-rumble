#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Compress MP3 music tracks for faster page-load
// ---------------------------------------------------------------------------
//
// Uses ffmpeg-static (dev-only) to re-encode the Suno exports in
// public/audio/ at a sane VBR quality. Cartoon arcade music doesn't need
// 320 kbps — this script targets LAME's VBR preset 4 (≈128 kbps average,
// transparent for anything that isn't hi-fi). Typical savings: 30–45%.
//
// Usage:
//   node scripts/compress-audio.mjs                    # all MP3s in public/audio
//   node scripts/compress-audio.mjs public/audio/intro.mp3
//   npm run compress:audio
//
// Flags:
//   --quality <N>   LAME VBR quality 0..9 (0 = highest, 9 = lowest).
//                   Default 4 (~128 kbps). Try 5 for more savings,
//                   3 for higher fidelity.
//   --dry-run       print the ffmpeg command + estimated savings, don't
//                   overwrite anything.
//
// Strategy:
//   1. Pipe in-place: source → tmp file → if smaller, rename over source.
//      If the new file is LARGER (edge case with already-low-bitrate
//      sources), keep the original and log a skip.
//   2. Preserve the source in tmp until the rename succeeds, so a
//      mid-transcode crash never leaves a half-written MP3 live.
//
// Does not touch: SFX (synthesized at runtime via Web Audio), voice,
// anything outside `public/audio/*.mp3`.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { readdir, stat, rename, unlink } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const DEFAULT_DIR = resolve('public/audio');

const argv = process.argv.slice(2);
let targets = [];
let quality = 4;
let dryRun = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else if (a === '--quality' && argv[i + 1]) { quality = parseInt(argv[++i], 10); }
  else if (a === '--dry-run') { dryRun = true; }
  else if (!a.startsWith('--')) { targets.push(resolve(a)); }
  else { console.error(`Unknown flag: ${a}`); usage(); process.exit(1); }
}

if (!ffmpegPath) {
  console.error('ffmpeg-static did not resolve a binary path for this platform.');
  console.error('Try: npm install --save-dev ffmpeg-static (and re-run).');
  process.exit(1);
}

async function main() {
  if (targets.length === 0) {
    const entries = await readdir(DEFAULT_DIR);
    targets = entries
      .filter((f) => extname(f).toLowerCase() === '.mp3')
      .map((f) => join(DEFAULT_DIR, f));
  }
  if (targets.length === 0) {
    console.error('No MP3 files to process.');
    process.exit(1);
  }

  console.log(`\n  Audio compressor`);
  console.log(`  ffmpeg  : ${ffmpegPath}`);
  console.log(`  Quality : LAME VBR ${quality} (0=best, 9=worst)`);
  console.log(`  Files   : ${targets.length}\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  for (const path of targets) {
    const { before, after, changed } = await compressOne(path, quality, dryRun);
    totalBefore += before;
    if (changed) totalAfter += after;
    else totalAfter += before;
  }

  if (!dryRun) {
    const saved = totalBefore - totalAfter;
    const pct = totalBefore > 0 ? ((saved / totalBefore) * 100).toFixed(1) : '0';
    console.log(`\n  Total: ${fmt(totalBefore)} → ${fmt(totalAfter)}  (saved ${fmt(saved)}, ${pct}%)`);
  }
}

async function compressOne(srcPath, quality, dryRun) {
  const info = await stat(srcPath).catch(() => null);
  if (!info || !info.isFile()) {
    console.log(`  ⚠ Skip (not found): ${srcPath}`);
    return { before: 0, after: 0, changed: false };
  }
  const before = info.size;
  const name = basename(srcPath);

  if (dryRun) {
    console.log(`  [dry-run] ${name.padEnd(16)} ${fmt(before).padStart(10)}  (would re-encode at VBR ${quality})`);
    return { before, after: before, changed: false };
  }

  const tmpPath = srcPath + '.tmp';
  try {
    await runFfmpeg(srcPath, tmpPath, quality);
  } catch (err) {
    console.log(`  ❌ ${name.padEnd(16)} ffmpeg failed: ${err.message}`);
    await unlink(tmpPath).catch(() => {});
    return { before, after: before, changed: false };
  }

  const tmpInfo = await stat(tmpPath);
  const after = tmpInfo.size;

  if (after >= before) {
    // Already well-compressed — keep the original.
    await unlink(tmpPath);
    console.log(`  = ${name.padEnd(16)} ${fmt(before).padStart(10)} (kept, re-encode was ${fmt(after)})`);
    return { before, after: before, changed: false };
  }

  await rename(tmpPath, srcPath);
  const pct = ((1 - after / before) * 100).toFixed(1);
  console.log(
    `  ✓ ${name.padEnd(16)} ${fmt(before).padStart(10)} → ${fmt(after).padStart(10)}  (-${pct}%)`,
  );
  return { before, after, changed: true };
}

function runFfmpeg(src, dst, quality) {
  return new Promise((resolve, reject) => {
    // -q:a <N>  — LAME VBR quality (replaces the old --abr approach).
    // -map_metadata -1 — strip metadata tags we don't need in the bundle.
    // -y — overwrite without prompting (we control the path).
    // -f mp3 explicitly — our tmp file has a `.tmp` extension so ffmpeg
    // can't infer the format from the filename like it usually does.
    const args = [
      '-y',
      '-hide_banner', '-loglevel', 'error',
      '-i', src,
      '-codec:a', 'libmp3lame',
      '-q:a', String(quality),
      '-map_metadata', '-1',
      '-f', 'mp3',
      dst,
    ];
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited ${code}`));
    });
  });
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function usage() {
  console.log(`
Usage: node scripts/compress-audio.mjs [file|dir]... [flags]

No argument → processes every .mp3 under public/audio/.

Flags:
  --quality <N>   LAME VBR 0..9 (default 4 ≈ 128 kbps)
  --dry-run       print plan, don't write

Re-encodes MP3s in place. Originals replaced only if the result is
smaller — otherwise the file is left untouched.
  `.trim());
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
