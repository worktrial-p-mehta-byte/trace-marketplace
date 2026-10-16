import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@tm/config";
import { openDb, runMigrations, schema, type Db } from "@tm/db";
import { generateCatalog, generateFlood } from "@tm/synth";
import {
  browseCatalog,
  createDbEventBus,
  createMemoryBlobStore,
  createSqliteSearchIndex,
  criteriaOf,
  deleteSavedSearch,
  describe as describeQuery,
  ensureAccount,
  intentWords,
  listSavedSearches,
  MAX_SAVED_SEARCHES,
  parseIntent,
  rebuildSearchIndex,
  repriceAll,
  resolveQuery,
  saveSearch,
  SavedSearchError,
  shareTrace,
  type CatalogDeps,
  type PublicUser,
} from "../index";

const chips = (text: string) => parseIntent(text).chips.map((c) => `${c.key}:${c.value}`);

describe("parseIntent", () => {
  it("reads domains, failures, outcomes and stacks out of a sentence", () => {
    expect(chips("medical evaluations where the agent was corrected and recovered")).toEqual([
      "domain:medical",
      "failure:user_correction",
      "outcome:recovered",
    ]);
    expect(chips("Rust retry loops with tests passing")).toEqual([
      "language:Rust",
      "failure:retry_loop",
      "outcome:tests_passed",
    ]);
    expect(chips("sql warehouse sessions, signals only")).toEqual([
      "domain:data_querying",
      "tier:1",
    ]);
    expect(chips("FastAPI test tampering")).toEqual([
      "framework:FastAPI",
      "failure:test_tampering",
    ]);
  });

  it("prefers the longest phrase, and keeps the first value of a single facet", () => {
    expect(chips("stuck in a retry loop")).toEqual(["failure:retry_loop"]);
    expect(chips("clinical evaluation")).toEqual(["domain:medical"]);
    const p = parseIntent("medical legal contracts");
    expect(p.chips.map((c) => c.value)).toEqual(["medical"]);
    expect(p.rest).toBe("legal contracts");
  });

  it("finds behaviours, and leaves unknown words as free text without stop words", () => {
    const p = parseIntent("long sessions where the agent repeats the same command, deadlock");
    expect(p.chips.map((c) => `${c.key}:${c.value}`)).toEqual([
      "behaviour:long",
      "behaviour:repeats",
    ]);
    expect(p.rest).toBe("deadlock");
  });

  it("doesn't read short language names out of ordinary words", () => {
    expect(chips("go to the checkout and see why it failed")).not.toContain("language:Go");
    expect(chips("golang worker pool")).toContain("language:Go");
  });

  it("returns nothing for plain words", () => {
    expect(parseIntent("timezone parsing").chips).toEqual([]);
    expect(parseIntent("timezone parsing").rest).toBe("timezone parsing");
  });
});

describe("resolveQuery", () => {
  it("merges chips into the query, with explicit filters winning", () => {
    const r = resolveQuery({ text: "medical retry loops", failure: "tool_error" });
    expect(r.query.domain).toBe("medical");
    expect(r.query.failure).toBe("tool_error");
    expect(r.overridden.map((c) => c.value)).toEqual(["retry_loop"]);
    expect(resolveQuery({ text: "medical", parse: false }).query.domain).toBeUndefined();
  });

  it("makes intent searches demand for what they ask", () => {
    expect(criteriaOf({ text: "medical corrections" })).toEqual({
      domain: "medical",
      failure: "user_correction",
    });
    expect(criteriaOf({ text: "deadlock" })).toEqual({});
  });
});

const NOW = new Date("2026-10-15T12:00:00Z");
let db: Db;
let deps: CatalogDeps & { search: NonNullable<CatalogDeps["search"]> };
let buyer: PublicUser;

beforeEach(async () => {
  db = openDb(":memory:");
  runMigrations(db);
  deps = {
    config: loadConfig(),
    bus: createDbEventBus(db),
    blobs: createMemoryBlobStore(),
    search: createSqliteSearchIndex(db),
    now: NOW,
  };
  const seller = await ensureAccount(db, "s@example.com", "seller", "S");
  const traces = [
    ...generateCatalog(3, 80, NOW),
    ...generateFlood(4, 4, NOW, { domain: "medical", pattern: "user_correction" }),
  ];
  for (const trace of traces)
    await shareTrace(
      db,
      deps,
      { sellerId: seller.id, trace, tier: 0 },
      { allowSynthetic: true, deferMarket: true },
    );
  repriceAll(db, { ...deps, reason: "seed" });
  await rebuildSearchIndex(db, deps.blobs, deps.search);
  buyer = await ensureAccount(db, "lab@example.com", "buyer", "Lab");
});

