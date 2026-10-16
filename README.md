# Trace Marketplace

People who use AI coding agents already have a valuable by-product: the
session logs their agents write. Labs and data companies want those traces,
especially the rare ones, where the agent got stuck in a loop, edited a test
to make it pass, or was corrected by its user. This marketplace lets sellers
share scrubbed traces and lets buyers search, compare and license them, with
prices set by each trace's traits and by supply and demand.

Raw traces never leave the seller's machine. They are parsed, scrubbed and
reviewed in the browser, and only the approved, scrubbed version is uploaded.

![Market simulator: post a bounty and watch matching prices rise](docs/screenshots/market.png)

> **Status: v0 demo** (milestones M0–M8). Everything runs locally with no
> accounts or API keys. What v0 does not do yet is in
> [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Quick start

Requirements: Node.js 22.12 or newer and pnpm 10 (`corepack enable`, or
`npm install -g pnpm@10`).

```bash
git clone https://github.com/worktrial-p-mehta-byte/trace-marketplace.git
cd trace-marketplace
pnpm bootstrap   # install dependencies, create the SQLite database
pnpm seed        # fill it with a synthetic demo market (200 traces, a few seconds)
pnpm dev         # http://localhost:3000
```

Sign in as `buyer@example.com` or `seller@example.com`, password
`demo-password`, or create your own account. Seeded traces are synthetic and
labelled as such. `pnpm demo:reset` starts again from a fresh market.

Prefer Docker? `docker compose up --build` runs the same thing (see
[docs/DEPLOYING.md](docs/DEPLOYING.md)).

## What you can do

**As a seller** (`/share`)

- Pick Claude Code session files (`~/.claude/projects/<project>/*.jsonl`).
  The browser parses them, removes secrets, personal data, home paths and
  internal hosts, and shows a before-and-after with every redaction marked.
- See what was detected (test tampering, retry loops, corrections, rejected
  actions, interrupts, tool and API errors) and an estimated price with the
  reasons behind it.
- Share each session as **open source** (scrubbed content) or **signals
  only** (structure and labels, no content). Each upload records your
  consent; withdraw any trace later from **My traces**.

**As a buyer** (`/traces`)

- Search and filter the catalog by what went wrong, outcome, language,
  framework, model, sharing tier and source (real, staged or synthetic).
- Open a trace: what went wrong, linked to the exact events; the timeline;
  its price history; and the price under a research, evaluation or training
  license, with "why this price".

**In the market** (`/market`)

- Post a bounty for a kind of trace and watch matching prices rise; add
  similar supply and watch them fall; reset. Prices come from
  [a trait-based model](docs/PRICING.md): base × quality × richness ×
  failure value × rarity × demand × freshness × license.

**In the failure lab** ([`demo/failure-lab`](demo/failure-lab))

- Four small projects that provoke agent failures (test tampering, a retry
  loop, a correction, a rejected command), so you can capture rare traces on
  purpose and share them as _staged_.

<p>
  <img src="docs/screenshots/review.png" width="32%" alt="Seller review: redactions, detected failures and the estimated price">
  <img src="docs/screenshots/catalog.png" width="32%" alt="Buyer catalog filtered to test tampering">
  <img src="docs/screenshots/trace.png" width="32%" alt="Trace viewer with what went wrong, the session and why this price">
</p>

A four-minute walkthrough is in [docs/DEMO.md](docs/DEMO.md).

## How it works

```mermaid
flowchart LR
  subgraph browser["Seller's browser"]
    F[Session files] --> P[Parse] --> S[Scrub] --> E[Labels and traits] --> R[Review and estimate]
  end
  R -- "scrubbed trace + consent" --> API[Next.js API]
  API --> RS[Re-scrub and store]
  RS --> DB[(SQLite)]
  RS --> B[(Trace files)]
  RS -- events --> O[Outbox]
  O --> PR[Pricing] --> DB
  O --> SI[Search index] --> FTS[(FTS5)]
  DB --> C[Catalog, viewer, market]
  FTS --> C
```

The same scrubbing, labelling and pricing code runs in the browser and on
the server, which scrubs again rather than trusting the client. Everything
that changes the market emits an event; pricing and search consume them.
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commands

| Command                          | What it does                                                        |
| -------------------------------- | ------------------------------------------------------------------- |
| `pnpm bootstrap`                 | Install dependencies, apply migrations, build the search index      |
| `pnpm dev`                       | Run the website in development mode                                 |
| `pnpm build` / `pnpm start`      | Production build / serve it                                         |
| `pnpm seed`                      | Fill an empty database with a synthetic market and price history    |
| `pnpm demo:reset`                | Delete the database, re-create it and seed it                       |
| `pnpm db:reset`                  | Delete and re-create the database, empty                            |
| `pnpm db:migrate`                | Apply migrations                                                    |
| `pnpm db:generate`               | Generate a migration after changing `packages/db/src/schema.ts`     |
| `pnpm search:rebuild`            | Rebuild the full-text search index from the database                |
| `pnpm reprice`                   | Reprice every listing now (prices also refresh on their own hourly) |
| `pnpm inspect:sessions <folder>` | Parse session files locally and print their structure (no content)  |
| `pnpm check`                     | Typecheck, lint, unit tests and secret scan, as CI runs them        |
| `pnpm build && pnpm e2e`         | The demo flow end to end in a browser, on its own database          |

## Repository layout

```
apps/
  web/           Next.js website and API routes
  cli/           tracemkt seller CLI (stub; stretch milestone S1)
packages/
  schema/        canonical trace schema and domain types (Zod)      [browser-safe]
  adapters/      session-log adapters, e.g. Claude Code             [browser-safe]
  scrub/         scrubber pipeline                                  [browser-safe]
  enrich/        labelers and pricing traits                        [browser-safe]
  pricing/       trait-based pricing policy                         [browser-safe]
  synth/         seeded synthetic trace generator                   [browser-safe]
  config/        typed config: revenue split, pricing weights, caps
  db/            Drizzle schema, migrations, SQLite client
  core/          domain services: catalog, pricing, search, market, ledger, events
demo/
  failure-lab/   projects that provoke agent failures to capture
config/          optional config overrides
scripts/         seed, reset, reprice, search rebuild, secret scan
fixtures/        synthetic or already-scrubbed traces only
docs/            architecture, pricing, services, deploying, demo, limitations
```

Dependencies point one way: `schema` → `adapters`, `scrub`, `enrich`,
`pricing`, `synth` → `db` → `core` → `apps`. Browser-safe packages use no
Node APIs (lint enforces it). Every tunable number lives in
[config](config/README.md). Raw sessions are never committed:
`pnpm check:secrets` runs in CI.

## Third-party and cloud services

None while it runs. After `pnpm install` the system works offline on one
machine: fonts are bundled, the app sends no analytics, and no API keys are
needed. (Next.js's own anonymous telemetry during `dev` and `build` is on by
default; `pnpm exec next telemetry disable` turns it off.) [docs/SERVICES.md](docs/SERVICES.md) lists every dependency and the
hosted services that replace the local pieces in production.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): decisions, components, data flow, milestones
- [Pricing](docs/PRICING.md): the trait-based pricing model
- [Third-party services](docs/SERVICES.md): what v0 uses, what replaces it later
- [Deploying](docs/DEPLOYING.md): production mode, Docker, hosts, path to production
- [Demo script](docs/DEMO.md): a four-minute walkthrough
- [Known v0 limitations](docs/LIMITATIONS.md)
- [Configuration](config/README.md)
- Design doc with decisions and alternatives:
  [Trace Marketplace: Architecture Decisions](https://claude.ai/code/artifact/1f5bb9d5-5350-47fe-a083-e7daea467704)
