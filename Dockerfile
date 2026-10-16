# Trace Marketplace: one container running the website, with SQLite and
# stored traces on a volume at /app/data. See docs/DEPLOYING.md.
#
#   docker build -t trace-marketplace .
#   docker run -p 3000:3000 -v tm-data:/app/data -e SEED_DEMO=1 trace-marketplace

FROM node:22.12-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm comes from corepack, pinned to the version in package.json
# ("packageManager"), and is baked into the image so the container never
# downloads it at start-up.
COPY package.json /tmp/package.json
RUN corepack enable \
  && corepack install -g "$(node -p "require('/tmp/package.json').packageManager")" \
  && chmod -R a+rX /corepack \
  && rm /tmp/package.json
WORKDIR /app

# ---------------------------------------------------------------- build
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# Toolchain for better-sqlite3, in case no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ---------------------------------------------------------------- runtime
FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TM_ROOT=/app
# The whole workspace is copied: packages ship TypeScript source, and the
# migrate, seed and reprice scripts run with tsx. See docs/DEPLOYING.md for
# what a slimmer production image would change.
COPY --from=build /app /app
# The app runs as `node`: it writes only the data volume and Next's cache.
RUN mkdir -p /app/data /app/apps/web/.next/cache \
  && chown -R node:node /app/data /app/apps/web/.next/cache
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
