#!/usr/bin/env node
// ---------------------------------------------------------------------------
// admin-players — read / delete / reset utility for the players table
// ---------------------------------------------------------------------------
//
// Plain Node script, no external state, just opens the same SQLite file
// the server uses (`$DATA_DIR/br-online.sqlite`, default `./data`). All
// destructive subcommands DRY-RUN by default and require an explicit
// `--confirm` flag to actually write to the DB.
//
// Subcommands:
//   list                                — print every player + stats row
//   stats <playerId|nickname>           — show one player's full row
//   delete <nickname>      [--confirm]  — delete one player by nickname
//   delete-pattern <like>  [--confirm]  — delete by SQL LIKE pattern
//   delete-before <iso>    [--confirm]  — delete rows created before date
//   delete-test           [--confirm]  — delete all 'test'-flavoured rows
//                                          (matches *test*, *qa*, *demo*,
//                                           *foo*, *bar*, *temp*)
//   reset                  [--confirm]  — wipe the whole players table
//                                          (DANGEROUS, last-resort prune)
//
// Examples:
//   node server/scripts/admin-players.mjs list
//   node server/scripts/admin-players.mjs delete-test
//   node server/scripts/admin-players.mjs delete-test --confirm
//   node server/scripts/admin-players.mjs delete "RafaTest1" --confirm
//
// Safety rules:
//   · No subcommand writes without --confirm.
//   · Every destructive subcommand prints the full SELECT preview first.
//   · `reset` requires both --confirm AND --i-know-what-im-doing.
//   · Foreign keys cascade (player_stats → players) so deleting a player
//     also purges their stats automatically.
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Resolve DB path the same way server/src/db.ts does so we always
// hit the file the live server is using.
const DATA_DIR = process.env.DATA_DIR ?? './data';
const DB_PATH = resolve(`${DATA_DIR}/br-online.sqlite`);

