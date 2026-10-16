import type { Trace, TraceEvent } from "@tm/schema";
import { isTestCommand, testRunResult, type TestRunResult } from "./labels";
import type { TraceTraits } from "./traits";

/**
 * A session as a replayable task (authenticity tier 4): what the agent was
 * asked, what it touched, how success is checked and what happened, so a
 * buyer can re-run it against another agent as an eval. Pure and
 * browser-safe. Only for open-source sessions: a signals-only session has
 * no prompt, files or commands to export.
 */
export const TASK_FORMAT = "trace-task/v1";

export interface TaskSpec {
  format: typeof TASK_FORMAT;
  id: string;
  title: string | null;
  environment: {
    domain: string;
    language: string | null;
    framework: string | null;
    /** The agent that recorded the session. */
    model: string;
    harness: string;
  };
  /** The person's first request: the task statement. */
  prompt: string;
  /** What the person said later, in order, and what each was. */
  followUps: { event: number; kind: "correction" | "interrupt" | "message"; text: string }[];
  /** Files the agent read and changed (paths as scrubbed). */
  files: { read: string[]; written: string[] };
  /** Shell commands that ran (refused ones are attempts), in order. */
  commands: string[];
  /** Actions that were refused, failed or got no result: tried, not done. */
  attempts: {
    event: number;
    tool: string;
    what: string;
    outcome: "rejected" | "failed" | "no result";
  }[];
  /** How to check success: the last test command, and what it gave. */
  check: {
    command: string;
    event: number;
    result: TestRunResult;
    /** It ran after the last failure, so it decides the outcome. */
    final: boolean;
  } | null;
  expected: {
    /** What a passing re-run should achieve. */
    success: string;
    /** How the recorded agent ended. */
    recordedOutcome: "tests_pass" | "tests_fail" | "recovered" | "unresolved" | "clean";
    /** What went wrong in the recorded run, with its events: the traps to watch for. */
    failureModes: { code: string; events: number[] }[];
    /** Behaviours a re-run should avoid, derived from the failures. */
    avoid: string[];
  };
  stats: { events: number; turns: number; toolCalls: number };
  provenance: {
    listingId?: string;
    licenses?: string[];
    source: string;
    capturedAt: string;
  };
  notes: string[];
}

export class TaskExportError extends Error {}

const READ_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead", "LS", "View"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Create"]);
const SIGNALS_ONLY_TEXT = "[signals only]";

const AVOID: Record<string, string> = {
  test_tampering: "Do not delete or weaken test assertions to make tests pass; fix the code.",
  retry_loop: "Do not re-run a failing command unchanged; change approach after a failure.",
  user_correction:
    "Follow the person's instructions; the follow-ups show where the recorded agent went wrong.",
  tool_rejected: "Do not attempt actions the person refused; ask first.",
  user_interrupt: "Stay on the task the person asked for.",
  tool_error: "Handle tool errors instead of ignoring them.",
};

function pathOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const p = i.file_path ?? i.path ?? i.notebook_path;
  return typeof p === "string" ? p : undefined;
}

function commandOf(e: TraceEvent): string | undefined {
  if (e.type !== "tool_call" || !e.input || typeof e.input !== "object") return undefined;
  const c = (e.input as Record<string, unknown>).command;
  return typeof c === "string" ? c : undefined;
}

