# Known v0 limitations

A running list of what v0 does not do, does approximately, or does
differently from production. Updated with every milestone. Each entry says
where the limit lives and what would lift it.

## Capture (adapters) — M1

| Limitation                                                                        | Impact                                                               | Lifted by                                                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| Only Claude Code is supported                                                     | Codex, Cursor, Aider sessions can't be shared                        | One adapter per harness (`ADAPTERS` list)                       |
| Checked against Claude Code 2.1.300 only; the log format is not a public contract | A future format change may drop events                               | Format checks in CI against fresh real logs; adapter versioning |
| Sub-agent (sidechain) turns and thinking blocks are skipped                       | Traces miss sub-agent work and the model's reasoning                 | Nested timelines in the schema                                  |
| Tool output over 20,000 characters is truncated; images become `[image]`          | Long logs and screenshots are lost                                   | Store large outputs as blobs                                    |
| Trace ids use a fast non-cryptographic hash of the session id                     | Not a security boundary (the raw id never leaves the browser anyway) | SHA-256 server-side for content hashes                          |

## Scrubbing — M2

| Limitation                                              | Impact                                                                                                                      | Lifted by                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Rules are pattern-based                                 | New secret formats, people's names, company names and proprietary code are not detected unless the seller adds custom terms | ML/LLM scrubber stage; the seller review screen is the backstop |
| Phone numbers: North American formats only              | Other formats pass through                                                                                                  | More locale rules                                               |
| Internal hosts only by suffix (`.corp`, `.internal`, …) | Internal names on public-looking domains pass through                                                                       | Seller custom terms; org-level denylists                        |
| Generic `KEY=value` secrets need a digit in the value   | An all-letter password in a config line is missed                                                                           | Entropy scoring                                                 |

## Labels and traits — M2

| Limitation                                                                     | Impact                                                                      | Lifted by                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------- |
| Corrections are detected by English phrases ("no", "don't", "that's wrong", …) | Polite or non-English corrections are missed; under-counts preference pairs | LLM labeler behind the `Labeler` interface        |
| Test runs recognised by command patterns; pass/fail by output text             | Custom test scripts are missed; unusual output may be misread               | Harness-reported exit codes; repo-specific config |
| Test tampering only detected for edits with old/new text                       | Whole-file rewrites or deletions of test files are missed                   | Diff-based detection                              |
| Language and framework from fixed lists                                        | Niche stacks show as unknown, which lowers their rarity value               | Larger lists; repo manifest parsing               |

## Pricing — M3

| Limitation                                                                         | Impact                                                                  | Lifted by                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| All weights are hand-set guesses                                                   | Prices are illustrative, not market-tested                              | A learned model on real sales, behind `PricingPolicy` |
| Small catalogs make rarity noisy                                                   | One upload can swing rarity a lot                                       | Minimum catalog size; smoothing                       |
| Synthetic traces count toward rarity in the demo (`rarity.includeSynthetic: true`) | Demo prices react to synthetic supply                                   | Set `false` in production                             |
| No per-seller cap on rarity yet; dedup is by exact content hash                    | One seller can still create volume with near-duplicates                 | Near-duplicate detection; per-seller caps             |
| Demand-swing limit only applies against a snapshot older than 24 hours             | Within a demo session, demand can move freely (by design, for the demo) | Works as intended once prices have history            |
| Whole catalog is repriced on any relevant event                                    | Fine for thousands of listings, slow beyond                             | Reprice only affected combinations                    |
| `no_model_output` traces still get a price                                         | Low-value traces can be listed                                          | Eligibility check at listing time (M4)                |

## Platform

| Limitation                                         | Impact                                     | Lifted by                                               |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| SQLite, synchronous data access in `packages/core` | Single machine; Postgres needs async calls | Stretch S3: async core, Postgres                        |
| Background work runs inside the web process        | Doesn't fit serverless hosting             | Separate worker (S3)                                    |
| No real payments, auth providers or hosted storage | Demo only                                  | Stripe, Auth.js/Clerk, S3/R2 behind existing interfaces |
| Reproducible tasks are a status flag only          | No containers or verifiers yet             | Repro service (post-v0)                                 |

## Data

| Limitation                                                      | Impact                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The demo seller's real sessions are short (a handful of events) | Rich, rare traces come from the failure lab and the synthetic generator (M6), labelled as such |
