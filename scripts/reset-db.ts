import { loadServerConfig } from "@tm/config/server";
import { resetLocalData } from "./reset-data";

// Deletes the local SQLite database (and its WAL files) and the stored
// traces that belong to it. Other files in BLOB_DIR are left alone, so a
// shared or mistaken BLOB_DIR can't lose anything else.
// Run `pnpm db:reset` to delete and re-create it.
async function main() {
  const config = loadServerConfig();
  const { path } = config.database;
  const { blobsRemoved } = await resetLocalData(path, config.storage.blobPath);
  console.log(
    `Removed ${path} and its ${blobsRemoved} stored trace file${blobsRemoved === 1 ? "" : "s"} in ${config.storage.blobPath}`,
  );
}
main();
