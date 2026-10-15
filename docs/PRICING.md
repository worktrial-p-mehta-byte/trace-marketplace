# Pricing

Each trace is priced from its traits with an explainable formula:

```
P = clamp( B_tier × min(cap, Q × R × F × X × D × T) × L , floor, ceiling )
```

| Factor          | Traits used                                       | Default rule                                                                |
| --------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| B base          | Sharing tier                                      | Tier 1 $0.25, tier 0 $2.00                                                  |
| Q quality       | Redaction density, truncation, verifiable outcome | −0.3 if >20% redacted, −0.2 if truncated, +0.1 if tests ran at end; 0.5–1.2 |
| R richness      | Turns, tool calls                                 | 1 + 0.4 × log2(1 + turns/20), max 2                                         |
| F failure value | Errors, recovery, preference pairs                | none 1.0, failure 1.4, recovery 1.8, +0.1 per pair up to +0.4               |
| X rarity        | Language, framework, failure category, model      | √(median combo count / combo count), 0.5–3                                  |
| D demand        | Searches, saves, bounties in last 14 days         | 1 + 0.5 × signals/supply, 0.8–2, ≤20%/day change                            |
| T freshness     | Age, model deprecation                            | 0.5^(days/90), floor 0.4, ×0.7 if deprecated                                |
| L license       | Chosen at quote                                   | research 1.0, eval 1.5, training 2.0                                        |

Defaults: multiplier cap 12×, floor $0.10, ceiling $50, seller share 70%.

## Worked examples (from the tests)

| Factor                  | Everyday TypeScript/React trace       | Rare Rust/Tokio near-miss                                                             |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| Traits                  | 18 turns, one tool error, 30 days old | 64 turns, retry loop then recovery, 2 preference pairs, tests ran at end, 12 days old |
| Market                  | combo seen 120× vs median 40×         | combo seen 6× vs median 40×, open bounty (pressure 0.4)                               |
| Q · R · F               | 1.00 · 1.37 · 1.40                    | 1.10 · 1.83 · 2.00                                                                    |
| X · D · T               | 0.58 · 1.00 · 0.79                    | 2.58 · 1.20 · 0.91                                                                    |
| Multiplier              | 0.88                                  | 11.36 (under the 12× cap)                                                             |
| Price, research license | **$1.76**                             | **$22.72**                                                                            |

## How it is wired

- `packages/pricing` (browser-safe): factor functions, `traitPolicyV1`,
  demand matching and `splitSale`. Every quote carries `drivers`: one plain
  reason per factor (e.g. "Rust + retry_loop: seen 6× (typical 40×)") and a
  one-line summary, for the "why this price" view.
- `packages/core/src/pricing`: builds the market from the database and
  reprices listings.
  - **Rarity** counts distinct content per combination
    (`language|framework|failure|model`), so re-uploading the same trace
    creates neither scarcity nor volume.
  - **Demand**: each signal (search, save, bounty) in the last 14 days adds
    `weight ÷ listings it matches`, so a bounty for a rare combination moves
    those few prices a lot. Signals with no criteria are ignored.
  - **Daily limit**: demand moves at most ±20% against the newest snapshot
    that is at least 24 hours old.
  - `repriceAll` writes a `price_snapshots` row and updates the listing when
    a price changes, then emits `price.updated`. `quoteListing` prices under a
    license without writing. `priceHistory` feeds the price chart.
  - `runPricingConsumer` reprices once per batch of `trace.ingested`,
    `listing.created`, `listing.delisted`, `consent.revoked`,
    `demand.signaled` and `bounty.posted` events.
  - **Time**: freshness decays and demand ages out of its window with no
    event at all, so prices are also refreshed when the last full reprice is
    older than `pricing.refreshIntervalMinutes` (60). The consumer does this
    when it finds no new events; the catalog, viewer and market pages run the
    consumer on load; `pnpm reprice` forces it (for cron).
  - Sharing commits its outbox events with the listing. If pricing fails
    straight after, the upload still succeeds ("price pending") and the next
    consumer run prices it.

Known limits are tracked in [LIMITATIONS.md](LIMITATIONS.md).
All of these are configurable: see [config/README.md](../config/README.md) and
`packages/config/src/defaults.ts`. The weights are starting guesses, not market
data; a learned model replaces them once there are real sales.
