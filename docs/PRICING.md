# Pricing

> The engine is built in milestone M3. This page records the model it implements.

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
All of these are configurable: see [config/README.md](../config/README.md) and
`packages/config/src/defaults.ts`. The weights are starting guesses, not market
data; a learned model replaces them once there are real sales.
