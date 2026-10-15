import { claudeCodeAdapter } from "./claude-code";
import type { TraceAdapter } from "./types";

export type { TraceAdapter } from "./types";
export { claudeCodeAdapter, parseClaudeCodeSession } from "./claude-code";
export type { ParseReport, ParseWarning } from "./claude-code";

/** Adapters known to this build, in detection order. */
export const ADAPTERS: readonly TraceAdapter[] = [claudeCodeAdapter];

/** Pick the adapter for a file from its name and first non-empty line. */
export function detectAdapter(
  fileName: string,
  contents: string,
  adapters: readonly TraceAdapter[] = ADAPTERS,
): TraceAdapter | undefined {
  const firstLine = contents.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return adapters.find((a) => a.detect(fileName, firstLine));
}