if (!existsSync(DB_PATH)) {
  console.error(`[admin] DB file not found at ${DB_PATH}`);
  console.error('[admin] Make sure DATA_DIR is set to the right path or run from the server/ folder.');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = argv.slice(1).filter(a => !a.startsWith('--'));
const flags = new Set(argv.filter(a => a.startsWith('--')));
const confirm = flags.has('--confirm');

function fmtDate(ms) {
  if (!ms) return '?';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function listPlayers() {
  const rows = db
    .prepare(
      `SELECT
         p.id, p.nickname_display, p.nickname_norm,
         p.created_at, p.last_seen,
         s.wins_online, s.matches_online,
         s.fastest_win_ms, s.kills_vs_humans,
         s.longest_streak
       FROM players p
       LEFT JOIN player_stats s ON s.player_id = p.id
       ORDER BY p.last_seen DESC`,
    )
    .all();
  if (rows.length === 0) {
    console.log('[admin] no players registered');
    return rows;
  }
  console.log(`[admin] ${rows.length} player(s):`);
  console.log(
    'idShort'.padEnd(10),
    'nickname'.padEnd(18),
    'created'.padEnd(20),
    'last_seen'.padEnd(20),
    'wins/matches'.padEnd(13),
    'streak',
  );
  for (const r of rows) {
    console.log(
      String(r.id).slice(0, 8).padEnd(10),
      (r.nickname_display ?? '').padEnd(18),
      fmtDate(r.created_at).padEnd(20),
      fmtDate(r.last_seen).padEnd(20),
      `${r.wins_online ?? 0}/${r.matches_online ?? 0}`.padEnd(13),
      String(r.longest_streak ?? 0),
    );
  }
  return rows;
}

function previewMatching(whereClause, params) {
  const rows = db
    .prepare(
      `SELECT p.id, p.nickname_display, p.created_at, p.last_seen,
              s.wins_online, s.matches_online
         FROM players p
         LEFT JOIN player_stats s ON s.player_id = p.id
         WHERE ${whereClause}
         ORDER BY p.last_seen DESC`,
    )
    .all(...params);
  if (rows.length === 0) {
    console.log('[admin] no rows match');
    return rows;
  }
  console.log(`[admin] ${rows.length} row(s) MATCH (preview):`);
  for (const r of rows) {
    console.log(
      ` · ${r.nickname_display.padEnd(18)} created ${fmtDate(r.created_at)} ` +
      `last_seen ${fmtDate(r.last_seen)} wins ${r.wins_online ?? 0}/${r.matches_online ?? 0}`,
    );
  }
  return rows;
}

function deleteMatching(whereClause, params, label) {
  const rows = previewMatching(whereClause, params);
  if (rows.length === 0) return;
  if (!confirm) {
    console.log(`\n[admin] DRY RUN — re-run with --confirm to actually delete (${label}).`);
    return;
  }
  // FK cascade purges player_stats automatically.
  const result = db.prepare(`DELETE FROM players WHERE ${whereClause}`).run(...params);
  console.log(`\n[admin] DELETED ${result.changes} row(s).`);
}

function showStats(needle) {
  const row = db
    .prepare(
      `SELECT p.*, s.*
         FROM players p
         LEFT JOIN player_stats s ON s.player_id = p.id
         WHERE p.id = ? OR p.nickname_norm = ?`,
    )
    .get(needle, needle.trim().toLowerCase());
  if (!row) {
    console.log(`[admin] no player matches "${needle}"`);
    return;
  }
  for (const [k, v] of Object.entries(row)) {
    if (k === 'token_hash' || k === 'identity_id') {
      // Hide secrets from the printout.
      console.log(`  ${k.padEnd(22)} <hidden>`);
    } else if (k === 'created_at' || k === 'last_seen' || k === 'updated_at') {
      console.log(`  ${k.padEnd(22)} ${fmtDate(v)}`);
    } else {
      console.log(`  ${k.padEnd(22)} ${v}`);
    }
  }
}

switch (cmd) {
  case 'list':
    listPlayers();
    break;

  case 'stats': {
    if (!args[0]) {
      console.error('[admin] usage: stats <playerId|nickname>');
      process.exit(1);
    }
    showStats(args[0]);
    break;
  }

  case 'delete': {
    if (!args[0]) {
      console.error('[admin] usage: delete <nickname> [--confirm]');
      process.exit(1);
    }
    const nick = args[0].trim().toLowerCase();
    deleteMatching('nickname_norm = ?', [nick], `nickname=${args[0]}`);
    break;
  }

  case 'delete-pattern': {
    if (!args[0]) {
      console.error('[admin] usage: delete-pattern <SQL-LIKE-pattern> [--confirm]');
      console.error('  example: delete-pattern "%test%" --confirm');
      process.exit(1);
    }
    const pattern = args[0].toLowerCase();
    deleteMatching('nickname_norm LIKE ?', [pattern], `pattern=${pattern}`);
    break;
  }

  case 'delete-before': {
    if (!args[0]) {
      console.error('[admin] usage: delete-before <ISO-date> [--confirm]');
      console.error('  example: delete-before "2026-04-29" --confirm');
      process.exit(1);
    }
    const ts = Date.parse(args[0]);
    if (Number.isNaN(ts)) {
      console.error(`[admin] invalid date "${args[0]}"`);
      process.exit(1);
    }
    deleteMatching('created_at < ?', [ts], `created_before=${args[0]}`);
    break;
  }

  case 'delete-test': {
    // Convenient one-shot bulk-prune for QA names. Pattern list lives
    // here so it's grep-friendly when adding more.
    const PATTERNS = ['%test%', '%qa%', '%demo%', '%foo%', '%bar%', '%temp%', '%dummy%'];
    const where = PATTERNS.map(() => 'nickname_norm LIKE ?').join(' OR ');
    deleteMatching(where, PATTERNS, `test patterns: ${PATTERNS.join(', ')}`);
    break;
  }

  case 'reset': {
    const really = flags.has('--i-know-what-im-doing');
    const all = db.prepare('SELECT COUNT(*) AS n FROM players').get();
    console.log(`[admin] ${all.n} row(s) currently in players table.`);
    if (!confirm || !really) {
      console.log('\n[admin] DRY RUN — to actually wipe the table run:');
      console.log('         node server/scripts/admin-players.mjs reset --confirm --i-know-what-im-doing');
      break;
    }
    const result = db.prepare('DELETE FROM players').run();
    console.log(`[admin] WIPED ${result.changes} row(s) from players (cascades to player_stats).`);
    break;
  }

  default:
    console.log('admin-players — bichitos-rumble player table utility');
    console.log('');
    console.log('Subcommands:');
    console.log('  list                                  list every player + stats summary');
    console.log('  stats <playerId|nickname>             show one player full row');
    console.log('  delete <nickname>          [--confirm]   delete one player by nickname');
    console.log('  delete-pattern <like>      [--confirm]   delete by SQL LIKE pattern (% wildcards)');
    console.log('  delete-before <iso-date>   [--confirm]   delete players created before a date');
    console.log('  delete-test                [--confirm]   delete %test% / %qa% / %demo% / %foo% / %bar% / %temp% / %dummy%');
    console.log('  reset                  [--confirm --i-know-what-im-doing]   wipe the whole players table');
    console.log('');
    console.log('Without --confirm every destructive command prints a DRY-RUN preview.');
    console.log('');
    console.log(`DB path: ${DB_PATH}`);
    process.exit(cmd ? 1 : 0);
}

db.close();
