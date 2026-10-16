import type { Label, Trace } from "@tm/schema";
import { isTestCommand } from "./labels";

/**
 * Authenticity, tiers 1 and 2: does a trace look like a real session
 * recorded by a harness, and do its parts agree with each other? Tier 1 is
 * well-formedness (sequence, timestamps, tool calls and results pair up).
 * Tier 2 is internal consistency (timing that a person and a model would
 * produce, label evidence that points at the right events, and, for
 * signals-only uploads, browser-reported traits that the structure allows).
 *
 * Structure only, so it runs on signals-only traces too, and in the browser.
 * Tiers 3 and 4 (replaying the session in a sandbox, exporting it as a
 * verifiable task) come later.
 */
export type AuthenticityLevel = "consistent" | "well_formed" | "flagged";

export interface AuthenticityCheck {
  id: string;
  tier: 1 | 2;
  passed: boolean;
  /** What was checked, or what failed, in plain words. */
  detail: string;
}

export interface Authenticity {
  level: AuthenticityLevel;
  /** Share of checks passed, 0..1. */
  score: number;
  checks: AuthenticityCheck[];
}

/** Traits a signals-only upload reports from the browser, checked against the structure. */
export interface ReportedTraits {
  userCorrections?: number;
  preferencePairs?: number;
  testsRanAtEnd?: boolean;
  testsPassedAtEnd?: boolean;
  recovered?: boolean;
  hadFailure?: boolean;
}

const MAX_SESSION_DAYS = 14;
/** Gaps between events this regular (relative spread) look generated, not recorded. */
const UNIFORM_TIMING_CV = 0.02;
const MIN_GAPS_FOR_TIMING = 8;

function check(id: string, tier: 1 | 2, passed: boolean, ok: string, bad: string) {
  return { id, tier, passed, detail: passed ? ok : bad };
}

