import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { scanText } from "./secret-patterns";

// Scans every file git would commit (tracked + untracked, minus .gitignore).
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.startsWith("scripts/secret-patterns") && f !== "pnpm-lock.yaml");

const findings = files.flatMap((file) => {
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return []; // deleted in working tree
  }
  if (size > 5_000_000) return [];
  const text = readFileSync(file, "utf8");
  return scanText(file, text, file.startsWith("fixtures/"));
});

if (findings.length) {
  console.error("Possible secrets or unscrubbed data found:");
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}`);
  console.error(`\nIf a match is an intentional fake, add "tm-allow-secret" on that line.`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files).`);
