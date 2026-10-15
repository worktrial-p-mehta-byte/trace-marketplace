import type { Label, Trace, TraceEvent } from "@tm/schema";

/** Produces labels from a scrubbed trace. */
export interface Labeler {
  readonly name: string;
  label(trace: Trace): Label[];
}

/**
 * Label codes. Failure codes are listed most to least valuable to buyers;
 * the first one present becomes the trace's primary failure category.
 */
export const FAILURE_CODES = [
  "test_tampering", // agent tried to delete or weaken a failing test
  "retry_loop", // same tool failing repeatedly in a row
  "user_correction", // user told the agent it was wrong
  "tool_rejected", // user rejected a proposed action
  "user_interrupt", // user stopped the agent mid-action
  "tool_error", // any tool error
  "harness_error", // API errors and other harness notices
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export const OUTCOME_CODES = [
  "tests_passed_at_end",
  "tests_failed_at_end",
  "recovered",
  "unresolved",
] as const;

export const SIGNAL_CODES = ["context_compaction", "long_session", "no_model_output"] as const;

const CORRECTION_START =
  /^\s*(?:no\b|nope\b|don'?t\b|do not\b|stop\b|wait\b|wrong\b|undo\b|revert\b|actually\b|that'?s (?:not|wrong|incorrect)\b|that is (?:not|wrong)\b|this is wrong\b|you (?:broke|deleted|removed|changed)\b|why did you\b)/i;
const CORRECTION_ANYWHERE =
  /\b(?:not what i (?:asked|wanted|meant)|that'?s not right|you misunderstood|i didn'?t ask (?:you )?to)\b/i;

const TEST_COMMAND =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:pytest|vitest|jest|mocha|rspec|phpunit)\b|\bcargo\s+test\b|\bgo\s+test\b|\bmvn\s+test\b|\bgradle\w*\s+test\b|\bdotnet\s+test\b|\bmix\s+test\b|\bmake\s+test\b/i;
const TEST_FAIL =
  /\b(?:\d+\s+fail(?:ed|ing|ures?)?|FAIL\b|failures?:\s*[1-9]|tests? failed|error\[|panicked)/i;
const TEST_PASS = /\b(?:\d+\s+pass(?:ed|ing)?|all tests pass|ok\b|PASS\b|0 fail)/i;

const TEST_FILE =
  /(?:^|[/\\])(?:tests?|__tests__|spec)[/\\]|[._-](?:test|spec)\.[a-z]+$|_test\.(?:go|py)$|^test_.*\.py$/i;
const ASSERTION = /\b(?:expect|assert\w*|should|t\.Error|t\.Fatal|assert_eq!?)\b/;

export function isCorrection(text: string): boolean {
  return CORRECTION_START.test(text) || CORRECTION_ANYWHERE.test(text);
}

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

/** Did a test run pass? Errors win; otherwise look for explicit failure text. */
export function testRunPassed(output: string, isError: boolean): boolean {
  if (isError) return false;
  if (TEST_FAIL.test(output) && !/\b0 fail(?:ed|ures?)?\b/i.test(output)) return false;
  return TEST_PASS.test(output) || output.trim().length > 0;
}

/** An edit to a test file that removes assertions (old text has them, new text doesn't). */
function isTestTampering(e: TraceEvent): boolean {
  if (e.type !== "tool_call" || !e.input || typeof e.input !== "object") return false;
  const input = e.input as Record<string, unknown>;
  const path = input.file_path ?? input.path;
  if (typeof path !== "string" || !TEST_FILE.test(path)) return false;
  const oldText = typeof input.old_string === "string" ? input.old_string : undefined;
  const newText =
    typeof input.new_string === "string"
      ? input.new_string
      : typeof input.content === "string"
        ? input.content
        : undefined;
  if (oldText === undefined || newText === undefined) return false;
  const before = (oldText.match(new RegExp(ASSERTION, "g")) ?? []).length;
  const after = (newText.match(new RegExp(ASSERTION, "g")) ?? []).length;
  return before > 0 && after < before;
}

function label(kind: Label["kind"], code: string, evidence: number[], confidence: number): Label {
  return { kind, code, confidence, source: "heuristic", evidence };
}

export interface TraceAnalysis {
  labels: Label[];
  /** Corrections or rejections followed by a new agent attempt. */
  preferencePairs: number;
  toolCalls: number;
  toolErrors: number;
  userCorrections: number;
  interrupts: number;
  testsRanAtEnd: boolean;
  testsPassedAtEnd: boolean;
  hadFailure: boolean;
  recovered: boolean;
  primaryFailure?: FailureCode;
}

/**
 * Heuristic labeler. Reads only event structure and short text patterns,
 * so it runs in the browser on the scrubbed trace before anything uploads.
 */
export function analyzeTrace(trace: Trace): TraceAnalysis {
  const ev = trace.events;
  const calls = new Map<string, Extract<TraceEvent, { type: "tool_call" }>>();
  const evidence = {
    toolError: [] as number[],
    rejected: [] as number[],
    interrupt: [] as number[],
    correction: [] as number[],
    tampering: [] as number[],
    harness: [] as number[],
    retryLoop: [] as number[],
    compaction: [] as number[],
  };
  let lastTest: { seq: number; passed: boolean } | undefined;
  let sawAgentAction = false;
  let errorStreak: { tool: string; seqs: number[] } | undefined;

  for (const e of ev) {
    switch (e.type) {
      case "tool_call":
        calls.set(e.callId, e);
        sawAgentAction = true;
        if (isTestTampering(e)) evidence.tampering.push(e.seq);
        break;
      case "assistant_message":
        sawAgentAction = true;
        break;
      case "tool_result": {
        const call = calls.get(e.callId);
        if (e.rejected) evidence.rejected.push(e.seq);
        else if (e.isError) evidence.toolError.push(e.seq);
        // Retry loop: the same tool failing 3+ times in a row.
        if (e.isError && !e.rejected && call) {
          if (errorStreak && errorStreak.tool === call.tool) errorStreak.seqs.push(e.seq);
          else errorStreak = { tool: call.tool, seqs: [e.seq] };
          if (errorStreak.seqs.length === 3) evidence.retryLoop.push(...errorStreak.seqs);
          else if (errorStreak.seqs.length > 3) evidence.retryLoop.push(e.seq);
        } else if (!e.isError) {
          errorStreak = undefined;
        }
        const cmd =
          call?.input && typeof call.input === "object"
            ? (call.input as Record<string, unknown>).command
            : undefined;
        if (typeof cmd === "string" && isTestCommand(cmd)) {
          lastTest = { seq: e.seq, passed: testRunPassed(e.output, e.isError) };
        }
        break;
      }
      case "user_message":
        if (e.interrupted) evidence.interrupt.push(e.seq);
        else if (sawAgentAction && isCorrection(e.text)) evidence.correction.push(e.seq);
        break;
      case "system":
        if (e.kind === "compaction") evidence.compaction.push(e.seq);
        if (e.kind === "harness_message" && /error|overloaded|rate limit/i.test(e.text ?? "")) {
          evidence.harness.push(e.seq);
        }
        break;
    }
  }

  // Preference pair: a correction or rejection that the agent then acts on.
  const feedback = [...evidence.correction, ...evidence.rejected].sort((a, b) => a - b);
  let preferencePairs = 0;
  for (const seq of feedback) {
    if (ev.some((e) => e.seq > seq && (e.type === "tool_call" || e.type === "assistant_message"))) {
      preferencePairs++;
    }
  }

  const labels: Label[] = [];
  const add = (code: FailureCode, seqs: number[], conf: number) => {
    if (seqs.length) labels.push(label("failure", code, seqs, conf));
  };
  add("test_tampering", evidence.tampering, 0.8);
  add("retry_loop", evidence.retryLoop, 0.9);
  add("user_correction", evidence.correction, 0.7);
  add("tool_rejected", evidence.rejected, 0.95);
  add("user_interrupt", evidence.interrupt, 0.95);
  add("tool_error", evidence.toolError, 0.95);
  add("harness_error", evidence.harness, 0.9);

  const hadFailure = labels.some((l) => l.kind === "failure" && l.code !== "harness_error");
  const lastErrorSeq = Math.max(
    -1,
    ...evidence.toolError,
    ...evidence.rejected,
    ...evidence.correction,
    ...evidence.interrupt,
  );
  const testsRanAtEnd = lastTest !== undefined && lastTest.seq > lastErrorSeq;
  const testsPassedAtEnd = testsRanAtEnd && lastTest!.passed;
  const endsWithAgent = ev.at(-1)?.type === "assistant_message";
  const recovered =
    hadFailure &&
    (testsPassedAtEnd ||
      (endsWithAgent &&
        ev.some((e) => e.type === "tool_result" && !e.isError && e.seq > lastErrorSeq)));

  if (lastTest) {
    labels.push(
      label(
        "outcome",
        lastTest.passed ? "tests_passed_at_end" : "tests_failed_at_end",
        [lastTest.seq],
        0.8,
      ),
    );
  }
  if (recovered) labels.push(label("outcome", "recovered", [], 0.7));
  else if (hadFailure) labels.push(label("outcome", "unresolved", [], 0.6));

  if (evidence.compaction.length) {
    labels.push(label("signal", "context_compaction", evidence.compaction, 1));
  }
  const conversational = ev.filter((e) => e.type !== "system").length;
  if (conversational >= 100) labels.push(label("signal", "long_session", [], 1));
  if (!ev.some((e) => e.type === "assistant_message" || e.type === "tool_call")) {
    labels.push(label("signal", "no_model_output", [], 1));
  }

  const primaryFailure = FAILURE_CODES.find(
    (c) => c !== "harness_error" && labels.some((l) => l.code === c),
  );

  return {
    labels,
    preferencePairs,
    toolCalls: calls.size,
    toolErrors: evidence.toolError.length + evidence.rejected.length,
    userCorrections: evidence.correction.length,
    interrupts: evidence.interrupt.length,
    testsRanAtEnd,
    testsPassedAtEnd,
    hadFailure,
    recovered,
    primaryFailure,
  };
}

export const heuristicLabeler: Labeler = {
  name: "heuristic-v1",
  label: (trace) => analyzeTrace(trace).labels,
};
