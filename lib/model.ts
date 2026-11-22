// Value model for the pre-token radar.
//
// Everything here is derived from the snapshot's own ten fields per protocol
// plus the snapshot's as_of date and floor. No clock, no randomness, no
// network: the same input always produces the same board.
//
// The model, in one line:
//   implied = TVL x category anchor x momentum x tokenless x airdrop share
// where the anchor is a mcap/TVL multiple learned from protocols whose token
// already trades, shrunk in log space from category to family to global.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export type TokenStatus = 'pre-token' | 'trading' | 'token-recorded';

// Categories that are wrapped, staked, bridged or exchange products of a
// token that already trades. They are excluded both from the board and from
// the anchor sample, exactly as the snapshot's own watchlist rule draws it.
export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

// Business-model families. The grouping is by what a protocol does, never by
// its name; any category not listed here falls into "other".
export const FAMILY_OF_CATEGORY: Readonly<Record<string, string>> = {
  'Risk Curators': 'capital',
  'Onchain Capital Allocator': 'capital',
  'Yield': 'capital',
  'Yield Aggregator': 'capital',
  'Liquidity Manager': 'capital',
  'Leveraged Farming': 'capital',
  'Farm': 'capital',
  'Indexes': 'capital',
  'Dexs': 'dex',
  'Derivatives': 'derivs',
  'Options': 'derivs',
  'Interest Rate Derivatives': 'derivs',
  'Prediction Market': 'derivs',
  'Perps': 'derivs',
  'Lending': 'credit',
  'CDP': 'credit',
  'Uncollateralized Lending': 'credit',
  'Dual-Token Stablecoin': 'credit',
  'Stablecoin Wrapper': 'credit',
  'Algo-Stables': 'credit',
  'RWA': 'rwa',
  'CeDeFi': 'rwa',
  'Basis Trading': 'rwa',
  'Anchor BTC': 'btc',
  'Decentralized BTC': 'btc',
  'Restaking': 'btc',
  'Staking Pool': 'btc',
  'Chain': 'infra',
  'Cross Chain Bridge': 'infra',
  'Privacy': 'infra',
  'Services': 'infra',
  'Oracle': 'infra',
};

export const FAMILY_NAMES: readonly string[] = [
  'capital', 'dex', 'derivs', 'credit', 'rwa', 'btc', 'infra', 'other',
];

// Assumed share of an implied FDV that a launch would hand to its users, by
// family. A stated assumption of this board, in line with the 5-15% range
// historical DeFi launches have used; it is a knob, not a measurement.
export const AIRDROP_SHARE: Readonly<Record<string, number>> = {
  capital: 0.05,
  dex: 0.10,
  derivs: 0.12,
  credit: 0.08,
  rwa: 0.06,
  btc: 0.07,
  infra: 0.10,
  other: 0.08,
};

// Shrinkage strength: K pseudo-samples of the parent level stand against the
// level's own samples, so a category with K samples is believed half on its
// own evidence and half on its family's.
export const SHRINK_K = 4;

export function familyOf(category: string | null): string {
  if (category === null) return 'other';
  return FAMILY_OF_CATEGORY[category] ?? 'other';
}

export function tokenStatus(p: Protocol): TokenStatus {
  if (p.mcap_usd !== null && p.mcap_usd > 0) return 'trading';
  if (p.gecko_id === null && p.symbol === null) return 'pre-token';
  return 'token-recorded';
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

// Median with the even-count convention fixed once for the whole entry: the
// mean of the two middle values. Input is copied and sorted numerically.
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface CategoryAnchor {
  category: string;
  family: string;
  n: number;
  medianLog: number | null; // null when the category has no trading sample
  anchor: number;           // final multiple, clamped to [0.02, 1.5]
}

export interface FamilyAnchor {
  family: string;
  n: number;
  medianLog: number | null;
  anchor: number; // exp of the shrunk log anchor, unclamped
}

export interface Anchors {
  globalLog: number;
  globalN: number;
  families: Map<string, FamilyAnchor>;
  categories: Map<string, CategoryAnchor>;
}

// Build the two-level log-space shrinkage anchors from the trading sample:
// protocols whose token trades and whose category is not an excluded one.
// Each sample contributes ln(clamp(mcap / TVL, 0.005, 5)).
export function computeAnchors(protocols: Protocol[]): Anchors {
  const catLogs = new Map<string, number[]>();
  const famLogs = new Map<string, number[]>();
  const allLogs: number[] = [];
  for (const p of protocols) {
    if (tokenStatus(p) !== 'trading') continue;
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) continue;
    const log = Math.log(clamp(p.mcap_usd! / p.tvl_usd, 0.005, 5));
    const catKey = p.category ?? '(none)';
    if (!catLogs.has(catKey)) catLogs.set(catKey, []);
    catLogs.get(catKey)!.push(log);
    const fam = familyOf(p.category);
    if (!famLogs.has(fam)) famLogs.set(fam, []);
    famLogs.get(fam)!.push(log);
    allLogs.push(log);
  }
  const globalLog = median(allLogs);

  const families = new Map<string, FamilyAnchor>();
  for (const fam of FAMILY_NAMES) {
    const logs = famLogs.get(fam) ?? [];
    if (logs.length === 0) {
      families.set(fam, { family: fam, n: 0, medianLog: null, anchor: Math.exp(globalLog) });
    } else {
      const med = median(logs);
      const shrunk = (logs.length * med + SHRINK_K * globalLog) / (logs.length + SHRINK_K);
      families.set(fam, { family: fam, n: logs.length, medianLog: med, anchor: Math.exp(shrunk) });
    }
  }

  const categories = new Map<string, CategoryAnchor>();
  const catNames = new Set<string>();
  for (const p of protocols) catNames.add(p.category ?? '(none)');
  for (const cat of [...catNames].sort()) {
    const fam = cat === '(none)' ? 'other' : familyOf(cat === '(none)' ? null : cat);
    const famAnchor = families.get(fam)!;
    const famLog = famAnchor.n === 0 ? globalLog
      : (famAnchor.n * famAnchor.medianLog! + SHRINK_K * globalLog) / (famAnchor.n + SHRINK_K);
    const logs = catLogs.get(cat) ?? [];
    if (logs.length === 0) {
      categories.set(cat, {
        category: cat, family: fam, n: 0, medianLog: null,
        anchor: clamp(Math.exp(famLog), 0.02, 1.5),
      });
    } else {
      const med = median(logs);
      const shrunk = (logs.length * med + SHRINK_K * famLog) / (logs.length + SHRINK_K);
      categories.set(cat, {
        category: cat, family: fam, n: logs.length, medianLog: med,
        anchor: clamp(Math.exp(shrunk), 0.02, 1.5),
      });
    }
  }
  return { globalLog, globalN: allLogs.length, families, categories };
}

