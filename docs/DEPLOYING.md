# Deploying

v0 is one Node.js process with a SQLite database and a folder of stored
traces, all under `data/`. It runs anywhere that gives it Node 22 (or Docker)
and a persistent disk. This page covers three ways to run it, what to set up
before anyone else can reach it, and how it grows into a production system.

| Option                                         | Good for                                         |
| ---------------------------------------------- | ------------------------------------------------ |
| [Production mode, no Docker](#production-mode) | A demo on your own machine, at full speed        |
| [Docker](#docker)                              | One server or VM; what CI builds and tests       |
| [A host with a persistent disk](#hosts)        | A shared demo on Fly.io, Render, Railway or a VM |

Serverless hosts that have no persistent disk (Vercel, Netlify, Lambda) do
**not** fit v0: the database and traces are local files and background work
runs in the web process. See [Path to production](#path-to-production).

## Production mode

```bash
pnpm bootstrap      # install, create the database, build the search index
pnpm seed           # optional: the synthetic demo market
pnpm build
pnpm start          # http://localhost:3000
```

`pnpm dev` is for development only: it compiles pages on first visit, so the
first click on each page is slow.

## Docker

The [`Dockerfile`](../Dockerfile) builds the whole workspace into one image.
At start the container applies migrations, rebuilds the search index,
optionally seeds the demo market, and serves on port 3000. Everything it
writes goes to `/app/data`, which is a volume.

```bash
docker compose up --build        # uses docker-compose.yml; seeds the demo market
```

or by hand:

```bash
docker build -t trace-marketplace .
docker run -p 3000:3000 -v tm-data:/app/data -e SEED_DEMO=1 trace-marketplace
```

- `SEED_DEMO=1` fills an empty database with the 200-trace synthetic market
  and the two demo logins. On a database that already has traces it does
  nothing, so restarts are safe. If a seed stopped part-way, the container
  exits with a message instead of serving a half-built demo: delete the
  volume and start again (`docker compose down -v && docker compose up`).
  Leave it unset for a real deployment.
- The container runs as the unprivileged `node` user and has a health check
  on `GET /api/health` (200 when the database is ready, 503 otherwise).
- CI builds this image on every pull request, starts it with the demo seed
  and checks that the catalog lists the seeded traces (the `docker` job in
  [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).

The image is about the size of the full workspace with its dependencies,
because the TypeScript packages and the `tsx` scripts (migrate, seed,
reprice) run from source. A slimmer image would use Next's standalone output
and precompiled scripts.

## Hosts

Any host that runs a container with a persistent volume works the same way
as Docker above. Mount the volume at `/app/data`, expose port 3000, run **one
instance** (SQLite is a single file), and put HTTPS in front. Fly.io (a
volume), Render (a disk) and Railway (a volume) all fit this shape; none has
been tried with this repo yet.

On a plain VM without Docker: install Node 22.12+ and pnpm 10, follow
[Production mode](#production-mode), run `pnpm start` under a process manager
(systemd, pm2) and put Caddy or nginx in front for HTTPS.

## Configuration

All settings have defaults; nothing is required. See
[config/README.md](../config/README.md) for the pricing and revenue settings.

| Variable              | Default                     | What it does                                                                                     |
| --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_PATH`       | `data/trace-marketplace.db` | SQLite file, relative to the repo root or absolute                                               |
| `BLOB_DIR`            | `data/blobs`                | Folder for stored traces, relative to the repo root or absolute                                  |
| `SELLER_SHARE`        | `0.7`                       | Seller's share of each sale                                                                      |
| `TM_CONFIG_OVERRIDES` | none                        | Any config value as JSON, e.g. `{"pricing":{"refreshIntervalMinutes":30}}`                       |
| `TM_ROOT`             | found by walking up         | Repo root (the image sets `/app`); `data/` and `config/` are resolved from it                    |
| `SEED_DEMO`           | `0`                         | Docker only: `1` seeds an empty database with the demo market                                    |
| `TM_COOKIE_SECURE`    | on in production            | `0` lets sign-in work over plain HTTP. Only for a trial on a private network, never the internet |

Stored traces live in `data/blobs/` (`BLOB_DIR`) next to the database;
`pnpm db:reset` deletes both together. The port is 3000
(`apps/web/package.json`).

## Before others can reach it

v0 is a demo. Before sharing a URL beyond people you trust:

- **Serve it over HTTPS.** Session cookies are `Secure` in production, so
  sign-in only works over HTTPS (or on `localhost`).
- **Don't seed the demo market.** `SEED_DEMO`/`pnpm seed` create
  `seller@example.com` and `buyer@example.com` with the published password
  `demo-password`.
- **Know what's open.** Any signed-in user can use the market simulator
  (post bounties, add synthetic supply, reset). There is no email
  verification, password reset or rate limiting. See
  [LIMITATIONS.md](LIMITATIONS.md).
- **Only share what you may share.** Uploaded traces are scrubbed, but the
  scrubber is pattern-based; the seller's review screen is the backstop.

## Data and backups

Everything is in `data/`: `trace-marketplace.db` (plus `-wal` and `-shm`
files while running) and `blobs/`. To back up while running, use SQLite's
online backup, then copy the blobs:

```bash
sqlite3 data/trace-marketplace.db ".backup 'backup.db'" && cp -r data/blobs backup-blobs
```

Or stop the app and copy the whole `data/` folder. The search index is
derived data: `pnpm search:rebuild` recreates it, and the app also rebuilds
it on its own if it falls out of step with the listings.

## Upgrading

Pull the new version and restart. Migrations run at container start, and `pnpm start`
and `pnpm dev` apply pending migrations before starting. If the server is
started another way on an older database, it logs which migrations are
missing and `/status` shows them; run `pnpm db:migrate`. Migrations only move
forward; back up `data/` first.

## Scheduled work

Prices depend on time as well as events (freshness and the demand window).
The app refreshes them when a page loads and the last full reprice is older
than `pricing.refreshIntervalMinutes` (60). To keep them fresh with no
traffic, run `pnpm reprice` from cron, e.g. hourly:

```cron
5 * * * * cd /srv/trace-marketplace && pnpm reprice
```

In Docker: `docker exec <container> pnpm reprice`.

## Path to production

Each local piece sits behind an interface, so production swaps
implementations, not calling code. [SERVICES.md](SERVICES.md) lists the
replacements. A sensible order:

1. **Async data access and Postgres.** `packages/core` uses synchronous
   better-sqlite3 calls; make them async, then point Drizzle at Postgres
   (`DATABASE_URL`). Add the partial unique index for duplicate uploads.
2. **Object storage** (S3 or R2) behind `BlobStore`, so the app no longer
   needs a local disk.
3. **A worker process** that runs the pricing and search consumers from the
   events outbox (later SQS or Kafka behind `EventBus`), plus the scheduled
   reprice. Web requests then only write and emit.
4. **Hosted auth** (Auth.js or Clerk) with verification, reset and rate
   limits.
5. **Payments**: Stripe Checkout and Connect behind `PaymentProvider`, with
   collections and checkout (stretch S2).
6. **Search**: OpenSearch or a vector index behind `SearchIndex` once the
   catalog outgrows in-memory facets.

After steps 1 to 3 the web app is stateless and fits serverless hosting.
