// Farm plans. Every plan is assembled from the row's own numbers — its main
// chain's gas price, a capital size scaled to its TVL, a hold period scaled
// to its age — so two rows never read alike unless the rows themselves do.
// Each step carries structured fields (action, cost, capital, time, risk)
// for the dashboard, and is also rendered as one English sentence for the
// board's farm_steps, in the shape the gate counts: 20 to 600 characters.

import { clamp, type BoardRowCore } from './model.ts';

export interface PlanStep {
  n: number;
  action: string;
  cost_usd: number;
  capital_usd: number;
  time: string;
  risk: string;
  // True when this step's gas comes from a chain the gas table does not
  // name, so the figure is the board's default assumption, not a per-chain
  // estimate. The board's step text says so where it applies.
  gas_default?: boolean;
}

export interface Plan {
  steps: PlanStep[];
  capital_usd: number;   // headline suggested position
  hold_days: number;
  total_cost_usd: number; // gas and fees plus a 5%/yr opportunity cost
  total_gas_usd: number;  // the gas part of the total cost alone
  active_minutes: number; // hands-on time across the steps, roughly
  expected_usd: number;   // capital/1000 x per_1k, under the board's model
  ev_ratio: number;       // expected / total cost, under the board's model
  priority: boolean;      // ev_ratio >= 3: the board flags the row
}

// One ordinary interaction's gas, in dollars, by chain. A stated assumption
// of this board, printed on the page; chains not listed use the default.
export const GAS_USD: Readonly<Record<string, number>> = {
  'Ethereum': 4.00,
  'Bitcoin': 3.00,
  'Tron': 1.00,
  'Binance': 0.10,
  'Arbitrum': 0.05,
  'Base': 0.05,
  'Optimism': 0.05,
  'Polygon': 0.05,
  'Unichain': 0.05,
  'Linea': 0.05,
  'Scroll': 0.05,
  'zkSync Era': 0.05,
  'Solana': 0.02,
  'Hyperliquid L1': 0.02,
  'Monad': 0.02,
  'Sui': 0.02,
  'Aptos': 0.02,
  'Plasma': 0.02,
  'Berachain': 0.02,
  'Avalanche': 0.02,
  'Sonic': 0.02,
};
export const GAS_DEFAULT = 0.20;

export function gasFor(chain: string): number {
  return GAS_USD[chain] ?? GAS_DEFAULT;
}

// True when the chain is not in the table and its gas is the default.
export function gasIsDefault(chain: string): boolean {
  return !(chain in GAS_USD);
}

const NICE_TIERS = [200, 500, 1000, 2000, 5000, 10000];

// Suggested position: grows with the square root of TVL (a bigger protocol
// has more farmers to share with), snapped to a round tier and clamped.
export function capitalFor(tvlUsd: number): number {
  const raw = 2000 * Math.sqrt(tvlUsd / 1e8);
  let best = NICE_TIERS[0]!;
  for (const tier of NICE_TIERS) {
    if (Math.abs(tier - raw) < Math.abs(best - raw)) best = tier;
  }
  return clamp(best, 200, 10000);
}

export function holdDaysFor(ageDays: number): number {
  return ageDays < 180 ? 45 : 30;
}

