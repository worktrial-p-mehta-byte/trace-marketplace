#!/bin/sh
# Container start: apply migrations, optionally seed the demo market, then
# serve the website. Everything persistent lives in /app/data (a volume).
set -e
cd /app

pnpm db:migrate
pnpm search:rebuild

# SEED_DEMO=1 fills an empty database with the synthetic demo market.
# The seed refuses to run on a database that already has traces.
if [ "${SEED_DEMO:-0}" = "1" ]; then
  pnpm seed || echo "Seed skipped: the database already has traces."
fi

exec pnpm start
