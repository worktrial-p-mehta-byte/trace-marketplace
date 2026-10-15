import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { detectAdapter, parseClaudeCodeSession } from "@tm/adapters";

/**
 * Parse real session files locally and print structure only (counts, event
 * types, tools used). Never prints message text or tool output, so it is
 * safe to run on private sessions and share the output.
 *
 *   pnpm inspect:sessions ~/Desktop/tm-sessions
 *   pnpm inspect:sessions path/to/one.jsonl other.jsonl
 */
const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: pnpm inspect:sessions <file-or-folder> [...]");
  process.exit(1);
}

const files = args.flatMap((a) =>
  statSync(a).isDirectory()
    ? readdirSync(a)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(a, f))
    : [a],
);

let ok = 0;
for (const file of files) {
  const contents = readFileSync(file, "utf8");
  const adapter = detectAdapter(basename(file), contents);
  console.log(`\n${basename(file)} (${(contents.length / 1024).toFixed(0)} KB)`);
  if (!adapter) {
    console.log("  no adapter recognised this file");
    continue;
  }
  const r = parseClaudeCodeSession(contents, { fileName: basename(file) });
  console.log(
    `  lines ${r.stats.lines}, malformed ${r.stats.malformed}, sidechain ${r.stats.sidechain}, meta ${r.stats.meta}`,
  );
  if (Object.keys(r.stats.ignoredTypes).length) {
    console.log(`  ignored line types: ${JSON.stringify(r.stats.ignoredTypes)}`);
  }
  for (const w of r.warnings.slice(0, 3)) console.log(`  warning: line ${w.line}: ${w.message}`);
  for (const t of r.traces) {
    const byType: Record<string, number> = {};
    const tools: Record<string, number> = {};
    let errors = 0;
    let interrupts = 0;
    for (const e of t.events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (e.type === "tool_call") tools[e.tool] = (tools[e.tool] ?? 0) + 1;
      if (e.type === "tool_result" && e.isError) errors++;
      if (e.type === "user_message" && e.interrupted) interrupts++;
    }
    const mins = (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 60000;
    console.log(
      `  trace ${t.id}: ${t.events.length} events over ${mins.toFixed(0)} min, model ${t.provenance.model.id}, harness ${t.provenance.harness.version ?? "?"}`,
    );
    console.log(`    events ${JSON.stringify(byType)}`);
    console.log(`    tools  ${JSON.stringify(tools)}`);
    console.log(
      `    tool errors ${errors}, interrupts ${interrupts}, has title ${Boolean(t.title)}`,
    );
    ok++;
  }
}
console.log(`\n${ok} trace(s) parsed from ${files.length} file(s).`);