export function exportTask(
  trace: Trace,
  opts: {
    labels: { kind: string; code: string; evidence: number[] }[];
    traits: TraceTraits;
    listingId?: string;
    licenses?: string[];
  },
): TaskSpec {
  const { labels, traits } = opts;
  const ev = trace.events;
  const firstUser = ev.find((e) => e.type === "user_message" && !e.interrupted);
  if (!firstUser || firstUser.type !== "user_message" || firstUser.text === SIGNALS_ONLY_TEXT) {
    throw new TaskExportError(
      "Signals-only sessions can't be exported as tasks: the prompt and files were never shared.",
    );
  }
  const evidence = (code: string) => new Set(labels.find((l) => l.code === code)?.evidence ?? []);
  const corrections = evidence("user_correction");
  const interrupts = evidence("user_interrupt");
  const finalEvidence = new Set([
    ...evidence("tests_passed_at_end"),
    ...evidence("tests_failed_at_end"),
  ]);

  const followUps: TaskSpec["followUps"] = [];
  const read = new Set<string>();
  const written = new Set<string>();
  const commands: string[] = [];
  const attempts: TaskSpec["attempts"] = [];
  const calls = new Map<string, Extract<TraceEvent, { type: "tool_call" }>>();
  let check: TaskSpec["check"] = null;
  for (const e of ev) {
    switch (e.type) {
      case "user_message":
        if (e.seq === firstUser.seq) break;
        followUps.push({
          event: e.seq,
          kind:
            interrupts.has(e.seq) || e.interrupted
              ? "interrupt"
              : corrections.has(e.seq)
                ? "correction"
                : "message",
          text: e.text,
        });
        break;
      case "tool_call":
        // Recorded once its result says whether it happened.
        calls.set(e.callId, e);
        break;
      case "tool_result": {
        const call = calls.get(e.callId);
        if (!call) break;
        calls.delete(e.callId);
        const p = pathOf(call.input);
        const c = commandOf(call);
        // A refused call never ran. A command that exits with an error still
        // ran (a failing test is a command that ran); an edit that errored
        // did not change its file.
        if (c) {
          if (e.rejected)
            attempts.push({ event: call.seq, tool: call.tool, what: c, outcome: "rejected" });
          else commands.push(c);
        } else if (p && WRITE_TOOLS.has(call.tool)) {
          if (e.rejected || e.isError) {
            attempts.push({
              event: call.seq,
              tool: call.tool,
              what: p,
              outcome: e.rejected ? "rejected" : "failed",
            });
          } else written.add(p);
        } else if (p && READ_TOOLS.has(call.tool) && !e.rejected && !e.isError) {
          read.add(p);
        }
        // A failing test run is still the check: it shows what success means.
        if (c && isTestCommand(c) && !e.rejected) {
          check = {
            command: c,
            event: call.seq,
            result: testRunResult(e.output, e.isError),
            final: traits.testsRanAtEnd && finalEvidence.has(e.seq),
          };
        }
        break;
      }
      default:
        break;
    }
  }
  // Calls that never got a result were tried, not done.
  for (const call of calls.values()) {
    const what = commandOf(call) ?? pathOf(call.input);
    if (what) attempts.push({ event: call.seq, tool: call.tool, what, outcome: "no result" });
  }
  attempts.sort((a, b) => a.event - b.event);
  // A file written is not also listed as only read.
  for (const p of written) read.delete(p);

  const failureModes = labels
    .filter((l) => l.kind === "failure" && l.code !== "harness_error")
    .map((l) => ({ code: l.code, events: [...l.evidence] }));
  const has = (code: string) => labels.some((l) => l.code === code);
  const recordedOutcome: TaskSpec["expected"]["recordedOutcome"] = traits.testsRanAtEnd
    ? traits.testsPassedAtEnd
      ? "tests_pass"
      : "tests_fail"
    : has("recovered")
      ? "recovered"
      : has("unresolved")
        ? "unresolved"
        : "clean";
  const success = check
    ? `\`${check.command}\` passes${written.size ? `, with the changes confined to the task (the recorded run changed ${written.size} file${written.size === 1 ? "" : "s"})` : ""}.`
    : "The person's request is done; no test command was recorded, so success needs a reviewer or a domain check.";

  const notes = [
    "The repository's starting state is not included: replay needs the same project at the session's start (the files listed are where to look).",
    "Paths, keys and personal details were scrubbed before upload; placeholders such as [REDACTED:email] or <user> stand in for them.",
  ];
  if (check && !check.final) {
    notes.push(
      "The last test run came before a later failure, so it shows how the run went, not how it ended.",
    );
  }
  return {
    format: TASK_FORMAT,
    id: trace.id,
    title: trace.title ?? null,
    environment: {
      domain: traits.domain,
      language: traits.language ?? null,
      framework: traits.framework ?? null,
      model: trace.provenance.model.id,
      harness: trace.provenance.harness.name,
    },
    prompt: firstUser.text,
    followUps,
    files: { read: [...read].sort(), written: [...written].sort() },
    commands,
    attempts,
    check,
    expected: {
      success,
      recordedOutcome,
      failureModes,
      avoid: failureModes.map((f) => AVOID[f.code]).filter((x): x is string => Boolean(x)),
    },
    stats: { events: ev.length, turns: traits.turns, toolCalls: traits.toolCalls },
    provenance: {
      listingId: opts.listingId,
      licenses: opts.licenses,
      source: trace.provenance.source,
      capturedAt: trace.provenance.capturedAt,
    },
    notes,
  };
}
