import type { Trace, TraceEvent } from "@tm/schema";
import {
  customTermRules,
  HOST_RULES,
  PATH_RULES,
  PII_RULES,
  SECRET_RULES,
  tag,
  type Rule,
} from "./rules";

/** One redaction made by a scrubber stage, kept so the review screen can show it. */
export interface Redaction {
  stage: string;
  /** Category shown to the seller, e.g. "api_key", "email", "home_path". */
  kind: string;
  /** Event seq, or -1 for the trace title. */
  eventSeq: number;
  /** Length of the removed text (never the text itself). */
  length: number;
}

/**
 * A scrubber stage transforms text and reports what it removed. Stages run
 * in order; secrets come first and are zero-tolerance. An ML or LLM
 * scrubber later is just another stage.
 */
export interface ScrubStage {
  readonly name: string;
  scrubText(text: string): { text: string; hits: { kind: string; length: number }[] };
}

export interface ScrubOptions {
  /** Extra terms to hide, e.g. the seller's name or company. */
  customTerms?: string[];
  /** Skip optional stages (secrets can never be skipped). */
  disable?: Array<"pii" | "paths" | "hosts">;
}

export interface ScrubStats {
  redactions: number;
  byKind: Record<string, number>;
  /** Share of text characters that were redacted, 0..1 (a pricing quality signal). */
  density: number;
  totalChars: number;
}

export interface ScrubResult {
  trace: Trace;
  redactions: Redaction[];
  stats: ScrubStats;
}

export function ruleStage(name: string, rules: Rule[]): ScrubStage {
  return {
    name,
    scrubText(text) {
      const hits: { kind: string; length: number }[] = [];
      let out = text;
      for (const rule of rules) {
        out = out.replace(rule.re, (...args: unknown[]) => {
          const match = args[0] as string;
          const groups = args.slice(1, -2) as (string | undefined)[];
          const g = rule.group ?? 0;
          const secret = g === 0 ? match : groups[g - 1];
          if (secret === undefined || secret === "") return match;
          // Never re-redact an earlier rule's placeholder.
          if (secret.includes("[REDACTED:")) return match;
          if (rule.accept && !rule.accept(secret)) return match;
          hits.push({ kind: rule.kind, length: secret.length });
          const replacement = rule.replace ? rule.replace(secret) : tag(rule.kind);
          if (g === 0) return replacement;
          // Rules that select a group capture the whole match in consecutive
          // groups (see Rule), so rebuilding is a join with one group swapped.
          return groups.map((part, i) => (i === g - 1 ? replacement : (part ?? ""))).join("");
        });
      }
      return { text: out, hits };
    },
  };
}

export function buildStages(opts: ScrubOptions = {}): ScrubStage[] {
  const off = new Set(opts.disable ?? []);
  const stages = [ruleStage("secrets", SECRET_RULES)];
  if (!off.has("pii")) stages.push(ruleStage("pii", PII_RULES));
  if (!off.has("paths")) stages.push(ruleStage("paths", PATH_RULES));
  if (!off.has("hosts")) stages.push(ruleStage("hosts", HOST_RULES));
  const custom = customTermRules(opts.customTerms ?? []);
  if (custom.length) stages.push(ruleStage("custom", custom));
  return stages;
}

/** Walk any JSON value and scrub every string (keys are left as-is). */
function scrubValue(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, fn));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubValue(v, fn)]),
    );
  }
  return value;
}

function textLength(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + textLength(v), 0);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).reduce(
      (n: number, v) => n + textLength(v),
      0,
    );
  }
  return 0;
}

/**
 * Scrub every text field of a trace. Pure and browser-safe: the raw trace
 * goes in, a scrubbed copy and a list of redactions (kinds and lengths
 * only, never the removed text) come out.
 */
export function scrubTrace(trace: Trace, opts: ScrubOptions = {}): ScrubResult {
  const stages = buildStages(opts);
  const redactions: Redaction[] = [];
  let totalChars = 0;
  let redactedChars = 0;

  const scrubString = (s: string, eventSeq: number): string => {
    totalChars += s.length;
    let out = s;
    for (const stage of stages) {
      const r = stage.scrubText(out);
      for (const h of r.hits) {
        redactions.push({ stage: stage.name, kind: h.kind, eventSeq, length: h.length });
        redactedChars += h.length;
      }
      out = r.text;
    }
    return out;
  };

  const events: TraceEvent[] = trace.events.map((e) => {
    const fn = (s: string) => scrubString(s, e.seq);
    switch (e.type) {
      case "user_message":
      case "assistant_message":
        return { ...e, text: fn(e.text) };
      case "tool_call":
        return { ...e, input: scrubValue(e.input, fn) };
      case "tool_result":
        return { ...e, output: fn(e.output) };
      case "system":
        return e.text === undefined ? e : { ...e, text: fn(e.text) };
    }
  });

  const title = trace.title === undefined ? undefined : scrubString(trace.title, -1);

  const byKind: Record<string, number> = {};
  for (const r of redactions) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

  return {
    trace: { ...trace, title, events },
    redactions,
    stats: {
      redactions: redactions.length,
      byKind,
      density: totalChars === 0 ? 0 : Math.min(1, redactedChars / totalChars),
      totalChars,
    },
  };
}

/** Total text characters in a trace (exported for tests and diagnostics). */
export function traceTextLength(trace: Trace): number {
  return trace.events.reduce((n, e) => {
    switch (e.type) {
      case "tool_call":
        return n + textLength(e.input);
      case "tool_result":
        return n + e.output.length;
      case "system":
        return n + (e.text?.length ?? 0);
      default:
        return n + e.text.length;
    }
  }, 0);
}
