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
