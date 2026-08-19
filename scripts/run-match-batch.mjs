#!/usr/bin/env node
// ---------------------------------------------------------------------------
// run-match-batch.mjs — headless batch match runner (afilado / dual-surface)
// ---------------------------------------------------------------------------
//
// Runs N deterministic bot-vs-bot matches against the live dev server's
// /tools.html lab page and aggregates the results. This is the agent-first
// surface for balance questions: "is Shelly OP against heavies?" should
// cost one command, not ten hand-played matches.
//
//   npm run batch -- --matches=20 --player=Shelly --bots=Trunk,Kurama,Boro
//   node scripts/run-match-batch.mjs --verify --seed=42
//
// Requires the Vite dev server to be ALREADY running (default
// http://localhost:5173) — the runner never starts it. Uses the DevApi
// deterministic surface added by the afilado batch-runner slice:
//
//   __devApi.setAutopilot(true)      player slot driven by the bot brain
//   __devApi.setFixedStep(K)         K sim steps of fixed 1/60 dt per frame
//   __devApi.startMatch(p, bots, {seed, packId})   seeds arena + match PRNG
//   __devApi.getRecording()          RecordingSession (events/outcome/meta)
//   __game.phase === 'ended'         match over (offline rules are
//                                    player-centric: the match also ends
//                                    the moment the player is eliminated)
//
// Determinism contract: same seed + same speed + same lineup => same
// outcome and same gameplay-event sequence. Event/meta TIMESTAMPS are
// wall-clock and are NOT comparable across runs — --verify compares by
// event order (type|actor|details) and outcome only.
//
// Known limitations of the event stream (see DevApi.pollGameplayEvents):
//   - 'headbutt' fires when a headbutt STARTS — thrown, not connected.
//   - 'fall' events carry no cause (pushed vs walked off): death-cause
//     distribution is reported as falls/eliminations per critter plus
//     the per-match end reason, not push-attribution.
// ---------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// Mirrors DevApi.SNAPSHOT_INTERVAL_MS (200 ms of SIM time under fixed-step):
// sim duration ≈ (snapshots - 1) * 0.2. Recompute here because the
// recording's durationSec is wall-clock (≈ sim/speed under fixed-step).
const SNAPSHOT_INTERVAL_SEC = 0.2;
// FEEL.match.duration (120 s) + FEEL.match.countdown (3 s) — used only to
// size the poll timeout, not to enforce anything.
const MATCH_SIM_SEC = 123;
const TIMEOUT_MARGIN_MS = 30_000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `run-match-batch — batch de partidas deterministas headless (Bichitos Rumble)

Uso:
  node scripts/run-match-batch.mjs [flags]
  npm run batch -- [flags]

Requiere el dev server YA levantado (npm run dev). No lo arranca.

Flags:
  --matches=N            Partidas a correr (def: 10). Seeds = BASE..BASE+N-1.
  --seed=BASE            Seed base (def: 1). Tambien siembra el PRNG del
                         propio runner (eleccion de bots por defecto).
  --player=Name          Critter del slot player, en autopilot (def: Sergei).
  --bots=A,B,C           Bots separados por coma. Def: 3 aleatorios distintos
                         (excluyendo al player) elegidos con el PRNG del
                         runner sembrado en BASE — batch 100% reproducible.
  --pack=id              Arena pack fijo (def: aleatorio por seed).
  --speed=K              stepsPerFrame del fixed-step (def: 8; 8 ≈ 8x tiempo real).
  --out=path.json        JSON de resultados (def: .tmp/batch-results.json).
  --dump-recordings=dir  Guarda la RecordingSession completa de cada partida
                         como <dir>/match-XXX-seed-N.json (volcado headless).
  --verify               En vez del batch: corre seed BASE dos veces (con
                         reload de pagina entre medias) y compara outcome +
                         secuencia de events. Imprime REPRODUCIBLE: yes/no
                         (exit 1 si no) con el primer punto de divergencia.
  --url=URL              Base del dev server (def: http://localhost:5173).
  --help                 Esta ayuda.

Salida: tabla por consola (winrate por critter, duracion media, distribucion
de finales) + JSON completo (config + por-partida + agregados) en --out.
`;

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      matches: { type: 'string', default: '10' },
      seed: { type: 'string', default: '1' },
      player: { type: 'string', default: 'Sergei' },
      bots: { type: 'string' },
      pack: { type: 'string' },
      speed: { type: 'string', default: '8' },
      out: { type: 'string', default: path.join('.tmp', 'batch-results.json') },
      'dump-recordings': { type: 'string' },
      verify: { type: 'boolean', default: false },
      url: { type: 'string', default: 'http://localhost:5173' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) return { help: true };

  const asInt = (name, raw, { min = 1 } = {}) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) {
      throw new Error(`--${name}=${raw} no es un entero valido (min ${min}).`);
    }
    return n;
  };

  return {
    help: false,
    matches: asInt('matches', values.matches),
    baseSeed: asInt('seed', values.seed, { min: 0 }),
    player: values.player,
    bots: values.bots
      ? values.bots.split(',').map((s) => s.trim()).filter(Boolean)
      : null, // null => elegir con el PRNG del runner
    pack: values.pack ?? null,
    speed: asInt('speed', values.speed),
    out: values.out,
    dumpDir: values['dump-recordings'] ?? null,
    verify: values.verify,
    url: values.url,
  };
}

