import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { loadConfig } from "./load";
import type { MarketplaceConfig } from "./schema";

/** Walk up from `start` to the folder holding pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string {
  if (process.env.TM_ROOT) return resolve(process.env.TM_ROOT);
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

let cached: MarketplaceConfig | undefined;

/**
 * Node-only loader: reads config/marketplace.config.json (optional) and
 * process.env, and resolves the database path against the repo root.
 */
export function loadServerConfig(opts: { fresh?: boolean } = {}): MarketplaceConfig {
  if (cached && !opts.fresh) return cached;
  const root = findRepoRoot();
  const file = join(root, "config", "marketplace.config.json");
  const fileOverrides = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  const config = loadConfig({ env: process.env, fileOverrides });
  if (!isAbsolute(config.database.path)) {
    config.database.path = join(root, config.database.path);
  }
  if (!isAbsolute(config.storage.blobPath)) {
    config.storage.blobPath = join(root, config.storage.blobPath);
  }
  cached = config;
  return config;
}
