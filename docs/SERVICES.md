# Third-party and cloud services

**v0 uses no hosted services while it runs.** No accounts, API keys or cloud
resources are needed: the website, database, search and stored traces all
live on one machine. This file lists every dependency, every network call
the project makes and when, and the hosted services that replace the local
pieces in production. Keep it current when adding a service.

## Network calls

| When                     | Call                                                                                | Can it be avoided?                                                  |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm install`           | npm registry for packages; GitHub releases for the prebuilt `better-sqlite3` binary | Needed once; without the prebuilt binary it compiles locally        |
| `pnpm dev`, `pnpm build` | Next.js anonymous telemetry (on by default)                                         | `pnpm exec next telemetry disable`, or `NEXT_TELEMETRY_DISABLED=1`  |
| `docker build`           | Docker Hub (`node:22.12-bookworm-slim`), npm registry (packages and pnpm itself)    | Needed to build the image; the running container needs none of them |
| Running the app          | **None.** Fonts are bundled from npm; no analytics, CDNs or external APIs           | —                                                                   |

## Dependencies

| Dependency                           | Purpose                                                                  | Account or key needed |
| ------------------------------------ | ------------------------------------------------------------------------ | --------------------- |
| Node.js 22.12+ and pnpm 10           | Runtime and package manager                                              | No                    |
| Next.js 15, React 19                 | Website and API routes                                                   | No                    |
| Tailwind CSS 4                       | Styling                                                                  | No                    |
| Schibsted Grotesk, JetBrains Mono    | Fonts, bundled from npm (`@fontsource-variable`)                         | No                    |
| SQLite via better-sqlite3            | Database (`data/trace-marketplace.db`) and full-text search (FTS5)       | No                    |
| Local folder                         | Stored traces (`data/blobs/`)                                            | No                    |
| Drizzle ORM and drizzle-kit          | Schema, queries, migrations                                              | No                    |
| Zod                                  | Validation of traces, config and requests                                | No                    |
| tsx                                  | Runs the TypeScript scripts (migrate, seed, reprice, secret scan)        | No                    |
| Vitest, ESLint, Prettier, TypeScript | Tests and code quality                                                   | No                    |
| Docker (optional)                    | Container image and `docker compose` (see [DEPLOYING.md](DEPLOYING.md))  | No                    |
| Python 3.10+ (optional)              | Only for the Python tasks in `demo/failure-lab`                          | No                    |
| GitHub Actions                       | CI: typecheck, lint, tests, secret scan, migrations, build, Docker image | GitHub repo only      |

## Production replacements (not used in v0)

Each local piece sits behind an interface, so a swap changes one
implementation, not the code that calls it. The order to do them in is in
[DEPLOYING.md](DEPLOYING.md#path-to-production).

| Service                                       | Replaces                        | Interface               | Environment variables (planned)  |
| --------------------------------------------- | ------------------------------- | ----------------------- | -------------------------------- |
| Postgres (e.g. Neon, RDS)                     | SQLite                          | Drizzle schema          | `DATABASE_URL`                   |
| S3 or Cloudflare R2                           | `data/blobs/` folder            | `BlobStore`             | `BLOB_BUCKET`, cloud credentials |
| OpenSearch or a vector database               | SQLite FTS5, in-memory facets   | `SearchIndex`           | `SEARCH_URL`                     |
| SQS or Kafka, plus a worker process           | Events outbox polled in-process | `EventBus`              | `QUEUE_URL`                      |
| Stripe Checkout and Connect                   | Demo credits in the ledger      | `PaymentProvider`       | `STRIPE_SECRET_KEY`              |
| Auth.js or Clerk (OAuth, SSO)                 | Email and password              | Auth module             | Provider keys                    |
| An LLM API (optional)                         | Heuristic labeler and scrubber  | `Labeler`, `ScrubStage` | Provider API key                 |
| Sandboxed compute (e.g. Modal, Fly Machines)  | Reproducibility status flag     | Repro runner            | Provider key                     |
| A scheduler (cron, Cloud Scheduler)           | Refresh on page load            | `pnpm reprice`          | —                                |
| Container host with a volume, then serverless | `pnpm start` on one machine     | —                       | —                                |
