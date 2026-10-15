import { Trace, TRACE_SCHEMA_VERSION, type TraceEvent, type TraceMetrics } from "@tm/schema";
import { cyrb53 } from "../hash";
import {
  IGNORED_SYSTEM_SUBTYPES,
  INTERRUPT_PREFIX,
  REJECTION_MARKERS,
  SYNTHETIC_MODEL,
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
  /** Usage per model response; Claude Code repeats it on every line of a response. */
  usageByResponse: Map<string, NonNullable<NonNullable<CCLine["message"]>["usage"]>>;
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
    t.startsWith("<local-command-stderr>") ||
    t.startsWith("<local-command-caveat>")
  );
}

function blocksOf(content: string | CCContentBlock[] | undefined): CCContentBlock[] {
  if (content === undefined) return [];
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function userEvents(content: string | CCContentBlock[] | undefined, ts?: string): Pending[] {
  const out: Pending[] = [];
  for (const b of blocksOf(content)) {
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

function assistantEvents(
  content: string | CCContentBlock[] | undefined,
  synthetic: boolean,
  ts?: string,
): Pending[] {
  const out: Pending[] = [];
  for (const b of blocksOf(content)) {
    if (b.type === "text" && "text" in b) {
      if (!b.text.trim()) continue;
      // Messages Claude Code writes itself (API errors, notices) are not model output.
      out.push(
        synthetic
          ? { type: "system", kind: "harness_message", text: b.text, ts }
          : { type: "assistant_message", text: b.text, ts },
      );
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

function metricsOf(acc: SessionAcc): TraceMetrics | undefined {
  if (acc.usageByResponse.size === 0) return undefined;
  const m = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelResponses: acc.usageByResponse.size,
  };
  for (const u of acc.usageByResponse.values()) {
    m.inputTokens += u.input_tokens ?? 0;
    m.outputTokens += u.output_tokens ?? 0;
    m.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    m.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
  }
  return m;
}

function bump(stats: ParseReport["stats"], key: string): void {
  stats.ignoredTypes[key] = (stats.ignoredTypes[key] ?? 0) + 1;
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
  const fallbackId = opts.fileName ?? "unknown";
  // Titles: the latest ai-title line wins; otherwise the first summary line.
  const aiTitles = new Map<string, string>();
  let fileSummary: string | undefined;

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
    if (typeof line !== "object" || line === null || Array.isArray(line)) {
      stats.malformed++;
      return;
    }

    if (line.type === "summary") {
      if (line.summary && !fileSummary) fileSummary = line.summary;
      return;
    }
    if (line.type === "ai-title") {
      if (line.aiTitle) aiTitles.set(line.sessionId ?? fallbackId, line.aiTitle);
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
    if (line.type === "system" && line.subtype && IGNORED_SYSTEM_SUBTYPES.has(line.subtype)) {
      bump(stats, `system:${line.subtype}`);
      return;
    }
    if (line.type !== "user" && line.type !== "assistant" && line.type !== "system") {
      bump(stats, line.type ?? "(none)");
      return;
    }

    const sid = line.sessionId ?? fallbackId;
    let acc = sessions.get(sid);
    if (!acc) {
      acc = { sessionId: sid, events: [], timestamps: [], models: [], usageByResponse: new Map() };
      sessions.set(sid, acc);
    }
    const ts = isIso(line.timestamp) ? normalizeTs(line.timestamp) : undefined;
    if (ts) acc.timestamps.push(ts);
    if (line.version && !acc.version) acc.version = line.version;

    if (line.type === "user") {
      if (line.isCompactSummary) {
        acc.events.push({ type: "system", kind: "compaction", ts });
      } else {
        acc.events.push(...userEvents(line.message?.content, ts));
      }
    } else if (line.type === "assistant") {
      const model = line.message?.model;
      const synthetic = model === SYNTHETIC_MODEL;
      if (model && !synthetic) acc.models.push(model);
      const usage = line.message?.usage;
      if (usage && !synthetic) {
        acc.usageByResponse.set(line.message?.id ?? line.uuid ?? `line${i}`, usage);
      }
      acc.events.push(...assistantEvents(line.message?.content, synthetic, ts));
    } else {
      const kind =
        line.subtype === "compact_boundary"
          ? "compaction"
          : line.subtype === "local_command"
            ? "command"
            : (line.subtype ?? "system");
      acc.events.push({
        type: "system",
        kind,
        text: typeof line.content === "string" ? line.content : undefined,
        ts,
      });
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
      title: aiTitles.get(acc.sessionId) ?? fileSummary,
      startedAt,
      endedAt,
      provenance: {
        source: "real" as const,
        harness: { name: HARNESS_NAME, version: acc.version },
        model: { id: mostCommon(acc.models) ?? "unknown", provider: "anthropic" },
        repo: { languages: [], frameworks: [] },
        capturedAt: endedAt,
      },
      metrics: metricsOf(acc),
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
