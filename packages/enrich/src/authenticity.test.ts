import { describe, expect, it } from "vitest";
import type { Trace, TraceEvent } from "@tm/schema";
import { checkAuthenticity } from "./authenticity";
import { enrichTrace } from "./traits";

const NOW = new Date("2026-10-15T12:00:00Z");
const T0 = Date.parse("2026-10-15T10:00:00Z");

/** A recorded-looking session: uneven gaps, calls before results. */
function session(over: Partial<Trace> = {}, gaps?: number[]): Trace {
  const kinds: Omit<TraceEvent, "seq" | "ts">[] = [
    { type: "user_message", text: "fix the failing test" },
    { type: "assistant_message", text: "running it" },
    { type: "tool_call", callId: "a", tool: "Bash", input: { command: "pytest" } },
    { type: "tool_result", callId: "a", output: "1 failed", isError: true },
    {
      type: "tool_call",
      callId: "b",
      tool: "Edit",
      input: { file_path: "x.py", old_string: "a", new_string: "b" },
    },
    { type: "tool_result", callId: "b", output: "updated", isError: false },
    { type: "tool_call", callId: "c", tool: "Bash", input: { command: "pytest" } },
    { type: "tool_result", callId: "c", output: "3 passed", isError: false },
    { type: "assistant_message", text: "fixed" },
    { type: "user_message", text: "thanks" },
    { type: "assistant_message", text: "done" },
  ] as unknown as Omit<TraceEvent, "seq" | "ts">[];
  const g = gaps ?? [0, 12, 30, 4, 55, 2, 40, 9, 21, 70, 15];
  let t = T0;
  const events = kinds.map((k, i) => {
    t += g[i]! * 1000;
    return { ...k, seq: i, ts: new Date(t).toISOString() } as TraceEvent;
  });
  return {
    schemaVersion: 1,
    id: "s1",
    startedAt: events[0]!.ts!,
    endedAt: events.at(-1)!.ts!,
    provenance: {
      source: "real",
      harness: { name: "claude-code" },
      model: { id: "m" },
      repo: { languages: [], frameworks: [] },
      capturedAt: events.at(-1)!.ts!,
    },
    events,
    ...over,
  };
}

const failed = (t: Trace, opts = {}) =>
  checkAuthenticity(t, { now: NOW, ...opts })
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);

