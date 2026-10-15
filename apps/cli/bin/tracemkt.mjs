#!/usr/bin/env node
// Thin launcher so `tracemkt` runs the TypeScript source via tsx.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");
const result = spawnSync(process.execPath, ["--import", "tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
