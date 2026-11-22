// Pre-Token Radar: reads the sealed snapshot, ranks the protocols that
// record no token by an implied launch value, and writes the board, the
// dashboard's data, the dashboard and screenshots, and the dossier.
//
//   node main.ts --input <snapshot.json>
//   MAKEFUN_OUTPUT_DIR=<dir> node main.ts --input <snapshot.json>
//
// Standard library only. No clock, no randomness, no network: two runs on
// the same snapshot write the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIRDROP_SHARE, ANCHOR_MIN_TVL, FAMILY_OF_CATEGORY, RATIO_MAX, RATIO_MIN,
  computeAnchors, computeRow, admittedToBoard,
  familyOf, rankRows, roundTo, tokenStatus, type Protocol, type Snapshot,
} from './lib/model.ts';
import { GAS_DEFAULT, GAS_USD, buildPlan, stepText } from './lib/plans.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return fallback;
}

const inputPath = arg('input', '/input/snapshot.json');
const outDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// ---- read and validate the snapshot -------------------------------------
// The snapshot's contract is exact: a fixed set of top-level keys and ten
// fields per protocol. Anything else means the input is not the sealed
// snapshot, and the run stops rather than guessing.
const PROTOCOL_FIELDS = [
  'slug', 'name', 'category', 'chains', 'tvl_usd',
  'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol',
];
function loadSnapshot(path: string): Snapshot {
  const snap = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  for (const key of ['as_of', 'source', 'floor_usd', 'protocols', 'watchlist']) {
    if (!(key in snap)) throw new Error(`snapshot is missing top-level key ${key}`);
  }
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new Error('snapshot protocols/watchlist must be arrays');
  }
  for (const p of snap.protocols) {
    const keys = Object.keys(p as Protocol).sort();
    if (keys.length !== PROTOCOL_FIELDS.length || !PROTOCOL_FIELDS.every((f) => keys.includes(f))) {
      throw new Error(`protocol ${(p as Protocol).slug ?? '?'} does not carry exactly the ten snapshot fields`);
    }
  }
  return snap;
}

// ---- copy a directory's files, in sorted name order ----------------------
function copyDir(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
  for (const name of names) copyFileSync(join(from, name), join(to, name));
  return names;
}

