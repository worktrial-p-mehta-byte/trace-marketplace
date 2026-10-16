# Seller demo sessions

Ten synthetic Claude Code sessions, each built to show off one dimension of
the pricing engine when you share it from **Share sessions**. They are in
Claude Code's own `.jsonl` format, so they go through the real parser,
scrubber and labeler, exactly like a seller's own sessions.

```bash
pnpm demo:reset       # a fresh seeded market to price against
pnpm demo:sessions    # writes the .jsonl files here and prints each one's estimate
```

The files are generated, not committed: their timestamps are relative to now
(freshness is a pricing factor), and the leaky session contains fake
credentials. All content is invented.

## The price formula, in one line

**price = base × quality × richness × failure × rarity × demand × freshness × license**

Base is $2.00 for open source and $0.25 for signals only. See
[docs/PRICING.md](../../docs/PRICING.md) for every weight.

## What each session shows

Approximate open-source prices against a fresh `pnpm demo:reset` market.

| File                     | Dimension                  | What to point at                                                                                                            | Factor                                               | Price            |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------- |
| `01-everyday-baseline`   | Baseline                   | Short, clean TypeScript/React work. The stack is crowded, so rarity pulls it down                                           | Rarity 0.5×                                          | ~$1.27           |
| `02-failure-recovered`   | Failure                    | The agent re-runs a failing test four times (retry loop), then finds the real cause; tests pass                             | Failure 1.8×, quality 1.1×                           | ~$5.35           |
| `03-preference-pairs`    | Failure + preference pairs | The agent tries to weaken the test twice (rejected) and is corrected twice. Each "no, do this instead" is a preference pair | Failure 2.2× (maximum)                               | ~$6.83           |
| `04a-rarity-common`      | Rarity                     | A date-picker bug in TypeScript/React. The market already has many like it                                                  | Rarity 0.5×                                          | ~$2.44           |
| `04b-rarity-rare`        | Rarity                     | The same story in Verilog. Everything else is identical, and the price doubles                                              | Rarity 1.0×                                          | ~$4.88           |
| `05-richness-marathon`   | Richness                   | 100+ turns moving 22 Go handlers onto new middleware, no failures                                                           | Richness 2.0× (maximum)                              | ~$4.39           |
| `06-freshness-old-model` | Freshness                  | Session 02's story, but 11 months old and on a superseded model                                                             | Freshness 0.28×                                      | ~$1.51           |
| `07-quality-leaky`       | Quality                    | Keys, emails, IPs and a home path everywhere (watch the black bars), plus a log too long to keep whole                      | Quality 0.5× ("76% redacted, some output truncated") | ~$1.21           |
| `08-demand-bounty`       | Demand                     | A Rust retry loop: nobody has listed one yet. Post a bounty for it (below) and watch the estimate double                    | Demand 1.0× → 2.0×                                   | ~$5.17 → ~$10.34 |
| `09-everything`          | Everything at once         | Rare stack (Haskell), test tampering caught, five corrections, recovered, 90+ turns, fresh                                  | Failure 2.2×, richness 2.0×, quality 1.1×            | ~$9.73           |

Sessions start as **Signals only** on the review screen. Switch one to
**Open source** to show the base price change: 8× more, because buyers get
the content.

## A five-minute pricing walkthrough

1. **Load them all.** Sign up as a seller, open **Share sessions**, choose
   all ten files. Each one shows its estimate in the list on the left.
2. **Read a breakdown.** Click `09-everything` ("Fix the pricing engine's
   rounding…"). Each factor has a plain reason: "agent tampered with a
   failing test, then recovered; 5 preference pairs", "92 turns, 51 tool
   calls", "outcome checked by tests".
3. **Tier.** Toggle **Signals only** / **Open source** on any session. The
   base price moves from $0.25 to $2.00.
4. **Rarity.** Compare `04a` (date picker, TypeScript/React) with `04b`
   (UART receiver, Verilog): the same story, double the price.
5. **Freshness.** Compare `02` with `06`: the same story. 06 is 330 days old
   on `claude-3-5-sonnet-20241022`, so its price is about a quarter of 02's.
6. **Quality.** Open `07`. The scrubber removed 800 items, and the estimate
   says why the price dropped.
7. **Demand, live.** Select `08` ("Stop the job queue retrying forever") and
   note its price. In another tab, sign in as `buyer@example.com`, open
   **Market** → language _Rust_, failure _Retry loop_ → **Post bounty**.
   Back on the share tab, toggle `08`'s tier off and on to re-estimate:
   demand goes from 1.0× to 2.0× and the price doubles.
8. **License.** Share `09` as open source (tick the two boxes), then open it
   from **Browse traces**. The price card's Research / Evaluation / Training
   switch applies the license multiplier (1×, 1.5×, 2×).

## Notes

- **Rarity can lower a price but not raise it in the seeded market.** Most
  combinations of language, framework, failure and model appear once, so the
  typical count is 1. A rare session therefore scores 1.0×, and only crowded
  ones fall (to 0.5×). The 3× rarity bonus is unreachable until the market
  has more repeat combinations. Rarity is still visible as the 04a/04b
  contrast.
- **The price cap and limits** (12× combined multiplier, $0.10–$50) aren't
  reached by these sessions. The highest, `09` with a bounty for Haskell,
  stays under them.
- Prices drift a little with time since seeding (freshness, demand window).
  Run `pnpm demo:sessions` again to see current estimates.
