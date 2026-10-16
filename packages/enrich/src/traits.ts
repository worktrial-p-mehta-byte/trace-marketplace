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
