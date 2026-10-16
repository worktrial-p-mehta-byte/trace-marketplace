#!/bin/sh
# Container start: apply migrations, optionally seed the demo market, then
# serve the website. Everything persistent lives in /app/data (a volume).
set -e
cd /app

pnpm db:migrate
pnpm search:rebuild

# SEED_DEMO=1 fills an empty database with the synthetic demo market.
# Exit 3 from the seed means the database already has traces (fine on every
# restart). Anything else, including 4 (an earlier seed stopped part-way),
# stops the container so the problem is visible.
if [ "${SEED_DEMO:-0}" = "1" ]; then
  set +e
  pnpm seed
  code=$?
  set -e
  case "$code" in
    0) ;;
    3) echo "Seed skipped: the database already has traces." ;;
    *) echo "Seed failed (exit $code). See the messages above." >&2; exit "$code" ;;
  esac
fi

exec pnpm start