// ---------------------------------------------------------------------------
// Runner-side PRNG — same mulberry32 as src/match-rng.ts, so the default
// bot lineup is reproducible from --seed alone.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickDefaultBots(roster, player, baseSeed) {
  const rng = mulberry32(baseSeed);
  const pool = roster.filter((n) => n !== player);
  const picks = [];
  for (let k = 0; k < 3 && pool.length > 0; k++) {
    picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return picks;
}

// ---------------------------------------------------------------------------
// Browser plumbing
// ---------------------------------------------------------------------------

async function loadChromium() {
  // @playwright/test re-exports chromium; playwright-core is its transitive
  // dep and works as fallback if that ever changes.
  try {
    const m = await import('@playwright/test');
    if (m.chromium) return m.chromium;
  } catch { /* fall through */ }
  const core = await import('playwright-core');
  return core.chromium;
}

async function probeServer(labUrl) {
  try {
    const res = await fetch(labUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`ERROR: el dev server no responde en ${labUrl}`);
    console.error('       Arranca "npm run dev" en otra terminal y reintenta.');
    console.error(`       (detalle: ${e?.cause?.code ?? e.message})`);
    process.exit(1);
  }
}

async function openLabPage(browser, labUrl) {
  const page = await browser.newPage();
  // Forward page-side errors to the runner's stderr so a broken build is
  // visible instead of silently producing a hung poll.
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[page console.error] ${msg.text()}`);
  });
  await page.goto(labUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean(window.__devApi) && Boolean(window.__game),
    { timeout: 30_000 },
  );
  return page;
}

// ---------------------------------------------------------------------------
// One match
// ---------------------------------------------------------------------------

async function runOneMatch(page, { player, bots, seed, packId, speed, timeoutMs }) {
  // Arm the deterministic surface BEFORE startMatch so the lab actions land
  // outside the new recording (the recording stays a pure gameplay trace;
  // the runner config is captured in the results JSON instead).
  await page.evaluate(({ speed }) => {
    const api = window.__devApi;
    api.setAutopilot(true);
    api.setFixedStep(speed);
    if (api.getSpeed() === 0) api.setSpeed(1); // pause wins over fixed-step
  }, { speed });

  const startPhase = await page.evaluate(({ player, bots, seed, packId }) => {
    const opts = { seed };
    if (packId) opts.packId = packId;
    window.__devApi.startMatch(player, bots, opts);
    return window.__game.phase;
  }, { player, bots, seed, packId });

  if (startPhase !== 'countdown' && startPhase !== 'playing') {
    throw new Error(
      `startMatch no arranco (phase="${startPhase}"). ` +
      `Nombre de critter desconocido? player="${player}" bots=[${bots.join(', ')}]`,
    );
  }

  // End condition (per the sim contract): phase 'ended' OR a finalised
  // recording outcome. Offline rules end the match the instant the player
  // dies, which can leave outcome.reason null — stopRecording() below
  // closes it so meta.durationSec / endedAt are always filled.
  //
  // The wait is PROGRESS-based, not wall-clock-based: under SwiftShader
  // the effective sim rate varies wildly with scene cost, so a fixed
  // timeout misclassifies slow-but-healthy matches as stuck. We only
  // bail when the sim clock (matchTimer) stops advancing for STALL_MS
  // (phase changes count as progress too — countdown doesn't tick the
  // match timer), or on a generous hard cap.
  const ended = await (async () => {
    const STALL_MS = 20_000;
    const hardCapMs = Math.max(timeoutMs, 10 * 60_000);
    const t0 = Date.now();
    let lastTimer = Infinity;
    let lastPhase = null;
    let lastProgressAt = Date.now();
    for (;;) {
      const s = await page.evaluate(() => {
        const rec = window.__devApi.getRecording();
        const g = window.__game;
        return {
          done: g.phase === 'ended' || (rec !== null && rec.outcome.reason !== null),
          timer: typeof g.matchTimer === 'number' ? g.matchTimer : null,
          phase: g.phase,
        };
      });
      if (s.done) return true;
      const timerMoved = s.timer !== null && s.timer < lastTimer - 0.01;
      if (timerMoved || s.phase !== lastPhase) {
        lastTimer = timerMoved ? s.timer : lastTimer;
        lastPhase = s.phase;
        lastProgressAt = Date.now();
      }
      if (Date.now() - lastProgressAt > STALL_MS) return false;
      if (Date.now() - t0 > hardCapMs) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
  })();

  const payload = await page.evaluate(({ ended }) => {
    const api = window.__devApi;
    const g = window.__game;
    const idx = typeof g.playerIndex === 'number' ? g.playerIndex : 0;
    const playerCritter = (g.critters && g.critters[idx]) || null;
    const end = {
      phase: g.phase,
      // matchTimer is TS-private but runtime-readable; <= 0 means the match
      // hit FEEL.match.duration (timeout end).
      matchTimerExpired: typeof g.matchTimer === 'number' ? g.matchTimer <= 0 : false,
      playerAlive: playerCritter ? playerCritter.alive : null,
      aliveNames: (g.critters ?? []).filter((c) => c.alive).map((c) => c.config.name),
    };
    if (!ended) {
      api.endMatch(); // hard-stop a stuck match (also finalises the recording)
    } else {
      const rec = api.getRecording();
      if (rec && rec.outcome.reason === null) api.stopRecording();
    }
    return { end, recording: api.getRecording() };
  }, { ended });

  return { ...payload, runnerTimedOut: !ended };
}

function classifyEnd(recording, end, runnerTimedOut) {
  if (runnerTimedOut) return 'runner_timeout';
  if (recording?.outcome?.reason === 'last_standing') return 'last_standing';
  if (end.matchTimerExpired) return 'match_timeout';
  if (end.playerAlive === false) return 'player_eliminated';
  return 'unknown';
}

const PER_CRITTER_EVENTS = {
  headbutt: 'headbutts',
  ability_cast: 'abilityCasts',
  fall: 'falls',
  respawn: 'respawns',
  eliminate: 'eliminations',
};

function summarizeMatch({ index, seed, recording, end, runnerTimedOut, participants }) {
  const perCritter = {};
  for (const name of participants) {
    perCritter[name] = {
      isPlayer: name === participants[0],
      headbutts: 0,
      abilityCasts: 0,
      falls: 0,
      respawns: 0,
      eliminations: 0,
      won: false,
    };
  }
  for (const ev of recording?.events ?? []) {
    const bucket = PER_CRITTER_EVENTS[ev.type];
    if (!bucket || !ev.actor || !perCritter[ev.actor]) continue; // skip 'lab'/'arena'
    perCritter[ev.actor][bucket] += 1;
  }
  const survivor = recording?.outcome?.survivor ?? null;
  if (survivor && perCritter[survivor]) perCritter[survivor].won = true;

  const snapshots = recording?.snapshots?.length ?? 0;
  return {
    index,
    seed,
    ok: true,
    survivor,
    outcomeReason: recording?.outcome?.reason ?? null,
    endReason: classifyEnd(recording, end, runnerTimedOut),
    endPhase: end.phase,
    aliveAtEnd: end.aliveNames,
    durationWallSec: recording?.meta?.durationSec ?? null,
    durationSimSec: snapshots > 0
      ? Number((Math.max(0, snapshots - 1) * SNAPSHOT_INTERVAL_SEC).toFixed(1))
      : null,
    arenaSeed: recording?.meta?.seed ?? null,
    arenaPattern: recording?.meta?.arenaPattern ?? null,
    eventCount: recording?.events?.length ?? 0,
    snapshotCount: snapshots,
    perCritter,
  };
}

// ---------------------------------------------------------------------------
// Aggregation + reporting
// ---------------------------------------------------------------------------

function aggregate(matchResults, participants) {
  const byCritter = {};
  for (const name of participants) {
    byCritter[name] = {
      isPlayer: name === participants[0],
      matches: 0, wins: 0, winrate: 0,
      headbutts: 0, abilityCasts: 0, falls: 0, respawns: 0, eliminations: 0,
      avgHeadbutts: 0, avgFalls: 0,
    };
  }
  const endReasons = {};
  let simSum = 0; let simCount = 0;
  let wallSum = 0; let wallCount = 0;

  for (const m of matchResults) {
    if (!m.ok) continue;
    endReasons[m.endReason] = (endReasons[m.endReason] ?? 0) + 1;
    if (m.durationSimSec !== null) { simSum += m.durationSimSec; simCount++; }
    if (m.durationWallSec !== null) { wallSum += m.durationWallSec; wallCount++; }
    for (const [name, s] of Object.entries(m.perCritter)) {
      const agg = byCritter[name];
      if (!agg) continue;
      agg.matches += 1;
      if (s.won) agg.wins += 1;
      agg.headbutts += s.headbutts;
      agg.abilityCasts += s.abilityCasts;
      agg.falls += s.falls;
      agg.respawns += s.respawns;
      agg.eliminations += s.eliminations;
    }
  }
  for (const agg of Object.values(byCritter)) {
    if (agg.matches > 0) {
      agg.winrate = Number((agg.wins / agg.matches).toFixed(3));
      agg.avgHeadbutts = Number((agg.headbutts / agg.matches).toFixed(1));
      agg.avgFalls = Number((agg.falls / agg.matches).toFixed(1));
    }
  }
  return {
    matchesOk: matchResults.filter((m) => m.ok).length,
    matchesFailed: matchResults.filter((m) => !m.ok).length,
    byCritter,
    endReasons,
    avgDurationSimSec: simCount > 0 ? Number((simSum / simCount).toFixed(1)) : null,
    avgDurationWallSec: wallCount > 0 ? Number((wallSum / wallCount).toFixed(1)) : null,
  };
}

function printTable(agg, cfg) {
  const rows = Object.entries(agg.byCritter).map(([name, s]) => ([
    s.isPlayer ? `${name} (P)` : name,
    String(s.matches),
    String(s.wins),
    s.matches > 0 ? `${(s.winrate * 100).toFixed(1)}%` : '-',
    s.matches > 0 ? String(s.avgHeadbutts) : '-',
    s.matches > 0 ? String(s.avgFalls) : '-',
    String(s.eliminations),
  ]));
  const header = ['Critter', 'Part', 'Wins', 'Winrate', 'HB/part', 'Falls/part', 'Elims'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');

  console.log('');
  console.log(`== Batch: ${agg.matchesOk}/${cfg.matches} partidas OK · seeds ${cfg.baseSeed}..${cfg.baseSeed + cfg.matches - 1} · speed ${cfg.speed}x ==`);
  console.log(line(header));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const r of rows) console.log(line(r));
  console.log('');
  const reasons = Object.entries(agg.endReasons).map(([k, v]) => `${k} ${v}`).join(' · ') || '(ninguna)';
  console.log(`Finales: ${reasons}`);
  console.log(`Duracion media: ${agg.avgDurationSimSec ?? '?'} s sim (${agg.avgDurationWallSec ?? '?'} s wall)`);
  console.log('(HB = headbutts LANZADOS, no conectados; falls sin causa push/caida — limite del event stream)');
}

// ---------------------------------------------------------------------------
// Verify mode — same seed twice with a page reload in between, compare
// outcome + gameplay-event sequence (order only; timestamps are wall-clock).
// ---------------------------------------------------------------------------

function normalizeEvents(recording) {
  return (recording?.events ?? []).map(
    (e) => `${e.type}|${e.actor ?? ''}|${e.details ?? ''}`,
  );
}

async function runVerify(browser, labUrl, cfg, participants) {
  const runCfg = {
    player: cfg.player,
    bots: cfg.bots,
    seed: cfg.baseSeed,
    packId: cfg.pack,
    speed: cfg.speed,
    timeoutMs: Math.ceil((MATCH_SIM_SEC / cfg.speed) * 1000) + TIMEOUT_MARGIN_MS,
  };

  console.log(`Verify: seed ${cfg.baseSeed}, dos runs con reload entre medias...`);
  let page = await openLabPage(browser, labUrl);
  const a = await runOneMatch(page, runCfg);
  await page.close();
  page = await openLabPage(browser, labUrl); // fresh page ≈ fresh CLI invocation
  const b = await runOneMatch(page, runCfg);
  await page.close();

  const evA = normalizeEvents(a.recording);
  const evB = normalizeEvents(b.recording);
  const sumA = summarizeMatch({ index: 0, seed: cfg.baseSeed, ...a, participants });
  const sumB = summarizeMatch({ index: 1, seed: cfg.baseSeed, ...b, participants });

  let divergence = null;
  const n = Math.max(evA.length, evB.length);
  for (let i = 0; i < n; i++) {
    if (evA[i] !== evB[i]) {
      divergence = { index: i, runA: evA[i] ?? '(sin evento)', runB: evB[i] ?? '(sin evento)' };
      break;
    }
  }
  const outcomeMatches = sumA.survivor === sumB.survivor && sumA.endReason === sumB.endReason;
  const reproducible = divergence === null && outcomeMatches;

  console.log('');
  console.log(`REPRODUCIBLE: ${reproducible ? 'yes' : 'no'}`);
  if (!reproducible) {
    if (divergence) {
      console.log(`  primera divergencia en evento #${divergence.index}:`);
      console.log(`    run A: ${divergence.runA}`);
      console.log(`    run B: ${divergence.runB}`);
    }
    console.log(`  eventos: run A ${evA.length} · run B ${evB.length}`);
    console.log(`  outcome A: survivor=${sumA.survivor} endReason=${sumA.endReason}`);
    console.log(`  outcome B: survivor=${sumB.survivor} endReason=${sumB.endReason}`);
  } else {
    console.log(`  ${evA.length} eventos identicos · survivor=${sumA.survivor} · endReason=${sumA.endReason}`);
  }

  const outDoc = {
    version: 1,
    mode: 'verify',
    generatedAtIso: new Date().toISOString(),
    config: publicConfig(cfg),
    reproducible,
    divergence,
    runs: [sumA, sumB],
  };
  await writeJson(cfg.out, outDoc);
  console.log(`JSON: ${path.resolve(cfg.out)}`);
  return reproducible;
}

