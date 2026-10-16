import type { Trace, TraceEvent } from "@tm/schema";

type Call = Extract<TraceEvent, { type: "tool_call" }>;
type Result = Extract<TraceEvent, { type: "tool_result" }>;

/** One step in the condensed timeline. Tool calls are merged with their results. */
type Step =
  | { kind: "you"; seq: number; interrupted: boolean }
  | { kind: "agent"; seq: number }
  | {
      kind: "tool";
      seq: number;
      resultSeq?: number;
      tool: string;
      status: "ok" | "error" | "rejected" | "none";
    }
  | { kind: "system"; seq: number; label: string };

function stepsOf(trace: Trace): Step[] {
  const results = new Map<string, Result>();
  for (const e of trace.events) if (e.type === "tool_result") results.set(e.callId, e);
  const steps: Step[] = [];
  for (const e of trace.events) {
    switch (e.type) {
      case "user_message":
        steps.push({ kind: "you", seq: e.seq, interrupted: Boolean(e.interrupted) });
        break;
      case "assistant_message":
        steps.push({ kind: "agent", seq: e.seq });
        break;
      case "tool_call": {
        const r = results.get((e as Call).callId);
        const status = !r ? "none" : r.rejected ? "rejected" : r.isError ? "error" : "ok";
        steps.push({ kind: "tool", seq: e.seq, resultSeq: r?.seq, tool: e.tool, status });
        break;
      }
      case "system":
        if (e.kind === "compaction")
          steps.push({ kind: "system", seq: e.seq, label: "context compacted" });
        else if (e.kind === "harness_message")
          steps.push({ kind: "system", seq: e.seq, label: "API error" });
        break;
    }
  }
  return steps;
}

function minutes(trace: Trace): string {
  const m = Math.round((Date.parse(trace.endedAt) - Date.parse(trace.startedAt)) / 60_000);
  if (!Number.isFinite(m) || m <= 0) return "under a minute";
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * The structure of a session without its content: what a signals-only buyer
 * gets, and what anyone not allowed to read the content sees. Counts first,
 * then the session as a row of steps, with failures marked.
 */
export function SignalsView({
  trace,
  highlight,
  counts = true,
}: {
  trace: Trace;
  highlight?: number[];
  /** Show the counts row (off where the page already shows the same numbers). */
  counts?: boolean;
}) {
  const marked = new Set(highlight ?? []);
  const steps = stepsOf(trace);
  const tools = new Map<string, number>();
  let errors = 0;
  let rejected = 0;
  for (const s of steps) {
    if (s.kind !== "tool") continue;
    tools.set(s.tool, (tools.get(s.tool) ?? 0) + 1);
    if (s.status === "error") errors++;
    if (s.status === "rejected") rejected++;
  }
  const you = steps.filter((s) => s.kind === "you").length;
  const interrupts = steps.filter((s) => s.kind === "you" && s.interrupted).length;
  const agent = steps.filter((s) => s.kind === "agent").length;
  const toolCalls = [...tools.values()].reduce((a, b) => a + b, 0);
  const stats: [string, string | number, boolean?][] = [
    ["Your messages", you],
    ["Agent messages", agent],
    ["Tool calls", toolCalls],
    ["Tool errors", errors, errors > 0],
    ["Rejected actions", rejected, rejected > 0],
    ["Interruptions", interrupts, interrupts > 0],
    ["Duration", minutes(trace)],
  ];

  return (
    <div className="space-y-5">
      {counts && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {stats.map(([label, value, alert]) => (
            <div key={label}>
              <dt className="text-xs text-ink-3">{label}</dt>
              <dd className={`text-lg font-semibold ${alert ? "text-brick" : ""}`}>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {tools.size > 0 && (
        <p className="text-sm text-ink-2">
          <span className="font-semibold text-ink">Tools used: </span>
          {[...tools]
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => `${t} ×${n}`)
            .join(" · ")}
        </p>
      )}

      <div>
        <p className="text-xs font-semibold text-ink-3">The session, step by step</p>
        <ol className="mt-2 flex flex-wrap gap-1.5" aria-label="Session steps">
          {steps.map((s) => {
            const on =
              marked.has(s.seq) ||
              (s.kind === "tool" && s.resultSeq !== undefined && marked.has(s.resultSeq));
            let cls = "border-rule bg-paper text-ink-2";
            let text = "";
            let title = "";
            if (s.kind === "you") {
              text = s.interrupted ? "You stopped it" : "You";
              title = s.interrupted ? "The user interrupted the agent" : "A message from the user";
              if (s.interrupted) cls = "border-brick bg-brick/10 text-brick";
            } else if (s.kind === "agent") {
              text = "Agent";
              title = "A message from the agent";
              cls = "border-rule bg-surface text-ink-3";
            } else if (s.kind === "tool") {
              text =
                s.status === "rejected"
                  ? `${s.tool} ✕ rejected`
                  : s.status === "error"
                    ? `${s.tool} ✕`
                    : s.tool;
              title =
                s.status === "rejected"
                  ? "The user rejected this tool call"
                  : s.status === "error"
                    ? "This tool call failed"
                    : "Tool call";
              if (s.status === "error" || s.status === "rejected")
                cls = "border-brick bg-brick/10 text-brick";
              else cls = "border-ink/20 bg-surface text-ink font-mono";
            } else {
              text = s.label;
              title = s.label;
              cls = "border-dashed border-rule text-ink-3";
            }
            return (
              <li
                key={s.seq}
                id={`e-${s.seq}`}
                title={title}
                className={`scroll-mt-24 rounded border px-1.5 py-0.5 text-xs ${cls} ${on ? "ring-2 ring-highlight" : ""}`}
              >
                {s.kind === "tool" && s.resultSeq !== undefined && (
                  <span id={`e-${s.resultSeq}`} className="scroll-mt-24" aria-hidden />
                )}
                {text}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-ink-3">
          Red steps failed, were rejected or were interrupted. Message text, commands, file names
          and tool output are not included.
        </p>
      </div>
    </div>
  );
}
