import type { TraceAdapter } from "../types";
import { HARNESS_NAME, parseClaudeCodeSession } from "./parse";

export { parseClaudeCodeSession, HARNESS_NAME } from "./parse";
export type { ParseReport, ParseWarning } from "./parse";

export const claudeCodeAdapter: TraceAdapter = {
  name: HARNESS_NAME,

  detect(fileName, firstLine) {
    if (!fileName.endsWith(".jsonl")) return false;
    try {
      const obj = JSON.parse(firstLine) as Record<string, unknown>;
      return (
        typeof obj === "object" &&
        obj !== null &&
        ("sessionId" in obj || obj.type === "summary" || "leafUuid" in obj)
      );
    } catch {
      return false;
    }
  },

  parse(fileName, contents) {
    return parseClaudeCodeSession(contents, { fileName }).traces;
  },
};
