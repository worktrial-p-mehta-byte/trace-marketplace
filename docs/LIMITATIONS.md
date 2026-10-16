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

| Limitation                                                                                                     | Impact                                                                                                                      | Lifted by                                                       |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Rules are pattern-based                                                                                        | New secret formats, people's names, company names and proprietary code are not detected unless the seller adds custom terms | ML/LLM scrubber stage; the seller review screen is the backstop |
| Phone numbers: North American formats only                                                                     | Other formats pass through                                                                                                  | More locale rules                                               |
| Internal hosts only by suffix (`.corp`, `.internal`, …)                                                        | Internal names on public-looking domains pass through                                                                       | Seller custom terms; org-level denylists                        |
| Generic `KEY=value` secrets need a digit in the value                                                          | An all-letter password in a config line is missed                                                                           | Entropy scoring                                                 |
| Credential-named keys in structured tool input are redacted whole; the same value under an ordinary key is not | `{"note": "p4ss…"}` with no recognisable pattern passes through                                                             | Entropy scoring; LLM scrubber stage                             |
| Traces shared before a scrubber fix are not re-scrubbed                                                        | Older listings may carry what a newer rule would remove                                                                     | Re-scrub job over stored traces when rules change               |

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

## Accounts, onboarding and sharing — M4

| Limitation                                                                                                                                                      | Impact                                                                    | Lifted by                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Email and password only; no email verification, password reset or login rate limiting                                                                           | Fine for a local demo, not for the internet                               | Auth.js or Clerk with SSO and verification (S3)                                     |
| No CSRF tokens; relies on `SameSite=Lax` session cookies                                                                                                        | Adequate for same-site use only                                           | CSRF tokens or an auth provider                                                     |
| For signals-only uploads, corrections, test outcome, recovery, language and framework are reported by the seller's browser (bounded by what the server can see) | A tampered browser could inflate a signals-only price within those bounds | Signed client builds; per-event derived flags the server can check                  |
| Sessions are read whole into browser memory                                                                                                                     | Very large session files (100 MB+) are slow to review                     | Streaming parse in a Web Worker                                                     |
| Review shows events 40 at a time; the "compare with original" view is side by side, not a diff                                                                  | Long sessions take scrolling to check                                     | Jump-to-redaction navigation; inline diff                                           |
| Duplicate shares are prevented by checking inside the insert transaction, which is atomic only within one process                                               | Two server processes could still race once v0 is scaled out               | A partial unique index on (seller, content hash) for live consents in Postgres (S3) |
| Uploads over 15 MB (after scrubbing) are refused                                                                                                                | Very long sessions can't be shared yet                                    | Blob upload with resumable transfer                                                 |
| Withdrawing delists a trace but keeps its stored copy                                                                                                           | Needed for buyers who already bought it; nothing new is sold              | Deletion once no live entitlements reference it                                     |
| Pricing runs inside the share and withdraw requests                                                                                                             | Requests slow down as the catalog grows                                   | Background worker (S3)                                                              |
| Rarity uses the market as it is now; nothing is sold yet                                                                                                        | The seller's estimate can change after sharing                            | Expected behaviour; shown as "estimated"                                            |

## Catalog and viewer — M5

| Limitation                                                                                                                              | Impact                                                                                       | Lifted by                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Signed-in users can read open-source traces in full before buying; buying is a license to use them                                      | Fine for open-source work; a buyer could read without paying                                 | Previews limited to the first events, full content after purchase (S2) |
| Checkout is not built; the buy button is disabled                                                                                       | No sales, so no seller earnings yet                                                          | Collections and checkout (S2)                                          |
| Every buyer search and view with criteria counts as demand, with no per-buyer cap or dedup                                              | A buyer can push prices up by repeating searches (bounded by the demand cap and daily limit) | Count each buyer once per criteria per window                          |
| Filters and facet counts are computed in memory over all active listings                                                                | Fine to a few thousand listings                                                              | SQL facets, or OpenSearch aggregations behind `SearchIndex`            |
| Full-text search indexes titles, labels, stack, tools and, for open-source traces, the first 20,000 characters of messages and commands | Matches deep in long sessions are missed                                                     | Chunked indexing; semantic search                                      |
| Search indexing runs inside the share and withdraw requests                                                                             | Slower requests as traces grow                                                               | Background worker (S3)                                                 |
| Seller aliases are stable per seller                                                                                                    | Buyers can tell that two traces share a seller (by design), but not who it is                | —                                                                      |

## Market simulator, seed data and failure lab — M6

| Limitation                                                                                   | Impact                                                         | Lifted by                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Seeded and simulated traces are synthetic: realistic structure, invented content             | Good for showing pricing and search; not training data         | Real supply, including failure-lab sessions                      |
| Any signed-in user can post bounties, add supply and reset the simulator                     | Fine for a local demo; anyone can move prices                  | Admin-only simulator; real bounties funded through checkout (S2) |
| Bounties only add demand; nobody can fulfil one, and they never expire                       | No bounty payouts or matching traces to bounties               | Bounty submissions and payouts (post-v0)                         |
| Reset removes all bounty demand, including bounties not posted from the simulator            | Mixing real bounties with the simulator would lose real demand | Tag simulator demand separately                                  |
| Price history keeps every simulator move after a reset                                       | Charts show past experiments as steps                          | Mark or hide simulator moves                                     |
| Failure-lab tasks raise the odds of a failure but don't guarantee one, and are not run in CI | A run can produce a clean session; a task could rot unnoticed  | Check the tasks' starting failures in CI                         |

## Docs and deployment — M7

| Limitation                                                                                                        | Impact                                                     | Lifted by                                      |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| The Docker image contains the whole workspace and its dev dependencies                                            | Larger image (scripts run from TypeScript with `tsx`)      | Next standalone output and precompiled scripts |
| Docker is tested in CI (build, start, seeded catalog), not on a real host; Fly.io, Render and Railway are untried | A host may need small changes (port, volume path)          | Try one host and document it                   |
| One instance only: SQLite file, in-process consumers                                                              | No horizontal scaling or zero-downtime deploys             | Postgres, object storage and a worker (S3)     |
| `/api/health` checks only the database                                                                            | A broken blob folder or search index still reports healthy | Deeper checks                                  |

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
