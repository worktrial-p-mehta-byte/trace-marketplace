import type { Label, Trace } from "@tm/schema";
import { detectFramework, detectLanguage } from "./detect";
import { detectDomains, type DomainId, type DomainScore } from "./domains";
import { analyzeTrace, type FailureCode } from "./labels";

/**
 * Traits the pricing policy reads. Extracted once per trace and stored,
 * so pricing never re-parses trace content.
 */
export interface TraceTraits {
  /** Conversational turns: user messages, agent messages and tool calls. */
  turns: number;
  toolCalls: number;
  toolErrors: number;
  userCorrections: number;
  interrupts: number;
  hadFailure: boolean;
  recovered: boolean;
  preferencePairs: number;
  /** A test command ran after the last failure, so the outcome is checkable. */
  testsRanAtEnd: boolean;
  testsPassedAtEnd: boolean;
  /** Any tool output was cut short by the adapter. */
  truncated: boolean;
  redactionDensity: number;
  language?: string;
  framework?: string;
  /** What the session was about (see domains.ts); "unknown" when unclear. */
  domain: DomainId;
  /** How sure the detector was of `domain`, 0..1. */
  domainConfidence: number;
  /** Share of evidence per domain, top three. A session can span domains. */
  domains: DomainScore[];
  failureCategory?: FailureCode;
  /** Different tools the agent used. */
  distinctTools: number;
  /** Share of tool calls that repeat an earlier call exactly (same tool and input), 0..1. */
  repeatRatio: number;
  /**
   * Fingerprint of the session's shape (event kinds, tools, errors, length
   * bucket), without any text. Equal for near-duplicate sessions, so pricing
   * can discount a seller listing the same session many times over.
   */
  shapeKey: string;
  model: string;
  modelDeprecated: boolean;
  capturedAt: string;
  durationMinutes: number;
  outputTokens?: number;
}

export interface ExtractOptions {
  /** Share of text redacted by the scrubber (from ScrubResult.stats.density). */
  redactionDensity?: number;
  /** Model ids considered deprecated (lowers freshness in pricing). */
  deprecatedModels?: string[];
}

export interface Enrichment {
  labels: Label[];
  traits: TraceTraits;
  /** Rarity bucket: language | framework | failure category | model. */
  comboKey: string;
}

export function comboKeyOf(
  t: Pick<TraceTraits, "language" | "framework" | "failureCategory" | "model">,
): string {
  return [t.language ?? "-", t.framework ?? "-", t.failureCategory ?? "none", t.model].join("|");
}

/** FNV-1a, 32 bit: a small, browser-safe hash for fingerprints (not for security). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Tool variety, repetition and a shape fingerprint, from structure alone. */
export function shapeTraits(
  trace: Trace,
): Pick<TraceTraits, "distinctTools" | "repeatRatio" | "shapeKey"> {
  const tools = new Set<string>();
  const seen = new Set<string>();
  let calls = 0;
  let repeats = 0;
  const shape: string[] = [];
  const errors = new Set<string>();
  for (const e of trace.events) {
    if (e.type === "tool_result" && e.isError) errors.add(e.callId);
  }
  for (const e of trace.events) {
    if (e.type === "tool_call") {
      calls++;
      tools.add(e.tool);
      const sig = `${e.tool}:${JSON.stringify(e.input ?? null)}`;
      if (seen.has(sig)) repeats++;
      seen.add(sig);
      shape.push(`${e.tool}${errors.has(e.callId) ? "!" : ""}`);
    } else if (e.type === "user_message") shape.push(e.interrupted ? "U!" : "U");
    else if (e.type === "assistant_message") shape.push("A");
  }
  // Runs collapse ("Read Read Read" is one step), so padding a session with
  // extra filler doesn't make a new shape; length is kept as a coarse bucket.
  const collapsed = shape.filter((x, i) => x !== shape[i - 1]);
  const bucket = Math.round(Math.log2(1 + shape.length));
  return {
    distinctTools: tools.size,
    repeatRatio: calls ? Math.round((100 * repeats) / calls) / 100 : 0,
    shapeKey: fnv1a(`${bucket}|${collapsed.join(" ")}`),
  };
}

/** Label a scrubbed trace and extract its pricing traits in one pass. */
export function enrichTrace(trace: Trace, opts: ExtractOptions = {}): Enrichment {
  const a = analyzeTrace(trace);
  const domain = detectDomains(trace);
  const turns = trace.events.filter(
    (e) => e.type === "user_message" || e.type === "assistant_message" || e.type === "tool_call",
  ).length;
  const truncated = trace.events.some(
    (e) => e.type === "tool_result" && /…\[truncated \d+ chars\]$/.test(e.output),
  );
  const model = trace.provenance.model.id;
  const traits: TraceTraits = {
    turns,
    toolCalls: a.toolCalls,
    toolErrors: a.toolErrors,
    userCorrections: a.userCorrections,
    interrupts: a.interrupts,
    hadFailure: a.hadFailure,
    recovered: a.recovered,
    preferencePairs: a.preferencePairs,
    testsRanAtEnd: a.testsRanAtEnd,
    testsPassedAtEnd: a.testsPassedAtEnd,
    truncated,
    redactionDensity: opts.redactionDensity ?? 0,
    language: trace.provenance.repo.languages[0] ?? detectLanguage(trace),
    framework: trace.provenance.repo.frameworks[0] ?? detectFramework(trace),
    domain: domain.primary,
    domainConfidence: domain.confidence,
    domains: domain.distribution,
    failureCategory: a.primaryFailure,
    ...shapeTraits(trace),
    model,
    modelDeprecated: (opts.deprecatedModels ?? []).includes(model),
    capturedAt: trace.provenance.capturedAt,
    durationMinutes: Math.max(0, (Date.parse(trace.endedAt) - Date.parse(trace.startedAt)) / 60000),
    outputTokens: trace.metrics?.outputTokens,
  };
  const labels: Label[] = [
    ...a.labels,
    {
      kind: "domain",
      code: domain.primary,
      confidence: domain.confidence,
      source: "heuristic",
      evidence: domain.evidence,
    },
  ];
  return { labels, traits, comboKey: comboKeyOf(traits) };
}
