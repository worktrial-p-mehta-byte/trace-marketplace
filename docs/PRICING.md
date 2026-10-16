# Pricing

Two policies sit behind the same `PricingPolicy` interface. **Pricing V2
(`trait-v2`) is the default**; v1 stays available as a fallback
(`pricing.policy` in config, or `PRICING_POLICY=trait-v1`). `pnpm
pricing:shadow` prices the live catalog under both without changing
anything, by domain, and runs both through the wind tunnel.

## Pricing V2

```
P = clamp( anchor( B × min(cap, Q × R × F × X × N × D × U × A × T) ) × L , floor, ceiling )
```

| Factor            | What it measures                                                                                                                                                                          | Default rule                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| B, Q, T, L        | As v1 (below)                                                                                                                                                                             |                                                                                                                                                     |
| R richness        | Information, not length: exact repeats of an earlier call count for little; each extra tool adds a little                                                                                 | 1 + 0.4 × log2(1 + turns × (1 − 0.8 × repeat share) / 20), × (1 + 0.04 per extra tool, ≤ +0.16), max 2                                              |
| F failure         | Failures tiered by evidence                                                                                                                                                               | none 1.0; unresolved 1.35; recovered (inferred from the finish) 1.6; recovered and the final check passes 1.9; +0.08 per preference pair, ≤ +0.32   |
| X rarity          | Scarcity, domain first. Cohorts: domain → domain+failure → +language/framework; each scored √((typical+α)/(count+α)) with typical = Σc²/Σc and α = 2; blended 0.5 / 0.3 / 0.2 (geometric) | Stack level only once the domain+failure cohort has ≥ 5 listings; the model's share within the domain moves it ±10%; 0.6–2.5                        |
| N niche           | The domain's demand against its supply, and the platform's strategic weight                                                                                                               | (demand share / supply share)^0.35, demand smoothed with a prior of 20 weight units spread like supply (no demand → 1); 0.85–1.6                    |
| D demand          | As v1, but each signal decays (half-life 7 days) and one buyer repeating the same ask counts log-wise                                                                                     | weight = max decayed weight × (1 + 0.5 × log2 n) per (buyer, kind, criteria)                                                                        |
| U near-duplicates | A seller listing the same session shape (tools, errors, length bucket; no text) again                                                                                                     | 1 / (1 + 0.5 × others), floor 0.4                                                                                                                   |
| anchor            | An open bounty this trace matches                                                                                                                                                         | Below 60% of the bounty's per-trace offer, the price is pulled up towards it, by at most 1.5×                                                       |
| A authenticity    | Authenticity tiers 1–2 (see ARCHITECTURE)                                                                                                                                                 | consistent 1.0, well-formed (or unchecked) 0.95, flagged 0.7; a signals-only domain claim's rarity and niche are raised to 0.75 (consistent) or 0.5 |
| band              | How sure the price is                                                                                                                                                                     | ±(8% + 12% × domain doubt + 8% if the domain+failure cohort is under 3 + 5% if signals-only), ≤ ±35%                                                |

All numbers live in `pricing.v2` in `packages/config/src/defaults.ts`.

**Platform levers** (config, off by default): `pricing.v2.niche.strategicWeights`
multiplies the niche factor for domains the marketplace wants more of (say
`{ "medical": 1.3 }`), and `revenue.sellerShareByDomain` sets a different
seller share per domain (default 70% everywhere).

**What it guarantees** (tests in `packages/pricing/src/pricing-v2.test.ts`):
more supply in a cohort never raises a price, more demand never lowers it,
older never raises it, verified recovery ≥ inferred ≥ unresolved,
near-duplicates and bounties move it the right way, every quote stays within
the floor and ceiling with its band around it (500 random cases), a rare
domain prices above a crowded one with the same traits, and without V2 market
data the policy prices exactly as v1.

**On the seeded demo market** (`pnpm pricing:shadow`, 200 sessions): coding
listings move to about 0.9× of v1, data and querying 1.5×, the long tail of
domains 2–5× (medical about 5×). The catalog's list value goes from about
$560 to $850.

### The wind tunnel

`runWindTunnel` (`packages/core/src/market/windtunnel.ts`) puts a modelled
population of 20 buyers in front of the catalog: each values a trace by its
failure evidence, information, freshness and the scarcity of its domain
(labs want diverse data), with log-normal noise, and licenses it when the
price is at or under their willingness to pay. Revenue is price × expected
buyers. It is a model of the agreed goal (total sales), not a forecast; on
the seeded market V2 makes about 40% more than v1 while selling slightly
fewer licenses (prices on scarce domains rise towards what buyers pay).

## Pricing v1

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

## Worked examples (v1, from the tests)

The landing page shows live examples instead: a typical listing (the
median price) from each of several domains, priced by the current policy
with its biggest reasons (`priceExamples` in `packages/core/src/pricing`),
and the hero's price is today's typical price for an open-source
test-tampering session that recovered with its tests passing.

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

## Superseded models

Freshness is lowered a further 0.7× for traces made with a model on
`pricing.freshness.deprecatedModels` (by default the Claude 3 family). The
list is checked when pricing, not when a trace is shared, so adding a model
reprices traces that are already listed.