function main(): void {
  const snap = loadSnapshot(inputPath);
  const watchlist = new Set(snap.watchlist);
  const anchors = computeAnchors(snap.protocols);

  // Admit: pre-token protocols passing the board rule, plus every watchlist
  // slug unconditionally.
  const cores = [];
  for (const p of snap.protocols) {
    if (tokenStatus(p) !== 'pre-token') continue;
    if (!admittedToBoard(p) && !watchlist.has(p.slug)) continue;
    cores.push(computeRow(p, anchors, snap.as_of, watchlist, snap.floor_usd));
  }
  const ranked = rankRows(cores);

  // Build the board rows, with a farm plan per row.
  const rows = ranked.map((core, i) => {
    const p = core.protocol;
    const plan = buildPlan(core);
    const farmSteps = plan.steps.map(stepText);
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: core.implied,
      category: p.category,
      family: core.family,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: core.ageDays,
      watchlist: core.watchlist,
      tier: core.tier,
      anchor: roundTo(core.anchor, 4),
      n_cat: core.nCat,
      n_fam: core.nFam,
      momentum: roundTo(core.momentum, 3),
      tokenless: roundTo(core.tokenless, 3),
      fdv_usd: Math.round(core.fdv),
      airdrop_share: core.share,
      pool_usd: Math.round(core.pool),
      per_1k_usd: roundTo(core.per1k, 2),
      ev_ratio: roundTo(plan.ev_ratio, 2),
      plan: {
        capital_usd: plan.capital_usd,
        hold_days: plan.hold_days,
        total_cost_usd: plan.total_cost_usd,
        total_gas_usd: plan.total_gas_usd,
        active_minutes: plan.active_minutes,
        expected_usd: plan.expected_usd,
        ev_ratio: roundTo(plan.ev_ratio, 2),
        priority: plan.priority,
        steps: plan.steps,
      },
      farm_steps: farmSteps,
      flags: { g_missing: core.gMissing, age_missing: core.ageMissing },
    };
  });

  // Gate-shaped assertions: fail the run rather than write an invalid board.
  const covered = rows.filter((r) => watchlist.has(r.slug)).length;
  if (covered !== watchlist.size) {
    throw new Error(`watchlist coverage ${covered}/${watchlist.size}: the board must cover every watchlist slug`);
  }
  if (rows.length < 100 || rows.length > 4000) throw new Error(`board rows ${rows.length} outside 100..4000`);
  if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) throw new Error('all implied values are equal: not a ranking');
  for (const r of rows) {
    if (r.farm_steps.length < 6 || r.farm_steps.length > 8) {
      throw new Error(`${r.slug}: ${r.farm_steps.length} farm steps, want 6..8`);
    }
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) throw new Error(`${r.slug}: farm step of ${len} chars, want 20..600`);
    }
  }

  // The trading comparison set: protocols whose token already trades, with
  // the multiple the anchors learned from. Shown on the page's second view,
  // never ranked on the board.
  const trading = snap.protocols
    .filter((p) => tokenStatus(p) === 'trading')
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      family: familyOf(p.category),
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: roundTo(p.mcap_usd! / p.tvl_usd, 4),
    }));

  const anchorsData = {
    global: {
      n: anchors.globalN,
      median_log: roundTo(anchors.globalLog, 6),
      value: roundTo(Math.exp(anchors.globalLog), 4),
    },
    families: Object.fromEntries([...anchors.families.entries()].map(([name, f]) => [name, {
      n: f.n,
      median_log: f.medianLog === null ? null : roundTo(f.medianLog, 6),
      anchor: roundTo(f.anchor, 4),
    }])),
    categories: Object.fromEntries([...anchors.categories.entries()].map(([name, c]) => [name, {
      family: c.family,
      n: c.n,
      median_log: c.medianLog === null ? null : roundTo(c.medianLog, 6),
      anchor: roundTo(c.anchor, 4),
    }])),
    // Every candidate sample, used or dropped, so the page can show its
    // working: which trading multiples taught the anchors, which were
    // excluded as outliers or too small, and what each one weighs.
    samples: anchors.samples.map((s) => ({
      slug: s.slug,
      name: s.name,
      category: s.category,
      family: s.family,
      tvl_usd: s.tvl_usd,
      mcap_usd: s.mcap_usd,
      ratio: roundTo(s.ratio, 4),
      used: s.used,
      drop_reason: s.dropReason,
      weight_cat: roundTo(s.weightCat, 4),
      weight_fam: roundTo(s.weightFam, 4),
    })),
    dropped: {
      total: anchors.droppedCount,
      ratio_outside: anchors.samples.filter((s) => s.dropReason === 'ratio-outside').length,
      tvl_below_min: anchors.samples.filter((s) => s.dropReason === 'tvl-below-min').length,
    },
  };

  const radar = {
    meta: {
      as_of: snap.as_of,
      source: snap.source,
      floor_usd: snap.floor_usd,
      protocol_count: snap.protocols.length,
      board_count: rows.length,
      watchlist_count: watchlist.size,
      watchlist_covered: covered,
      early_count: rows.filter((r) => r.tier === 'early').length,
      trading_count: trading.length,
    },
    params: {
      shrink_k: 4,
      anchor_sample: { ratio_min: RATIO_MIN, ratio_max: RATIO_MAX, min_tvl_usd: ANCHOR_MIN_TVL },
      anchor_clamp: [0.02, 1.5],
      gas_usd: GAS_USD,
      gas_default_usd: GAS_DEFAULT,
      airdrop_share: AIRDROP_SHARE,
      family_of_category: FAMILY_OF_CATEGORY,
    },
    anchors: anchorsData,
    rows,
    trading,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows }, null, 1) + '\n');
  writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(radar, null, 1)};\n`);
  copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
  if (existsSync(join(here, 'screenshots'))) {
    copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
  }
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(`board: ${rows.length} rows, watchlist ${covered}/${watchlist.size}, dossier ${dossier.length} bytes`);
}

main();
