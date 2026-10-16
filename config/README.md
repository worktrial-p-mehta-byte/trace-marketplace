# Configuration

Every tunable number (revenue split, pricing weights, caps) has a default in
[`packages/config/src/defaults.ts`](../packages/config/src/defaults.ts).

To change values, either:

1. Copy `marketplace.config.example.json` to `marketplace.config.json` and edit
   it. Only the keys you set are overridden. The file is optional.
2. Or set environment variables, which take precedence over the file:

| Variable              | Effect                                                             | Example                            |
| --------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| `SELLER_SHARE`        | Fraction of each sale paid to the seller (platform keeps the rest) | `0.7`                              |
| `DATABASE_PATH`       | SQLite file location (relative to repo root, or absolute)          | `data/trace-marketplace.db`        |
| `TM_CONFIG_OVERRIDES` | Any deep override as JSON                                          | `{"pricing":{"multiplierCap":10}}` |

The config is validated at startup; an invalid value (for example a seller
share above 1) stops the app with a clear message. Each sale records the seller
share in force at the time, so changing it never rewrites past sales.

## Most useful settings

| Key                                  | Default            | What it changes                                                   |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------- |
| `revenue.sellerShare`                | `0.7`              | Seller's share of each sale                                       |
| `pricing.basePrice.tier0` / `.tier1` | `2.0` / `0.25` ($) | Starting price for open-source and signals-only traces            |
| `pricing.multiplierCap`              | `12`               | Largest combined multiplier before the license                    |
| `pricing.floor` / `pricing.ceiling`  | `0.1` / `50` ($)   | Lowest and highest list price                                     |
| `pricing.rarity.includeSynthetic`    | `true`             | Whether synthetic traces count as supply (turn off in production) |
| `pricing.demand.windowDays`          | `14`               | How long a search or bounty keeps pushing prices                  |
| `pricing.refreshIntervalMinutes`     | `60`               | How stale prices may get before the app reprices on its own       |
| `pricing.license`                    | 1 / 1.5 / 2        | Research, evaluation and training license multipliers             |

Every key, with comments, is in
[`defaults.ts`](../packages/config/src/defaults.ts); the formula they feed is
in [docs/PRICING.md](../docs/PRICING.md). Deployment-only variables
(`TM_ROOT`, `SEED_DEMO`, `TM_COOKIE_SECURE`) are in
[docs/DEPLOYING.md](../docs/DEPLOYING.md#configuration).
