# Third-party and cloud services

**v0 uses no hosted services.** After `pnpm install`, the whole system runs
offline on one machine. This file lists every dependency and what replaces the
local pieces in production. Keep it current when adding a service.

## Used in v0

| Dependency                           | Purpose                                                                           | Account or key needed |
| ------------------------------------ | --------------------------------------------------------------------------------- | --------------------- |
| Node.js 22 + pnpm 10                 | Runtime and package manager                                                       | No                    |
| Next.js 15, React 19                 | Website and API routes                                                            | No                    |
| Tailwind CSS 4                       | Styling                                                                           | No                    |
| Schibsted Grotesk, JetBrains Mono    | Fonts, bundled from npm (`@fontsource-variable`), no Google Fonts call at runtime | No                    |
| SQLite via better-sqlite3            | Local database (`data/trace-marketplace.db`)                                      | No                    |
| Drizzle ORM / drizzle-kit            | Schema, queries, migrations                                                       | No                    |
| Zod                                  | Schema validation (traces, config)                                                | No                    |
| Python 3.10+ (optional)              | Only to run the failure-lab Python tasks in `demo/failure-lab`                    | No                    |
| Vitest, ESLint, Prettier, TypeScript | Tests and code quality                                                            | No                    |
| GitHub Actions                       | CI: typecheck, lint, tests, secret scan                                           | GitHub repo only      |

## Production replacements (not used in v0)

Each sits behind an interface, so swapping it does not change calling code.

| Service                           | Replaces                   | Interface         | Environment variables (planned)  |
| --------------------------------- | -------------------------- | ----------------- | -------------------------------- |
| Postgres (e.g. Neon, RDS)         | SQLite                     | Drizzle schema    | `DATABASE_URL`                   |
| S3 or Cloudflare R2               | Local blob folder          | `BlobStore`       | `BLOB_BUCKET`, cloud credentials |
| OpenSearch / vector DB            | SQLite FTS5                | `SearchIndex`     | `SEARCH_URL`                     |
| SQS or Kafka                      | Events outbox table        | `EventBus`        | `QUEUE_URL`                      |
| Stripe Checkout + Connect         | Demo credits in the ledger | `PaymentProvider` | `STRIPE_SECRET_KEY`              |
| OAuth / SSO (Auth.js, Clerk)      | Email + password           | Auth module       | provider keys                    |
| LLM API (optional)                | Heuristic labeler          | `Labeler`         | provider API key                 |
| Sandbox compute (e.g. Modal, Fly) | Repro status flag          | Repro runner      | provider key                     |
| Vercel / Fly.io                   | Local `pnpm dev`           | —                 | —                                |
