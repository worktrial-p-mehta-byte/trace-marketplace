import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import type { BlobStore } from "../ports";

/**
 * v0 BlobStore: files under one folder (data/blobs by default).
 * Production replaces it with S3 or R2 behind the same interface.
 */
export function createLocalBlobStore(root: string): BlobStore {
  const pathFor = (key: string) => {
    const p = normalize(join(root, key));
    if (!p.startsWith(normalize(root) + sep)) throw new Error(`Invalid blob key: ${key}`);
    return p;
  };
  return {
    async put(key, body) {
      const p = pathFor(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body, "utf8");
    },
    async get(key) {
      try {
        return await readFile(pathFor(key), "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

/** In-memory BlobStore for tests. */
export function createMemoryBlobStore(): BlobStore & { keys(): string[] } {
  const m = new Map<string, string>();
  return {
    async put(k, v) {
      m.set(k, v);
    },
    async get(k) {
      return m.get(k) ?? null;
    },
    async delete(k) {
      m.delete(k);
    },
    keys: () => [...m.keys()],
  };
}
