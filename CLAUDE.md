# Notes for agents working in this repo

- Package manager is pnpm (workspace). Run `pnpm check` before opening a PR.
- Workspace packages export TypeScript source (`"exports": "./src/index.ts"`);
  there is no build step for packages. Next.js transpiles them (`transpilePackages`).
- `packages/schema`, `adapters`, `scrub`, `enrich`, `pricing` must stay
  browser-safe: no `node:*` imports (lint enforces this).
- Dependencies point one way: schema → adapters/scrub/enrich/pricing → db → core → apps.
- Every tunable number goes in `packages/config/src/defaults.ts`, never inline.
- Money is integer cents; ledger transactions must balance (`postTransaction`).
- After changing `packages/db/src/schema.ts`, run `pnpm db:generate` and commit
  the new SQL under `packages/db/drizzle/`.
- Never commit raw agent sessions. Fixtures must be synthetic or scrubbed;
  `pnpm check:secrets` enforces this. Mark intentional fake secrets in tests
  with `tm-allow-secret` on the same line.
- Work ships one milestone per PR; do not start the next milestone until the
  current PR is approved and merged.