export function checkAuthenticity(
  trace: Trace,
  opts: {
    now?: Date;
    labels?: Pick<Label, "kind" | "code" | "evidence">[];
    /** Signals-only: what the seller's browser reported. */
    reported?: ReportedTraits;
  } = {},
): Authenticity {
  const now = opts.now ?? new Date();
  const ev = trace.events;
  const checks: AuthenticityCheck[] = [];

  // ---- Tier 1: well-formed.
  const seqOk = ev.every((e, i) => e.seq === i);
  checks.push(
    check("sequence", 1, seqOk, "events are numbered in order", "event numbers skip or repeat"),
  );

  const times = ev.map((e) => (e.ts ? Date.parse(e.ts) : NaN));
  const stamped = times.filter((t) => Number.isFinite(t));
  const monotonic = stamped.every((t, i) => i === 0 || t >= stamped[i - 1]!);
  checks.push(
    check(
      "timestamps",
      1,
      stamped.length === ev.length && monotonic,
      "every event has a timestamp, in order",
      stamped.length < ev.length ? "some events have no timestamp" : "timestamps go backwards",
    ),
  );

  const start = Date.parse(trace.startedAt);
  const end = Date.parse(trace.endedAt);
  const slack = 60_000;
  const within =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start <= end &&
    end - start <= MAX_SESSION_DAYS * 86_400_000 &&
    end <= now.getTime() + slack &&
    stamped.every((t) => t >= start - slack && t <= end + slack);
  checks.push(
    check(
      "span",
      1,
      within,
      "events fall inside the session's start and end, which are in the past",
      end > now.getTime() + slack
        ? "the session ends in the future"
        : "events fall outside the session's start and end, or it runs implausibly long",
    ),
  );

  const calls = new Map<string, number>();
  const results = new Map<string, number>();
  for (const e of ev) {
    if (e.type === "tool_call") calls.set(e.callId, (calls.get(e.callId) ?? 0) + 1);
    if (e.type === "tool_result") results.set(e.callId, (results.get(e.callId) ?? 0) + 1);
  }
  const callSeq = new Map<string, number>();
  let orderOk = true;
  for (const e of ev) {
    if (e.type === "tool_call") callSeq.set(e.callId, e.seq);
    if (e.type === "tool_result") {
      const c = callSeq.get(e.callId);
      if (c === undefined || c > e.seq) orderOk = false;
    }
  }
  const dupIds = [...calls.values(), ...results.values()].some((n) => n > 1);
  const orphans = [...results.keys()].filter((id) => !calls.has(id)).length;
  const paired = !dupIds && orphans === 0 && orderOk;
  checks.push(
    check(
      "tool_pairs",
      1,
      paired,
      "every tool result follows its own call",
      dupIds
        ? "a tool call id is used twice"
        : orphans
          ? `${orphans} tool result${orphans > 1 ? "s have" : " has"} no call`
          : "a tool result comes before its call",
    ),
  );

  const hasModel = ev.some((e) => e.type === "assistant_message" || e.type === "tool_call");
  checks.push(
    check(
      "model_turns",
      1,
      hasModel,
      "the model replied or acted",
      "there are no model replies or actions",
    ),
  );

  // ---- Tier 2: internally consistent.
  // Gaps between distinct timestamps: one harness line can hold several
  // events (a reply and its tool calls) with the same time.
  const gaps: number[] = [];
  for (let i = 1; i < stamped.length; i++) {
    const g = stamped[i]! - stamped[i - 1]!;
    if (g > 0) gaps.push(g);
  }
  if (gaps.length >= MIN_GAPS_FOR_TIMING) {
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
    const cv = mean > 0 ? sd / mean : 0;
    checks.push(
      check(
        "timing",
        2,
        cv > UNIFORM_TIMING_CV,
        "the time between steps varies the way a real session does",
        "every step is the same length apart, which recorded sessions never are",
      ),
    );
  }

  const bySeq = new Map(ev.map((e) => [e.seq, e]));
  const wantType: Record<string, (string | undefined)[]> = {
    tool_error: ["tool_result"],
    retry_loop: ["tool_result"],
    tool_rejected: ["tool_result"],
    user_correction: ["user_message"],
    user_interrupt: ["user_message"],
    harness_error: ["system"],
    test_tampering: ["tool_call"],
  };
  const badEvidence = (opts.labels ?? [])
    .filter((l) => l.kind === "failure")
    .filter((l) =>
      l.evidence.some((seq) => {
        const e = bySeq.get(seq);
        const want = wantType[l.code];
        return !e || (want !== undefined && !want.includes(e.type));
      }),
    )
    .map((l) => l.code);
  if (opts.labels) {
    checks.push(
      check(
        "label_evidence",
        2,
        badEvidence.length === 0,
        "each label points at the kind of event it describes",
        `labels point at the wrong events: ${badEvidence.join(", ")}`,
      ),
    );
  }

  const r = opts.reported;
  if (r) {
    const userMessages = ev.filter((e) => e.type === "user_message" && !e.interrupted).length;
    const errors = ev.filter((e) => e.type === "tool_result" && e.isError).length;
    const interrupts = ev.filter((e) => e.type === "user_message" && e.interrupted).length;
    const problems: string[] = [];
    if ((r.userCorrections ?? 0) > Math.max(0, userMessages - 1))
      problems.push("more corrections than follow-up messages");
    if ((r.preferencePairs ?? 0) > (r.userCorrections ?? 0) + errors)
      problems.push("more preference pairs than corrections and rejections");
    if (r.recovered && !(r.hadFailure || errors || interrupts))
      problems.push("a recovery with no failure");
    // A checked outcome needs a tool call that could have run the check near the end.
    const lastCall = [...ev].reverse().find((e) => e.type === "tool_call");
    const lastResult = [...ev].reverse().find((e) => e.type === "tool_result");
    if (r.testsRanAtEnd && !lastCall) problems.push("a final check with no tool call");
    if (r.testsPassedAtEnd && lastResult?.type === "tool_result" && lastResult.isError)
      problems.push("a passing final check whose last result is an error");
    checks.push(
      check(
        "reported_traits",
        2,
        problems.length === 0,
        "what the seller's browser reported fits the session's structure",
        `reported traits don't fit the structure: ${problems.join("; ")}`,
      ),
    );
  }

  // Open source: a test outcome must come from a command that runs tests.
  const testRuns = ev.filter((e) => {
    if (e.type !== "tool_call") return false;
    const cmd = (e.input as Record<string, unknown> | undefined)?.command;
    return typeof cmd === "string" && isTestCommand(cmd);
  }).length;
  const outcome = (opts.labels ?? []).find(
    (l) => l.kind === "outcome" && l.code.startsWith("tests_"),
  );
  if (outcome && !r) {
    checks.push(
      check(
        "outcome_source",
        2,
        testRuns > 0,
        "the test outcome comes from a test command in the session",
        "a test outcome is claimed but no test command ran",
      ),
    );
  }

  const tier1 = checks.filter((c) => c.tier === 1);
  const passed = checks.filter((c) => c.passed).length;
  const level: AuthenticityLevel = !tier1.every((c) => c.passed)
    ? "flagged"
    : checks.every((c) => c.passed)
      ? "consistent"
      : "well_formed";
  return { level, score: Math.round((100 * passed) / checks.length) / 100, checks };
}
