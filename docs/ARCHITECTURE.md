# Architecture

The full architecture write-up (decisions with alternatives, data model,
target-state component diagram, pricing model, build plan) lives in the shared
design doc: <https://claude.ai/code/artifact/1f5bb9d5-5350-47fe-a083-e7daea467704>.
This file summarises what the code implements.

## Principles

1. Raw traces never leave the seller's machine. Scrubbing and review happen
   on-device (in the browser for the v0 demo, in the CLI later).
2. Consent is explicit, per session or repo, and recorded in an append-only ledger.
3. Store once, sell many ways: Trace → derived Assets → Listings.
4. Mocks sit behind real interfaces (`packages/core/src/ports.ts`).
5. Local first: one command, no cloud account.

## How the code maps to the design

| Design decision                                     | Where it lives                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| D1 Harness adapters as plugins                      | `packages/adapters` (`TraceAdapter`, registry)                     |
| D2/D3 On-device layered scrubbing                   | `packages/scrub` (`ScrubStage`), browser-safe                      |
| D4 Trace → Asset → Listing                          | `packages/db/src/schema.ts` (`traces`, `assets`, `listings`)       |
| D5 Tiered sharing                                   | `packages/schema` (`Tier`), `packages/core/src/policy`             |
| D6 Rebuildable search index                         | `SearchIndex` port in `packages/core/src/ports.ts`                 |
| D7 Collections are queries; purchases are snapshots | `collections`, `collection_snapshots` tables                       |
| D8 Pluggable pricing                                | `packages/pricing` (`PricingPolicy`), weights in `packages/config` |
| D9 Double-entry ledger and entitlements             | `packages/core/src/ledger`, `ledger_*`, `entitlements` tables      |
| D10 Vendor model with bounty board                  | `bounties`, `bounty_submissions` tables                            |
| D11 Everything emits events                         | `packages/core/src/events` (outbox table, per-consumer cursors)    |

## Data conventions

- IDs are prefixed random strings (`trc_…`, `ltx_…`).
- Money is integer cents. Each order line stores the seller share in force.
- Timestamps are integer milliseconds.
- The trace schema is versioned (`schemaVersion: 1`); adapters target it.

## Milestones

| #   | Milestone                                                  | Status  |
| --- | ---------------------------------------------------------- | ------- |
| M0  | Scaffold: monorepo, config, all tables, events, ledger, CI | This PR |
| M1  | Canonical schema + Claude Code adapter                     |         |
| M2  | Scrubber + labeler + trait extractor                       |         |
| M3  | Pricing engine                                             |         |
| M4  | Onboarding + sharing                                       |         |
| M5  | Catalog + trace viewer                                     |         |
| M6  | Market simulator + seed data + failure lab                 |         |
| M7  | Docs                                                       |         |
| M8  | Rehearse + polish                                          |         |
