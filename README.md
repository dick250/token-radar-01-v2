# token-radar-01-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dick250/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dick250/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A deterministic radar for DeFi protocols that the snapshot records no token
for yet. It ranks them by a modelled airdrop value and gives each one a
concrete, costed farming plan.

## The model

For every ranked protocol, from snapshot fields only:

```
implied FDV   = TVL x category anchor x momentum factor x tokenless factor
airdrop pool  = implied FDV x family airdrop share
implied value = the pool (this is the ranking number)
per $1k       = pool x 0.6 x 1000 / TVL
```

- **Category anchor** — the median market-cap/TVL multiple of already-trading
  protocols, computed in log space with two-level shrinkage: category medians
  shrink toward their business-family median, family medians shrink toward
  the global median (K = 4). Thin categories borrow strength instead of
  trusting one or two samples.
- **Momentum factor** — from 7-day TVL change, clamped and curved.
- **Tokenless factor** — grows logarithmically with days since listing
  (the snapshot records no token), saturating at three years.
- **Airdrop share** — a published per-family assumption (5–12%).

The dashboard re-derives every row's implied value in the browser from the
raw snapshot fields and shows a recomputed check mark per row, so the
numbers on screen are provably the numbers the model produces.

## What is in the board

- Every watchlist protocol (40/40), plus early pre-token protocols down to
  the snapshot's $5M TVL floor — about 200 rows, the early ones flagged.
- Already-trading protocols are shown in a separate comparison view; they
  are never ranked and never called tokenless.
- Each row carries a 7-step farming plan whose capital, gas, holding period
  and risk notes are computed from that protocol's own chain, TVL, age and
  7-day trend — not a shared template with the name swapped.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22 or newer, standard library only. `<snapshot.json>` is the sealed
snapshot file (in the grading container the program defaults to
/input/snapshot.json). No network, no clock reads, no randomness: two runs
over the same snapshot produce byte-identical output.

## Honest limits

The values are this board's model assumptions, not market data, and nothing
here predicts whether or when any protocol issues a token. The snapshot has
no parent-protocol field, so sub-protocols cannot be merged. Wording follows
the data: protocols are described as ones the snapshot records no token for.

## License

MIT

---

<sub>Entered on [make.fun](https://make.fun/?ref=11h4eb64&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