export function fmtUsd(x: number): string {
  const rounded = Math.round(x);
  return '$' + String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtGas(x: number): string {
  return '$' + x.toFixed(2);
}

interface Ctx {
  name: string;
  family: string;
  chain: string;
  chain2: string | null;
  gas: number;
  gas2: number;
  capital: number;
  tvl: number;
  age: number;
  hold: number;
  change7d: number | null;
  nChains: number;
}

function step(n: number, action: string, cost: number, capital: number, time: string, risk: string): PlanStep {
  return { n, action, cost_usd: Math.round(cost * 100) / 100, capital_usd: capital, time, risk };
}

// Step 1 is shared by every family: a dedicated wallet, funded once.
function walletStep(c: Ctx): PlanStep {
  const kyc = c.family === 'rwa' ? ' This family often asks for KYC before any deposit; expect that at step 2.' : '';
  return step(1,
    `Create a fresh wallet for ${c.name} alone, fund it with gas on ${c.chain} from your main wallet, and keep the seed phrase offline on paper.${kyc}`,
    c.gas, 0, '10 min', 'Setup only; no protocol exposure yet.');
}

// Step 5 for multi-chain protocols: a footprint on a second chain.
function secondChainStep(c: Ctx): PlanStep {
  return step(5,
    `Repeat a small version of the core action on ${c.chain2}, the second of its ${c.nChains} chains, so the wallet shows multi-chain use rather than a single landing.`,
    c.gas2, Math.round(c.capital / 4), '15 min', 'Small size only; the main position stays on the main chain.');
}

// Step 6: the hold. Its wording follows the row: the check-in cadence
// follows the position size, and the 7-day move — up, drifting or falling
// hard — each earns its own sentence rather than one shared paragraph.
function holdStep(c: Ctx): PlanStep {
  const cadence = c.capital >= 5000 ? 'twice a week' : 'once a week';
  let action = `Hold the position for ${c.hold} days, checking in ${cadence} and claiming any points or rewards the protocol shows as they appear.`;
  let risk = 'Smart-contract risk for the whole hold; never add funds you cannot leave locked for the full period.';
  if (c.age < 180) {
    action += ` ${c.name} has only run ${c.age} days in the snapshot, so re-read its points or rewards rules at every weekly check; young protocols change them often.`;
  }
  if (c.change7d !== null && c.change7d > 10) {
    action += ` Its TVL grew ${c.change7d.toFixed(1)}% in the last 7 days, so expect more farmers competing for the same rewards; that is a reason to be in at this size now, not to arrive larger later.`;
  } else if (c.change7d !== null && c.change7d < 0 && c.change7d >= -10) {
    action += ` Its TVL slipped ${Math.abs(c.change7d).toFixed(1)}% this week, which is noise at this size rather than a signal; the plan changes only if the exit rule triggers.`;
  }
  if (c.change7d !== null && c.change7d < -10) {
    risk = `Its TVL fell ${Math.abs(c.change7d).toFixed(1)}% in the last 7 days: start at half size and only top up once the outflow stops. ` + risk;
  }
  return step(6, action, 0, 0, `${c.hold} days`, risk);
}

// Step 7: the record and the exit rule. How the unwind is done follows the
// position size, and a still-falling TVL at the end closes the door on
// waiting for a recovery.
function exitStep(c: Ctx): PlanStep {
  let action = `Log the wallet address and every transaction hash in a sheet from day one. Exit rule: unwind after ${c.hold} days, or at once if the team announces a snapshot or the position's terms change.`;
  if (c.capital >= 5000) {
    action += ' At this size, unwind in two tranches on separate days rather than in a single transaction.';
  } else if (c.capital <= 500) {
    action += ' At this size, unwind in a single transaction; speed beats squeezing the price.';
  }
  if (c.change7d !== null && c.change7d < -10) {
    action += ' If TVL is still falling when the hold ends, leave on schedule — do not wait for a recovery the exit rule never promised.';
  }
  return step(7, action, c.gas, 0, '15 min',
    'The exit rule matters more than any single number in this plan; a position held past its rule is a new, unplanned position.');
}

// Step 8: the plan's own arithmetic, and its verdict. Every plan closes
// with its totals — capital, gas, hands-on time, hold — and what the
// board's model says they buy. A row whose expectation does not cover its
// cost is told so here, in its last step, and its size has already been
// cut to the minimum tier by buildPlan.
function summaryStep(
  c: Ctx,
  t: { gasTotal: number; totalCost: number; expected: number; ratio: number; active: number; stepCount: number },
): PlanStep {
  // Small amounts keep their cents: on a two-cent-gas chain a whole plan's
  // gas rounds to $0 in whole dollars, which would read as free.
  const amt = (x: number) => (x < 10 ? '$' + x.toFixed(2) : fmtUsd(x));
  const expected = t.expected < 1 ? 'under $1' : amt(t.expected);
  const ratio = t.ratio < 0.1 ? t.ratio.toFixed(2) : t.ratio.toFixed(1);
  let verdict: string;
  if (t.ratio < 1) {
    verdict = `On this board's own model that does not pay: run only steps 1–3 at this minimum size, as a cheap option on the model being wrong, or keep ${c.name} on a watchlist and farm a better-paying row instead.`;
  } else if (t.ratio >= 3) {
    verdict = 'That makes this a priority row on this board: if you farm one new position this week, this is the one to start with.';
  } else {
    verdict = 'Positive on the model\'s own terms; the size is set by the protocol\'s TVL, not by enthusiasm.';
  }
  return step(8,
    `Plan totals for ${c.name}: ${fmtUsd(c.capital)} of capital, ${amt(t.gasTotal)} of gas across ${t.stepCount} steps, roughly ${t.active} minutes of hands-on time over a ${c.hold}-day hold. All-in cost ${amt(t.totalCost)} against a model expectation of ${expected}, an EV/cost of ${ratio}x. ${verdict}`,
    0, 0, `${c.hold} days`, 'The expectation is this board\'s model claim, not a promise; the totals are the plan\'s own arithmetic.');
}

// Rough hands-on minutes across a plan's steps: the stated minutes, with
// weekly chores counted four times over a hold, and a two-week spread of
// small interactions counted once. Hold durations are not hands-on time.
export function activeMinutesOf(steps: PlanStep[]): number {
  let total = 0;
  for (const s of steps) {
    const m = /^(\d+)\s*min/.exec(s.time);
    if (m) {
      total += Number(m[1]) * (s.time.includes('weekly') ? 4 : 1);
    } else if (s.time === '2 weeks') {
      total += 20;
    }
  }
  return total;
}

type CoreBuilder = (c: Ctx) => PlanStep[];

const CORE: Record<string, CoreBuilder> = {
  capital: (c) => [
    step(2, `Supply ${fmtUsd(c.capital)} of stablecoins to a ${c.name} curated vault on ${c.chain} and confirm the vault share token lands in your wallet.`,
      c.gas, c.capital, '15 min', 'Curator strategy loss: your money follows the curator\'s lending choices, good and bad.'),
    step(3, `Record your share balance and the vault's current APY in your tracking sheet, and check the curator's announcement channel for strategy changes.`,
      0, 0, '5 min', 'Low; a bookkeeping step that the later steps rely on.'),
    step(4, `In week two, add a second deposit of ${fmtUsd(Math.round(c.capital / 4))} if the vault still beats plain stablecoin lending by two points or more; if it does not, leave the size as it is.`,
      c.gas, Math.round(c.capital / 4), '10 min', 'Do not chase a falling APY with fresh money.'),
  ],
  dex: (c) => [
    step(2, `Swap ${fmtUsd(Math.round(c.capital / 2))} across two liquid pairs on ${c.name} (${c.chain}) — a stablecoin into the chain's main asset and back — to open a genuine volume record.`,
      c.gas * 3, 0, '15 min', 'Slippage and price movement between the two legs; keep each swap small.'),
    step(3, `Open a concentrated liquidity range on its busiest pair with ${fmtUsd(c.capital)}, wide enough to survive a 10% move without daily attention.`,
      c.gas, c.capital, '20 min', 'Impermanent loss if the pair trends; a wide range earns less but survives longer.'),
    step(4, `Rebalance the range once a week, collect the fees into the same position, and write the fee income into your sheet so the real yield is visible.`,
      c.gas, 0, '10 min weekly', 'A range left out of bounds earns nothing; the weekly check is the plan, not an extra.'),
  ],
  derivs: (c) => [
    step(2, `Deposit ${fmtUsd(c.capital)} as margin on ${c.name} (${c.chain}) and confirm the balance shows in the account before placing any trade.`,
      c.gas, c.capital, '10 min', 'Margin is exposed from this moment; a venue failure strands it.'),
    step(3, `Once a week, open and close one small trade at no more than 2x leverage, about ${fmtUsd(c.capital * 2)} of notional, to build a real volume record; set a stop on every position.`,
      c.gas * 2, 0, '15 min weekly', 'Leverage cuts both ways even at 2x; the stop is not optional.'),
    step(4, `Park ${fmtUsd(Math.round(c.capital / 2))} in the platform's LP or vault side if it offers one, so part of the capital earns fees while the rest trades.`,
      c.gas, Math.round(c.capital / 2), '10 min', 'Vault shares can carry the traders\' losses; read its terms before depositing.'),
  ],
  credit: (c) => [
    step(2, `Supply ${fmtUsd(c.capital)} of collateral — a stablecoin or the chain's main asset — to ${c.name} on ${c.chain} and confirm it counts toward your borrow limit.`,
      c.gas, c.capital, '15 min', 'Collateral is locked until the loan is repaid; a sharp drop can liquidate it.'),
    step(3, `Borrow against it at no more than 30% loan-to-value, about ${fmtUsd(Math.round(c.capital * 0.3))}, so one complete borrow cycle is on record.`,
      c.gas, 0, '10 min', 'Keep the health factor above 2; a thin buffer is how positions die.'),
    step(4, `After a week, repay part of the loan and borrow once more, completing a second cycle, then let the position rest.`,
      c.gas * 2, 0, '10 min', 'Interest accrues the whole time; two cycles are evidence enough, do not churn.'),
  ],
  rwa: (c) => [
    step(2, `Complete the whitelist or KYC flow ${c.name} requires and confirm your country is eligible before sending any funds; some issuers in this family restrict by residence.`,
      0, 0, '30 min', 'Your identity documents go to the issuer; use a provider you can verify.'),
    step(3, `Subscribe the minimum practical ticket of ${fmtUsd(c.capital)} on ${c.chain} and wait for the position token or account balance to settle.`,
      c.gas, c.capital, '20 min', 'Settlement can take days; the funds are committed from subscription, not from settlement.'),
    step(4, `Hold through one full yield period and record the first distribution when it lands, with its date and amount, in your sheet.`,
      0, 0, 'One yield period', 'Yield is a claim on the issuer, not on a chain; missed payments are the risk.'),
  ],
  btc: (c) => [
    step(2, `Bridge ${fmtUsd(c.capital)} worth of BTC or a BTC derivative to ${c.chain} by the route ${c.name} documents; bridge fees and the wait dominate this step.`,
      c.gas * 2, c.capital, '30 min', 'Bridge contract risk is the largest single risk in this plan; never bridge a test amount larger than needed.'),
    step(3, `Deposit the bridged asset into the ${c.name} pool on ${c.chain} and keep the receipt token in the same wallet.`,
      c.gas, 0, '10 min', 'The receipt token is your only claim; losing the wallet loses both layers.'),
    step(4, `Put the receipt token to work in one downstream protocol — lend it or pair it — so the same capital is visible in two places at once.`,
      c.gas, 0, '15 min', 'A second protocol doubles the contract surface; pick the most established one available.'),
  ],
  infra: (c) => [
    step(2, `Bridge a small amount, ${fmtUsd(Math.round(c.capital / 4))}, to ${c.chain}: for ${c.name} the chain itself is the product, so ordinary activity on it is the signal being farmed.`,
      c.gas, Math.round(c.capital / 4), '15 min', 'Bridge risk on a small amount; size comes later if the chain proves sticky.'),
    step(3, `Make five interactions with five different apps on the chain across two weeks — a swap, a lend, a mint, a bridge-out and one more of your choice.`,
      c.gas * 5, 0, '2 weeks', 'Bursts in one day read as farmed; spread the five out.'),
    step(4, `If the chain offers native staking or validator delegation, delegate ${fmtUsd(Math.round(c.capital / 2))} and leave it for the full hold.`,
      c.gas, Math.round(c.capital / 2), '10 min', 'Delegation usually carries an unbonding period; note its length before delegating.'),
  ],
  other: (c) => [
    step(2, `Use ${c.name}'s core function once, end to end, on ${c.chain} with ${fmtUsd(c.capital)}: whatever its main action is, complete it rather than only depositing and stopping.`,
      c.gas, c.capital, '20 min', 'An unfamiliar product hides its risks in its main action; go slowly the first time.'),
    step(3, `Repeat the core action a week later with a smaller amount, ${fmtUsd(Math.round(c.capital / 4))}, so the record shows a returning user rather than a single visit.`,
      c.gas, 0, '15 min', 'Low; the second pass is evidence, not investment.'),
    step(4, `Open the project's own dashboard or points page if it has one, connect this wallet, and confirm your activity is actually recorded there.`,
      0, 0, '5 min', 'Activity the project cannot see earns nothing; this check is the plan\'s receipt.'),
  ],
};

// Step 5 when there is no second chain worth showing: deepen the first
// one. Each family gets a real second action of its own — a second vault,
// pair, market or product — with the risk that action actually carries,
// never a filler step.
function deepenStep(c: Ctx): PlanStep {
  const byFamily: Record<string, { action: string; risk: string }> = {
    capital: {
      action: `Move ${fmtUsd(Math.round(c.capital / 4))} into a second vault of ${c.name} with a different curator or strategy, so one curator's bad week cannot take the whole position.`,
      risk: 'A second curator diversifies strategy, not safety; read its lending choices before funding it.',
    },
    dex: {
      action: `Add a second, smaller range on the next-busiest pair with ${fmtUsd(Math.round(c.capital / 4))}, so the record covers more than one market.`,
      risk: 'Two ranges drift out of bounds independently; the weekly rebalance now covers both.',
    },
    derivs: {
      action: `Repeat the weekly trade on a second market ${c.name} lists, at the same small size, so the volume record is not one pair deep.`,
      risk: 'Two markets can gap together in a stress move; the same stop rule applies to each.',
    },
    credit: {
      action: `Set a liquidation-price alert at 60% of your collateral's current value and test that it fires; an alert you have not tested is a hope, not a plan.`,
      risk: 'The untested alert is the risk here; if it does not fire, fix it before adding any size.',
    },
    rwa: {
      action: `If a second product from the same issuer is open, split ${fmtUsd(Math.round(c.capital / 4))} into it; if none is, diarise the next subscription window instead.`,
      risk: 'A second product from one issuer concentrates issuer risk rather than spreading it.',
    },
    btc: {
      action: `Claim any points or receipts the pool issues and restake them into the same position, so the record compounds instead of idling.`,
      risk: 'Restaked receipts inherit both layers\' risks; a pause in either layer stops the compounding.',
    },
    infra: {
      action: `Return once a week for four weeks with one fresh interaction each time; steady use over a month outweighs any single busy day.`,
      risk: 'The activity must stay genuine use; empty transactions read as farming and can be filtered out.',
    },
    other: {
      action: `Try one advanced feature of ${c.name} beyond its core action — a setting, a second mode, a governance page — so the record shows exploration, not repetition.`,
      risk: 'Advanced features are the least documented part of most products; use the smallest size that works.',
    },
  };
  const entry = byFamily[c.family] ?? byFamily['other']!;
  return step(5, entry.action, c.gas, Math.round(c.capital / 4), '15 min', entry.risk);
}

export function buildPlan(row: BoardRowCore): Plan {
  const p = row.protocol;
  const chain = p.chains[0] ?? 'Ethereum';
  const chain2 = p.chains.length >= 2 ? p.chains[1]! : null;
  const hold = holdDaysFor(row.ageDays);
  const multiChain = p.chains.length >= 3 && chain2 !== null;

  const makeCtx = (capital: number): Ctx => ({
    name: p.name,
    family: row.family,
    chain,
    chain2,
    gas: gasFor(chain),
    gas2: chain2 ? gasFor(chain2) : 0,
    capital,
    tvl: p.tvl_usd,
    age: row.ageDays,
    hold,
    change7d: p.change_7d,
    nChains: p.chains.length,
  });

  // Steps 1–6 for a given position size: wallet, the family's three core
  // actions, a second chain or a deeper second action, and the hold.
  const assemble = (c: Ctx): PlanStep[] => {
    const core = (CORE[row.family] ?? CORE['other']!)(c);
    if (p.tvl_usd < 20_000_000 && core[0]) {
      core[0] = { ...core[0], risk: core[0].risk + ' Small protocol: keep this position under 2% of your total farming budget.' };
    }
    const step5 = multiChain ? secondChainStep(c) : deepenStep(c);
    return [walletStep(c), ...core, step5, holdStep(c)];
  };

  const totalsFor = (c: Ctx, steps: PlanStep[]) => {
    const gasTotal = Math.round((steps.reduce((s, x) => s + x.cost_usd, 0) + c.gas) * 100) / 100; // + exit gas
    const opportunity = c.capital * 0.05 * (hold / 365);
    const totalCost = Math.round((gasTotal + opportunity) * 100) / 100;
    const expected = Math.round((c.capital / 1000) * row.per1k);
    return { gasTotal, totalCost, expected, ratio: totalCost > 0 ? expected / totalCost : 0 };
  };

  // First pass at the TVL-scaled size. If the model's expectation does not
  // cover the plan's cost, the plan is rebuilt once at the minimum size:
  // the board does not advise a full-size farm its own model calls a loss,
  // and the summary step of such a plan says exactly that.
  let capital = capitalFor(p.tvl_usd);
  let c = makeCtx(capital);
  let steps = assemble(c);
  let t = totalsFor(c, steps);
  if (t.ratio < 1 && capital > NICE_TIERS[0]!) {
    capital = NICE_TIERS[0]!;
    c = makeCtx(capital);
    steps = assemble(c);
    t = totalsFor(c, steps);
  }

  steps.push(exitStep(c));

  // Mark the steps whose gas is the board's default assumption (their
  // chain is not in the gas table), so the step text can say so.
  const isGasMultiple = (cost: number, g: number) =>
    cost > 0 && g > 0 && Math.abs(cost / g - Math.round(cost / g)) < 0.02;
  steps.forEach((s, i) => {
    if (i === 4 && multiChain) {
      if (gasIsDefault(chain2!) && isGasMultiple(s.cost_usd, c.gas2)) s.gas_default = true;
    } else if (gasIsDefault(chain) && isGasMultiple(s.cost_usd, c.gas)) {
      s.gas_default = true;
    }
  });

  const active = activeMinutesOf(steps);
  steps.push(summaryStep(c, { ...t, active, stepCount: steps.length + 1 }));
  return {
    steps,
    capital_usd: capital,
    hold_days: hold,
    total_cost_usd: t.totalCost,
    total_gas_usd: t.gasTotal,
    active_minutes: active,
    expected_usd: t.expected,
    ev_ratio: t.ratio,
    priority: t.ratio >= 3,
  };
}

// Render one structured step as the board's farm_steps sentence, in the
// shape: "Step 2 — <action>. Gas ≈ $0.05; capital $2,000; 15 min; risk: … ."
export function stepText(s: PlanStep): string {
  const tail = [`Gas ≈ ${fmtGas(s.cost_usd)}${s.gas_default ? ' (default assumption)' : ''}`];
  if (s.capital_usd > 0) tail.push(`capital ${fmtUsd(s.capital_usd)}`);
  tail.push(s.time);
  tail.push(`risk: ${s.risk.replace(/\.$/, '')}`);
  return `Step ${s.n} — ${s.action} ${tail.join('; ')}.`;
}
