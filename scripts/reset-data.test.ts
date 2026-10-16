import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, runMigrations } from "@tm/db";
import { resetLocalData } from "./reset-data";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tm-reset-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A migrated database whose one trace points at `traces/<id>.json`. */
function dbWithTrace(path: string, traceId: string) {
  const db = openDb(path);
  runMigrations(db);
  const c = db.$client;
  c.pragma("foreign_keys = OFF");
  c.prepare(
    `INSERT INTO traces (id, seller_id, schema_version, source, harness, model, started_at, ended_at,
       turn_count, tool_call_count, content_hash, blob_key, created_at)
     VALUES (?, 'u', 1, 'real', 'claude-code', 'm', 0, 0, 0, 0, ?, ?, 0)`,
  ).run(traceId, traceId, `traces/${traceId}.json`);
  c.close();
}

describe("resetLocalData", () => {
  it("removes only this database's blobs from a shared blob folder", async () => {
    const blobs = join(dir, "blobs");
    mkdirSync(join(blobs, "traces"), { recursive: true });
    dbWithTrace(join(dir, "scratch.db"), "trc_scratch");
    writeFileSync(join(blobs, "traces", "trc_scratch.json"), "{}");
    writeFileSync(join(blobs, "traces", "trc_dev.json"), "{}"); // another database's
    writeFileSync(join(blobs, "README"), "keep me");

    const r = await resetLocalData(join(dir, "scratch.db"), blobs);

    expect(r.blobsRemoved).toBe(1);
    expect(existsSync(join(dir, "scratch.db"))).toBe(false);
    expect(readdirSync(join(blobs, "traces"))).toEqual(["trc_dev.json"]);
    expect(existsSync(join(blobs, "README"))).toBe(true);
  });

  it("removes the blob folder only once it is empty", async () => {
    const blobs = join(dir, "blobs");
    mkdirSync(join(blobs, "traces"), { recursive: true });
    dbWithTrace(join(dir, "e2e.db"), "trc_a");
    writeFileSync(join(blobs, "traces", "trc_a.json"), "{}");

    await resetLocalData(join(dir, "e2e.db"), blobs);
    expect(existsSync(blobs)).toBe(false);
    expect(existsSync(dir)).toBe(true);
  });

  it("deletes nothing in the blob folder when the database is missing", async () => {
    writeFileSync(join(dir, "unrelated.txt"), "x");
    await resetLocalData(join(dir, "missing.db"), dir); // e.g. BLOB_DIR=.
    expect(readdirSync(dir)).toEqual(["unrelated.txt"]);
  });
});