// ---------------------------------------------------------------------------
// Batch mode
// ---------------------------------------------------------------------------

async function runBatch(browser, labUrl, cfg, participants) {
  const page = await openLabPage(browser, labUrl);
  const timeoutMs = Math.ceil((MATCH_SIM_SEC / cfg.speed) * 1000) + TIMEOUT_MARGIN_MS;
  if (cfg.dumpDir) await mkdir(cfg.dumpDir, { recursive: true });

  const matchResults = [];
  for (let i = 0; i < cfg.matches; i++) {
    const seed = cfg.baseSeed + i;
    process.stdout.write(`partida ${i + 1}/${cfg.matches} (seed ${seed})... `);
    try {
      const raw = await runOneMatch(page, {
        player: cfg.player,
        bots: cfg.bots,
        seed,
        packId: cfg.pack,
        speed: cfg.speed,
        timeoutMs,
      });
      const summary = summarizeMatch({ index: i, seed, ...raw, participants });
      if (cfg.dumpDir && raw.recording) {
        const file = path.join(
          cfg.dumpDir,
          `match-${String(i).padStart(3, '0')}-seed-${seed}.json`,
        );
        await writeFile(file, JSON.stringify(raw.recording), 'utf8');
        summary.recordingFile = path.resolve(file);
      }
      matchResults.push(summary);
      console.log(`${summary.endReason}${summary.survivor ? ` -> ${summary.survivor}` : ''} (${summary.durationSimSec ?? '?'} s sim)`);
    } catch (e) {
      // startMatch failing on match 0 is a config error (unknown critter):
      // abort. Later failures are recorded and the batch continues.
      if (i === 0) throw e;
      console.log(`FALLO: ${e.message}`);
      matchResults.push({ index: i, seed, ok: false, error: e.message });
    }
  }
  await page.close();

  const agg = aggregate(matchResults, participants);
  printTable(agg, cfg);

  const outDoc = {
    version: 1,
    mode: 'batch',
    generatedAtIso: new Date().toISOString(),
    config: publicConfig(cfg),
    matches: matchResults,
    aggregates: agg,
  };
  await writeJson(cfg.out, outDoc);
  console.log(`JSON: ${path.resolve(cfg.out)}`);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function publicConfig(cfg) {
  return {
    url: cfg.url,
    matches: cfg.matches,
    baseSeed: cfg.baseSeed,
    player: cfg.player,
    bots: cfg.bots,
    botsWereAutoPicked: cfg.botsWereAutoPicked,
    pack: cfg.pack,
    speed: cfg.speed,
    dumpRecordings: cfg.dumpDir,
  };
}

async function writeJson(outPath, doc) {
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify(doc, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let cfg;
  try {
    cfg = parseCli(process.argv.slice(2));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    console.error('Usa --help para ver los flags.');
    process.exit(1);
  }
  if (cfg.help) {
    console.log(HELP);
    return;
  }

  const labUrl = new URL('/tools.html', cfg.url).href;
  await probeServer(labUrl);

  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true });
  let exitCode = 0;
  try {
    // Roster comes from the live page (single source of truth) so the
    // runner never hardcodes critter names.
    const rosterPage = await openLabPage(browser, labUrl);
    const roster = await rosterPage.evaluate(
      () => window.__devApi.getPWSSnapshot().map((r) => r.name),
    );
    await rosterPage.close();

    if (!roster.includes(cfg.player)) {
      throw new Error(`player "${cfg.player}" no esta en el roster: ${roster.join(', ')}`);
    }
    cfg.botsWereAutoPicked = cfg.bots === null;
    if (cfg.bots === null) {
      cfg.bots = pickDefaultBots(roster, cfg.player, cfg.baseSeed);
    } else {
      const unknown = cfg.bots.filter((b) => !roster.includes(b));
      if (unknown.length > 0) {
        throw new Error(`bots desconocidos: ${unknown.join(', ')}. Roster: ${roster.join(', ')}`);
      }
      if (cfg.bots.length > 3) {
        console.error(`AVISO: mas de 3 bots — el juego recorta a 4 luchadores en total.`);
      }
    }
    const participants = [cfg.player, ...cfg.bots];
    if (new Set(participants).size !== participants.length) {
      console.error('AVISO: lineup con nombres duplicados — las stats por critter se fusionan por nombre.');
    }
    console.log(`Lineup: ${cfg.player} (P, autopilot) vs ${cfg.bots.join(', ')}${cfg.botsWereAutoPicked ? ' [auto, PRNG seed ' + cfg.baseSeed + ']' : ''}`);

    if (cfg.verify) {
      const ok = await runVerify(browser, labUrl, cfg, participants);
      if (!ok) exitCode = 1;
    } else {
      await runBatch(browser, labUrl, cfg, participants);
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    exitCode = 1;
  } finally {
    await browser.close();
  }
  process.exit(exitCode);
}

main();