describe("checkAuthenticity", () => {
  it("passes a recorded-looking session, with its labels, as consistent", () => {
    const t = session();
    const { labels } = enrichTrace(t, { now: NOW });
    const a = checkAuthenticity(t, { now: NOW, labels });
    expect(a.level).toBe("consistent");
    expect(a.score).toBe(1);
    expect(a.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        "sequence",
        "timestamps",
        "span",
        "tool_pairs",
        "model_turns",
        "timing",
        "label_evidence",
        "outcome_source",
      ]),
    );
  });

  it("flags logs that are not well-formed (tier 1)", () => {
    const t = session();
    const reorder = {
      ...t,
      events: [t.events[0]!, t.events[3]!, ...t.events.slice(1, 3), ...t.events.slice(4)].map(
        (e, i) => ({ ...e, seq: i }),
      ),
    };
    expect(failed(reorder)).toContain("tool_pairs");
    expect(checkAuthenticity(reorder, { now: NOW }).level).toBe("flagged");
    const orphan = {
      ...t,
      events: t.events
        .filter((e) => !(e.type === "tool_call" && e.callId === "b"))
        .map((e, i) => ({ ...e, seq: i })),
    };
    expect(failed(orphan)).toEqual(["tool_pairs"]);
    const gap = { ...t, events: t.events.map((e) => (e.seq === 4 ? { ...e, seq: 40 } : e)) };
    expect(failed(gap)).toContain("sequence");
    const back = {
      ...t,
      events: t.events.map((e) => (e.seq === 5 ? { ...e, ts: t.startedAt } : e)),
    };
    expect(failed(back)).toContain("timestamps");
    const future = session({ endedAt: "2027-01-01T00:00:00Z" });
    expect(failed(future)).toContain("span");
    const silent = session({
      events: [{ seq: 0, type: "user_message", text: "hi", ts: new Date(T0).toISOString() }],
    });
    expect(failed(silent)).toContain("model_turns");
  });

  it("marks machine-regular timing as inconsistent (tier 2), not as broken", () => {
    const uniform = session({}, Array(11).fill(30));
    const a = checkAuthenticity(uniform, { now: NOW });
    expect(failed(uniform)).toEqual(["timing"]);
    expect(a.level).toBe("well_formed");
    // Events written in one go share a timestamp; that is not variation.
    const batched = session({}, [0, 30, 30, 0, 30, 30, 0, 30, 30, 30, 30]);
    expect(failed(batched)).toEqual(["timing"]);
  });

  it("checks label evidence points at the right kind of event", () => {
    const t = session();
    const labels = [{ kind: "failure" as const, code: "user_correction", evidence: [3] }]; // a tool result
    expect(failed(t, { labels })).toContain("label_evidence");
    expect(
      failed(t, { labels: [{ kind: "failure" as const, code: "tool_error", evidence: [99] }] }),
    ).toContain("label_evidence");
  });

  it("checks label evidence has the flags of its failure, not just the event type", () => {
    const t = session();
    const one = (code: string, evidence: number[]) => [
      { kind: "failure" as const, code, evidence },
    ];
    // Event 3 is a failed result, 5 a successful one; 9 a normal message.
    expect(failed(t, { labels: one("tool_error", [3]) })).not.toContain("label_evidence");
    expect(failed(t, { labels: one("tool_error", [5]) })).toContain("label_evidence");
    expect(failed(t, { labels: one("tool_rejected", [3]) })).toContain("label_evidence");
    expect(failed(t, { labels: one("user_interrupt", [9]) })).toContain("label_evidence");
    // A retry loop needs three failures of the same tool.
    expect(failed(t, { labels: one("retry_loop", [3]) })).toContain("label_evidence");
  });

  it("checks a test outcome comes from a test command", () => {
    const t = session();
    const noTests = {
      ...t,
      events: t.events.map((e) =>
        e.type === "tool_call" && e.tool === "Bash" ? { ...e, input: { command: "ls" } } : e,
      ),
    };
    const labels = [{ kind: "outcome" as const, code: "tests_passed_at_end", evidence: [7] }];
    expect(failed(noTests, { labels })).toContain("outcome_source");
  });

  it("checks a signals-only upload's reported traits against its structure", () => {
    const t = session();
    expect(failed(t, { reported: { userCorrections: 1, preferencePairs: 1 } })).toEqual([]);
    expect(failed(t, { reported: { userCorrections: 5 } })).toContain("reported_traits");
    expect(failed(t, { reported: { preferencePairs: 9 } })).toContain("reported_traits");
    const clean = {
      ...t,
      events: t.events.map((e) => (e.type === "tool_result" ? { ...e, isError: false } : e)),
    };
    expect(failed(clean, { reported: { recovered: true, hadFailure: false } })).toContain(
      "reported_traits",
    );
    // A claimed passing check needs a final call with its own, successful result.
    const dangling = {
      ...t,
      events: [
        ...t.events,
        {
          seq: t.events.length,
          type: "tool_call" as const,
          callId: "z",
          tool: "Bash",
          input: {},
          ts: t.endedAt,
        },
      ],
    };
    // The last call never got a result: the final check never came back.
    expect(
      failed(dangling, { reported: { testsRanAtEnd: true, testsPassedAtEnd: true } }),
    ).toContain("reported_traits");
    expect(failed(t, { reported: { testsRanAtEnd: true, testsPassedAtEnd: true } })).toEqual([]);
    const noResults = {
      ...t,
      events: t.events.filter((e) => e.type !== "tool_result").map((e, i) => ({ ...e, seq: i })),
    };
    expect(
      failed(noResults, { reported: { testsRanAtEnd: true, testsPassedAtEnd: true } }),
    ).toContain("reported_traits");
    const lastFails = {
      ...t,
      events: t.events.map((e) =>
        e.type === "tool_result" && e.callId === "c" ? { ...e, isError: true } : e,
      ),
    };
    expect(
      failed(lastFails, { reported: { testsRanAtEnd: true, testsPassedAtEnd: true } }),
    ).toContain("reported_traits");
    const a = checkAuthenticity(t, { now: NOW, reported: { userCorrections: 5 } });
    expect(a.checks.find((c) => c.id === "reported_traits")!.detail).toMatch(/more corrections/);
  });

  it("is attached to every enrichment", () => {
    expect(enrichTrace(session(), { now: NOW }).traits.authenticity?.level).toBe("consistent");
  });
});