describe("intent search", () => {
  it("turns a sentence into hard filters and says why each result matched", async () => {
    const r = await browseCatalog(db, deps, {
      text: "clinical evaluations where the agent was corrected",
    });
    expect(r.intent!.chips.map((c) => c.key)).toEqual(["domain", "failure"]);
    expect(r.total).toBeGreaterThanOrEqual(4);
    for (const i of r.items) {
      expect(i.domain).toBe("medical");
      expect(i.failures).toContain("user_correction");
      expect(i.reasons![0]).toMatch(/^Domain: Medical and clinical evaluation \(\d+% sure\)/);
      expect(i.reasons!.join(" ")).toMatch(/User corrected it: \d+ events? of evidence/);
    }
    const scores = r.items.map((i) => i.score!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("never lets leftover words empty out what the facets asked for", async () => {
    const r = await browseCatalog(db, deps, { text: "medical zzzunknownword" });
    expect(r.total).toBeGreaterThan(0);
    expect(r.intent!.restIgnored).toBe(true);
    // Words alone still filter.
    expect((await browseCatalog(db, deps, { text: "zzzunknownword" })).total).toBe(0);
  });

  it("filters by behaviour, from the session's shape", async () => {
    const r = await browseCatalog(db, deps, { text: "long sessions" });
    expect(r.total).toBeGreaterThan(0);
    for (const i of r.items) expect(i.turns).toBeGreaterThanOrEqual(100);
  });

  it("groups sessions of the same shape, and can show them all", async () => {
    const all = await browseCatalog(db, deps, { limit: 500 });
    const grouped = await browseCatalog(db, deps, { limit: 500, group: true });
    const shapes = new Set(all.items.map((i) => i.shapeKey));
    expect(grouped.total).toBe(shapes.size);
    expect(grouped.items.reduce((s, i) => s + 1 + (i.similar ?? 0), 0)).toBe(all.total);
  });

  it("keeps content out of signed-out searches", async () => {
    const r = await browseCatalog(db, deps, { text: "rubric", includeContent: false });
    const signedIn = await browseCatalog(db, deps, { text: "rubric", includeContent: true });
    expect(signedIn.total).toBeGreaterThan(r.total);
  });
});

describe("saved searches", () => {
  it("saves a search as save-strength demand, lists it and deletes it", () => {
    const s = saveSearch(db, deps, buyer, { query: { text: "medical corrections", tier: 0 } });
    expect(s.name).toBe(describeQuery(s.query));
    expect(s.name).toBe("open source · “medical corrections”");
    expect(listSavedSearches(db, buyer.buyerOrgId!).map((x) => x.id)).toEqual([s.id]);
    const signal = db.select().from(schema.demandSignals).all().at(-1)!;
    expect(signal.kind).toBe("save");
    expect(signal.criteria).toEqual({
      domain: "medical",
      failure: "user_correction",
      tier: undefined,
    });
    expect(deleteSavedSearch(db, buyer.buyerOrgId!, s.id)).toBe(true);
    expect(listSavedSearches(db, buyer.buyerOrgId!)).toEqual([]);
  });

  it("refuses sellers and empty searches, and another org's delete", async () => {
    const seller = await ensureAccount(db, "s@example.com", "seller", "S");
    expect(() => saveSearch(db, deps, seller, { query: { domain: "medical" } })).toThrow(
      SavedSearchError,
    );
    expect(() => saveSearch(db, deps, buyer, { query: {} })).toThrow(SavedSearchError);
    const s = saveSearch(db, deps, buyer, { query: { domain: "legal" } });
    expect(deleteSavedSearch(db, "org_other", s.id)).toBe(false);
  });

  it("saves facet-only searches that carry no demand, with model and source", () => {
    const before = db.select().from(schema.demandSignals).all().length;
    const s = saveSearch(db, deps, buyer, {
      query: { authenticity: "consistent", tier: 1, model: "claude-opus-5-5", source: "real" },
    });
    expect(s.query).toEqual({
      authenticity: "consistent",
      tier: 1,
      model: "claude-opus-5-5",
      source: "real",
    });
    expect(s.name).toContain("claude-opus-5-5");
    // A model is demand; the rest isn't, but the search is still saved.
    expect(db.select().from(schema.demandSignals).all().length).toBe(before + 1);
    const t = saveSearch(db, deps, buyer, { query: { outcome: "recovered" } });
    expect(t.id).toBeDefined();
  });

  it("keeps at most the configured number of saved searches", () => {
    for (let i = 0; i < MAX_SAVED_SEARCHES; i++)
      saveSearch(db, deps, buyer, { query: { text: `search ${i}` } });
    expect(() => saveSearch(db, deps, buyer, { query: { text: "one more" } })).toThrow(
      /Delete one/,
    );
  });
});

describe("intentWords", () => {
  it("tokenises like the parser, so a chip's words can be taken out", () => {
    expect(intentWords("Open-source, medical. traces")).toEqual(
      ["open", "source,", "medical", "traces"].map((w) => w.replace(",", "")),
    );
  });
});
