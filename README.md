# Trace Marketplace

A marketplace where people who use AI coding agents share the session traces
their agents already log, and labs and data companies search, group and license
them. Raw traces never leave the seller's machine: they are scrubbed and
reviewed locally, and only approved, scrubbed traces are uploaded.

> **Status: v0 in progress** (milestone M6). See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the plan and milestones.

## Quick start

Requirements: Node.js 22.12 or newer, and pnpm 10 (`npm install -g pnpm@10` or
`corepack enable`).

```bash
pnpm bootstrap   # install dependencies and create the local SQLite database
pnpm seed        # optional: fill it with a synthetic demo market (200 traces)
pnpm dev         # start the website at http://localhost:3000
```

After seeding, sign in as `buyer@example.com` or `seller@example.com` (password
`demo-password`). Seeded traces are synthetic and labelled as such.

No accounts, API keys or cloud services are needed. Everything runs locally.

## Useful commands

| Command                          | What it does                                                        |
| -------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                       | Run the website in development mode                                 |
| `pnpm test`                      | Run unit tests (Vitest)                                             |
| `pnpm typecheck`                 | Type-check every package                                            |
| `pnpm lint`                      | Lint the whole repo                                                 |
| `pnpm check:secrets`             | Scan files for secrets and unscrubbed session data                  |
| `pnpm check`                     | All of the above, as CI runs it                                     |
| `pnpm db:generate`               | Generate a migration after changing `packages/db/src/schema.ts`     |
| `pnpm db:migrate`                | Apply migrations to the local database                              |
| `pnpm db:reset`                  | Delete and re-create the local database                             |
| `pnpm inspect:sessions <folder>` | Parse session files locally and print their structure (no content)  |
| `pnpm seed`                      | Fill an empty database with a synthetic market and price history    |
| `pnpm demo:reset`                | Delete the database, re-create it and seed it                       |
| `pnpm search:rebuild`            | Rebuild the full-text search index from the database                |
| `pnpm reprice`                   | Reprice every listing now (prices also refresh on their own hourly) |

## Repository layout

```
apps/
  web/         Next.js website + API routes
  cli/         tracemkt seller CLI (milestone S1)
packages/
  schema/      canonical trace schema + domain types (Zod)        [browser-safe]
  adapters/    harness adapters, e.g. Claude Code (M1)            [browser-safe]
  scrub/       scrubber pipeline (M2)                             [browser-safe]
  enrich/      labelers + pricing trait extraction (M2)           [browser-safe]
  pricing/     trait-based pricing policy (M3)                    [browser-safe]
  synth/       seeded synthetic trace generator (M6)              [browser-safe]
  config/      typed config: revenue split, pricing weights, caps
  db/          Drizzle schema, migrations, SQLite client
  core/        domain services: events, ledger, policy, ...
config/        optional config overrides (see config/README.md)
scripts/       repo scripts (db reset, seed, search rebuild, secret scan)
demo/
  failure-lab/ small projects that provoke agent failures to capture (M6)
fixtures/      synthetic or already-scrubbed traces only
docs/          architecture, services, pricing, demo script
```

**Rules that keep it extensible**

- Dependencies point one way: `schema` → `adapters`, `scrub`, `enrich`, `pricing`
  → `db` → `core` → `apps`.
- Browser-safe packages use no Node APIs (enforced by lint), so the same scrubbing
  and pricing code runs in the browser and in the CLI.
- Every tunable number lives in config. See [config/README.md](config/README.md).
- Raw sessions are never committed. The database and session folders are in
  `.gitignore`, and `pnpm check:secrets` runs in CI.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): decisions, components, milestones
- [Third-party services](docs/SERVICES.md): what v0 uses and what replaces what later
- [Pricing](docs/PRICING.md): the trait-based pricing model
- [Demo script](docs/DEMO.md)
- [Known v0 limitations](docs/LIMITATIONS.md)
