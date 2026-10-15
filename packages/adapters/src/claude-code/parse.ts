import { Trace, TRACE_SCHEMA_VERSION, type TraceEvent } from "@tm/schema";
import { cyrb53 } from "../hash";
import {
  INTERRUPT_PREFIX,
  REJECTION_MARKERS,
  type CCContentBlock,
  type CCLine,
  type CCToolResultBlock,
} from "./format";

export const HARNESS_NAME = "claude-code";

export interface ParseWarning {
  line: number;
  message: string;
}

export interface ParseReport {
  traces: Trace[];
  warnings: ParseWarning[];
  /** Counts of input lines by what happened to them, for diagnostics. */
  stats: {
    lines: number;
    malformed: number;
    sidechain: number;
    meta: number;
    ignoredTypes: Record<string, number>;
  };
}

/** Event without seq; seq is assigned once all events for a session are known. */
type Pending = {
  [K in TraceEvent["type"]]: Omit<Extract<TraceEvent, { type: K }>, "seq">;
}[TraceEvent["type"]];

interface SessionAcc {
  sessionId: string;
  events: Pending[];
  timestamps: string[];
  models: string[];
  version?: string;
  title?: string;
}

const MAX_TOOL_OUTPUT = 20_000;

function isIso(ts: unknown): ts is string {
  return typeof ts === "string" && !Number.isNaN(Date.parse(ts));
}

function normalizeTs(ts: string): string {
  return new Date(ts).toISOString();
}

