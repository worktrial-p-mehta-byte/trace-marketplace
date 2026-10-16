import { DEFAULT_CONFIG } from "./defaults";
import { MarketplaceConfig } from "./schema";

type Env = Record<string, string | undefined>;
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override))
    return (override === undefined ? base : override) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

function num(env: Env, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got "${raw}"`);
  return n;
}

/** Environment variables that override config. Kept short on purpose. */
function envOverrides(env: Env): DeepPartial<MarketplaceConfig> {
  const o: DeepPartial<MarketplaceConfig> = {};
  const sellerShare = num(env, "SELLER_SHARE");
  if (sellerShare !== undefined) o.revenue = { sellerShare };
  if (env.PRICING_POLICY) {
    if (env.PRICING_POLICY !== "trait-v1" && env.PRICING_POLICY !== "trait-v2")
      throw new Error(`PRICING_POLICY must be trait-v1 or trait-v2, got "${env.PRICING_POLICY}"`);
    o.pricing = { policy: env.PRICING_POLICY };
  }
  if (env.DATABASE_PATH) o.database = { path: env.DATABASE_PATH };
  if (env.BLOB_DIR) o.storage = { blobPath: env.BLOB_DIR };
  if (env.TM_CONFIG_OVERRIDES) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.TM_CONFIG_OVERRIDES);
    } catch {
      throw new Error("TM_CONFIG_OVERRIDES must be valid JSON");
    }
    return deepMerge(parsed as DeepPartial<MarketplaceConfig>, o);
  }
  return o;
}

/**
 * Build the effective config. Precedence, lowest to highest:
 * defaults → file overrides (config/marketplace.config.json) → environment.
 * Browser-safe: callers pass env and file contents in.
 */
export function loadConfig(opts: { env?: Env; fileOverrides?: unknown } = {}): MarketplaceConfig {
  let merged: unknown = DEFAULT_CONFIG;
  if (opts.fileOverrides !== undefined) merged = deepMerge(merged, opts.fileOverrides);
  merged = deepMerge(merged, envOverrides(opts.env ?? {}));
  const result = MarketplaceConfig.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid marketplace config:\n  ${issues.join("\n  ")}`);
  }
  return result.data;
}