// Whole days between two UTC calendar dates given as YYYY-MM-DD.
export function daysBetween(fromDate: string, toDate: string): number {
  const parse = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((parse(toDate) - parse(fromDate)) / 86_400_000);
}

export interface AgeInfo { days: number; missing: boolean }

export function ageOf(p: Protocol, asOf: string): AgeInfo {
  if (p.listed_at === null) return { days: 180, missing: true };
  return { days: daysBetween(p.listed_at, asOf), missing: false };
}

// Momentum from the seven-day TVL change (the snapshot reports it in per
// cent). The change is clamped to +/-30% before the 1.5 power so one wild
// week cannot dominate a board; the factor itself is clamped to [0.6, 1.5].
// An unreported change is neutral, never a penalty.
export function momentumFactor(change7d: number | null): { factor: number; missing: boolean } {
  if (change7d === null) return { factor: 1, missing: true };
  const g = clamp(change7d / 100, -0.30, 0.30);
  return { factor: clamp(Math.pow(1 + g, 1.5), 0.60, 1.50), missing: false };
}

// Tokenless-duration factor: the longer a protocol has run without a token,
// the more of its use is real rather than mercenary, and the larger the user
// base a launch would reward. Log curve from 0.70 at birth to 1.15 at three
// years, saturating after that.
export function tokenlessFactor(ageDays: number): number {
  const t = Math.min(1, Math.log(1 + ageDays / 90) / Math.log(1 + 1095 / 90));
  return 0.70 + 0.45 * t;
}

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

// The board's admission rule: the watchlist's own rule with its $50M floor
// removed, so the early protocols below the floor are ranked too. The
// snapshot's watchlist itself is then unioned in unconditionally, as a belt
// over the braces: coverage of it is a gate requirement, not a hope.
export function admittedToBoard(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const ex of EXCHANGE_PREFIXES) if (p.name.startsWith(ex)) return false;
  return true;
}

export interface BoardRowCore {
  protocol: Protocol;
  family: string;
  anchor: number;
  nCat: number;
  nFam: number;
  momentum: number;
  tokenless: number;
  fdv: number;
  share: number;
  pool: number;
  implied: number;
  per1k: number;
  ageDays: number;
  gMissing: boolean;
  ageMissing: boolean;
  watchlist: boolean;
  tier: 'core' | 'early';
}

export function computeRow(
  p: Protocol,
  anchors: Anchors,
  asOf: string,
  watchlist: ReadonlySet<string>,
  floorUsd: number,
): BoardRowCore {
  const catKey = p.category ?? '(none)';
  const cat = anchors.categories.get(catKey)!;
  const fam = familyOf(p.category);
  const famAnchor = anchors.families.get(fam)!;
  const age = ageOf(p, asOf);
  const mom = momentumFactor(p.change_7d);
  const tok = tokenlessFactor(age.days);
  const fdv = p.tvl_usd * cat.anchor * mom.factor * tok;
  const share = AIRDROP_SHARE[fam]!;
  const pool = fdv * share;
  return {
    protocol: p,
    family: fam,
    anchor: cat.anchor,
    nCat: cat.n,
    nFam: famAnchor.n,
    momentum: mom.factor,
    tokenless: tok,
    fdv,
    share,
    pool,
    implied: Math.max(1, Math.round(pool)),
    per1k: (pool * 0.6 * 1000) / p.tvl_usd,
    ageDays: age.days,
    gMissing: mom.missing,
    ageMissing: age.missing,
    watchlist: watchlist.has(p.slug),
    tier: p.tvl_usd >= floorUsd ? 'core' : 'early',
  };
}

// Ranking: implied value descending, then TVL descending, then slug in
// code-point order. Ranks are 1..N with no gaps even when values tie.
export function rankRows(rows: BoardRowCore[]): BoardRowCore[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    if (b.protocol.tvl_usd !== a.protocol.tvl_usd) return b.protocol.tvl_usd - a.protocol.tvl_usd;
    const sa = a.protocol.slug, sb = b.protocol.slug;
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return sorted;
}

export function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