function toolResultText(block: CCToolResultBlock): string {
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`))
      .join("\n");
  }
  return "";
}

function truncate(s: string): string {
  return s.length > MAX_TOOL_OUTPUT
    ? `${s.slice(0, MAX_TOOL_OUTPUT)}\n…[truncated ${s.length - MAX_TOOL_OUTPUT} chars]`
    : s;
}

/** Slash commands and local command output are bookkeeping, not conversation. */
function isCommandText(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith("<command-name>") ||
    t.startsWith("<command-message>") ||
    t.startsWith("<local-command-stdout>") ||
    t.startsWith("<local-command-stderr>")
  );
}

function userEvents(content: string | CCContentBlock[] | undefined, ts?: string): Pending[] {
  if (content === undefined) return [];
  const blocks: CCContentBlock[] =
    typeof content === "string" ? [{ type: "text", text: content }] : content;
  const out: Pending[] = [];
  for (const b of blocks) {
    if (b.type === "text" && "text" in b) {
      const text = b.text;
      if (!text.trim()) continue;
      if (isCommandText(text)) {
        out.push({ type: "system", kind: "command", text, ts });
      } else if (text.startsWith(INTERRUPT_PREFIX)) {
        out.push({ type: "user_message", text, interrupted: true, ts });
      } else {
        out.push({ type: "user_message", text, ts });
      }
    } else if (b.type === "tool_result" && "tool_use_id" in b) {
      const output = toolResultText(b);
      const rejected = REJECTION_MARKERS.some((m) => output.includes(m));
      out.push({
        type: "tool_result",
        callId: b.tool_use_id,
        output: truncate(output),
        isError: Boolean(b.is_error) || rejected,
        ts,
      });
    } else if (b.type === "image") {
      out.push({ type: "user_message", text: "[image]", ts });
    }
  }
  return out;
}

function assistantEvents(content: string | CCContentBlock[] | undefined, ts?: string): Pending[] {
  if (content === undefined) return [];
  const blocks: CCContentBlock[] =
    typeof content === "string" ? [{ type: "text", text: content }] : content;
  const out: Pending[] = [];
  for (const b of blocks) {
    if (b.type === "text" && "text" in b) {
      if (b.text.trim()) out.push({ type: "assistant_message", text: b.text, ts });
    } else if (b.type === "tool_use" && "id" in b && "name" in b) {
      out.push({ type: "tool_call", callId: b.id, tool: b.name, input: b.input ?? {}, ts });
    }
    // Thinking blocks are skipped in v0: they are often redacted and not
    // part of what the seller sees in their transcript.
  }
  return out;
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/**
 * Parse a Claude Code session log into canonical traces (one per session id
 * found in the file). Never throws on bad input: malformed lines become
 * warnings and sessions without usable events are dropped.
 */
export function parseClaudeCodeSession(
  contents: string,
  opts: { fileName?: string; now?: Date } = {},
): ParseReport {
  const warnings: ParseWarning[] = [];
  const stats: ParseReport["stats"] = {
    lines: 0,
    malformed: 0,
    sidechain: 0,
    meta: 0,
    ignoredTypes: {},
  };
  const sessions = new Map<string, SessionAcc>();
  let pendingTitle: string | undefined;
  const fallbackId = opts.fileName ?? "unknown";

  const lines = contents.split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    stats.lines++;
    let line: CCLine;
    try {
      line = JSON.parse(raw) as CCLine;
    } catch {
      stats.malformed++;
      warnings.push({ line: i + 1, message: "Not valid JSON; skipped" });
      return;
    }
    if (typeof line !== "object" || line === null) {
      stats.malformed++;
      return;
    }

    if (line.type === "summary") {
      if (line.summary && !pendingTitle) pendingTitle = line.summary;
      return;
    }
    if (line.isSidechain) {
      stats.sidechain++; // sub-agent turns; kept out of the main timeline in v0
      return;
    }
    if (line.isMeta) {
      stats.meta++;
      return;
    }

    const sid = line.sessionId ?? fallbackId;
    let acc = sessions.get(sid);
    if (!acc) {
      acc = { sessionId: sid, events: [], timestamps: [], models: [] };
      sessions.set(sid, acc);
    }
    const ts = isIso(line.timestamp) ? normalizeTs(line.timestamp) : undefined;
    if (ts) acc.timestamps.push(ts);
    if (line.version && !acc.version) acc.version = line.version;

    switch (line.type) {
      case "user":
        if (line.isCompactSummary) {
          acc.events.push({ type: "system", kind: "compaction", ts });
        } else {
          acc.events.push(...userEvents(line.message?.content, ts));
        }
        break;
      case "assistant": {
        const model = line.message?.model;
        if (model && !model.startsWith("<")) acc.models.push(model);
        acc.events.push(...assistantEvents(line.message?.content, ts));
        break;
      }
      case "system":
        acc.events.push({
          type: "system",
          kind: line.subtype === "compact_boundary" ? "compaction" : (line.subtype ?? "system"),
          text: typeof line.content === "string" ? line.content : undefined,
          ts,
        });
        break;
      default: {
        const t = line.type ?? "(none)";
        stats.ignoredTypes[t] = (stats.ignoredTypes[t] ?? 0) + 1;
      }
    }
  });

  const now = (opts.now ?? new Date()).toISOString();
  const traces: Trace[] = [];
  for (const acc of sessions.values()) {
    // A session made only of bookkeeping is not worth sharing.
    if (!acc.events.some((e) => e.type === "user_message" || e.type === "assistant_message")) {
      continue;
    }
    const sorted = [...acc.timestamps].sort();
    const startedAt = sorted[0] ?? now;
    const endedAt = sorted.at(-1) ?? now;
    const candidate = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      id: `cc_${cyrb53(acc.sessionId)}`,
      title: pendingTitle,
      startedAt,
      endedAt,
      provenance: {
        source: "real" as const,
        harness: { name: HARNESS_NAME, version: acc.version },
        model: { id: mostCommon(acc.models) ?? "unknown", provider: "anthropic" },
        repo: { languages: [], frameworks: [] },
        capturedAt: endedAt,
      },
      events: acc.events.map((e, seq) => ({ ...e, seq })),
    };
    const parsed = Trace.safeParse(candidate);
    if (parsed.success) {
      traces.push(parsed.data);
    } else {
      warnings.push({
        line: 0,
        message: `Session ${candidate.id} failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      });
    }
  }
  return { traces, warnings, stats };
}
