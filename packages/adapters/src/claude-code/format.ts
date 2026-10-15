/**
 * The subset of the Claude Code session log format (one JSON object per
 * line in ~/.claude/projects/<project>/<session>.jsonl) that the adapter
 * reads. Fields are optional on purpose: the format is not a stable public
 * contract, so the adapter tolerates missing or extra fields and unknown
 * line types rather than failing the whole session.
 *
 * Checked against real logs from Claude Code 2.1.x, which add many line
 * types (attachment, api-request*, cost-state, mode, ai-title, ...).
 */

export interface CCTextBlock {
  type: "text";
  text: string;
}
export interface CCToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input?: unknown;
}
export interface CCToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}
export interface CCThinkingBlock {
  type: "thinking" | "redacted_thinking";
}
export interface CCImageBlock {
  type: "image";
}
export type CCContentBlock =
  | CCTextBlock
  | CCToolUseBlock
  | CCToolResultBlock
  | CCThinkingBlock
  | CCImageBlock
  | { type: string };

export interface CCUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface CCLine {
  type?: string; // "user" | "assistant" | "system" | "summary" | "ai-title" | other
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  version?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  subtype?: string;
  content?: string;
  summary?: string;
  aiTitle?: string;
  cwd?: string;
  gitBranch?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: string | CCContentBlock[];
    usage?: CCUsage;
  };
}

/** Marker text Claude Code writes when the user interrupts the agent. */
export const INTERRUPT_PREFIX = "[Request interrupted by user";

/** Text Claude Code returns as a tool result when the user rejects a tool call. */
export const REJECTION_MARKERS = [
  "The user doesn't want to proceed with this tool use",
  "The user doesn't want to take this action",
];

/** Model name Claude Code uses for messages it writes itself (errors, notices). */
export const SYNTHETIC_MODEL = "<synthetic>";

/** System line subtypes that are bookkeeping, not part of the conversation. */
export const IGNORED_SYSTEM_SUBTYPES = new Set(["turn_duration", "away_summary"]);
