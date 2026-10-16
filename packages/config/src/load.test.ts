import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, platformShare } from "./index";

describe("loadConfig", () => {
  it("returns defaults with a 70/30 split", () => {
    const c = loadConfig();
    expect(c.revenue.sellerShare).toBe(0.7);
    expect(platformShare(c)).toBeCloseTo(0.3);
    expect(c).toEqual(DEFAULT_CONFIG);
  });

  it("lets SELLER_SHARE override the split", () => {
    const c = loadConfig({ env: { SELLER_SHARE: "0.8" } });
    expect(c.revenue.sellerShare).toBe(0.8);
    expect(platformShare(c)).toBeCloseTo(0.2);
  });

  it("applies file overrides, with env taking precedence", () => {
    const c = loadConfig({
      fileOverrides: { revenue: { sellerShare: 0.6 }, pricing: { multiplierCap: 10 } },
      env: { SELLER_SHARE: "0.75" },
    });
    expect(c.revenue.sellerShare).toBe(0.75);
    expect(c.pricing.multiplierCap).toBe(10);
    expect(c.pricing.floor).toBe(DEFAULT_CONFIG.pricing.floor);
  });

  it("accepts deep JSON overrides via TM_CONFIG_OVERRIDES", () => {
    const c = loadConfig({
      env: { TM_CONFIG_OVERRIDES: '{"pricing":{"license":{"training":3}}}' },
    });
    expect(c.pricing.license.training).toBe(3);
    expect(c.pricing.license.eval).toBe(1.5);
  });

  it("rejects a seller share outside 0..1", () => {
    expect(() => loadConfig({ env: { SELLER_SHARE: "1.5" } })).toThrow(/revenue.sellerShare/);
  });

  it("rejects a non-numeric seller share", () => {
    expect(() => loadConfig({ env: { SELLER_SHARE: "seventy" } })).toThrow(/SELLER_SHARE/);
  });

  it("rejects a floor above the ceiling", () => {
    expect(() => loadConfig({ fileOverrides: { pricing: { floor: 60 } } })).toThrow(/floor/);
  });

  it("lets DATABASE_PATH and BLOB_DIR move the data, e.g. for end-to-end tests", () => {
    expect(loadConfig().storage.blobPath).toBe("data/blobs");
    const c = loadConfig({ env: { DATABASE_PATH: "data/e2e.db", BLOB_DIR: "data/e2e-blobs" } });
    expect(c.database.path).toBe("data/e2e.db");
    expect(c.storage.blobPath).toBe("data/e2e-blobs");
  });
});
