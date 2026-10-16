import { describe, expect, it } from "vitest";
import type { Trace, TraceEvent } from "@tm/schema";
import { enrichTrace, explainTrace } from "./index";

const T0 = Date.parse("2026-10-14T09:00:00Z");
const NOW = new Date("2026-10-15T12:00:00Z");

/** A session from event shapes, with uneven, increasing timestamps. */
function session(kinds: Record<string, unknown>[], title = "Fix the triage summary"): Trace {
  let t = T0;
  const gaps = [0, 12, 30, 4, 55, 2, 40, 9, 21, 70, 15, 33, 8, 47, 5, 26, 61, 3, 18, 44];
  const events = kinds.map((k, i) => {
    t += (gaps[i % gaps.length] ?? 10) * 1000;
    return { ...k, seq: i, ts: new Date(t).toISOString() } as TraceEvent;
  });
  return {
    schemaVersion: 1,
    id: "t1",
    title,
    startedAt: events[0]!.ts!,
    endedAt: events.at(-1)!.ts!,
    provenance: {
      source: "synthetic",
      harness: { name: "claude-code", version: "1" },
      model: { id: "claude-sonnet-4-5", provider: "anthropic" },
      repo: { languages: ["Python"], frameworks: [] },
      capturedAt: events.at(-1)!.ts!,
    },
    events,
  } as Trace;
}

const call = (id: string, tool: string, input: Record<string, unknown>) => ({
  type: "tool_call",
  callId: id,
  tool,
  input,
});
const result = (id: string, output: string, isError = false) => ({
  type: "tool_result",
  callId: id,
  output,
  isError,
});

const RETRY = session([
  { type: "user_message", text: "The patient triage summary test fails, please fix it" },
  { type: "assistant_message", text: "I'll run the tests." },
  call("a", "Bash", { command: "pytest tests/test_triage.py" }),
  result("a", "1 failed", true),
  call("b", "Bash", { command: "pytest tests/test_triage.py -x" }),
  result("b", "1 failed", true),
  call("c", "Bash", { command: "pytest tests/test_triage.py -k summary" }),
  result("c", "1 failed", true),
  call("d", "Edit", { file_path: "triage.py", old_string: "a", new_string: "b" }),
  result("d", "updated"),
  call("e", "Bash", { command: "pytest tests/test_triage.py" }),
  result("e", "3 passed"),
  { type: "assistant_message", text: "Fixed: the triage summary test passes." },
]);

function explain(t: Trace) {
  const { labels, traits } = enrichTrace(t, { now: NOW });
  return { x: explainTrace(t, { labels, traits }), labels, traits };
}
const notesAt = (x: ReturnType<typeof explainTrace>, seq: number) =>
  x.events.find((e) => e.seq === seq)!.notes;
const titles = (x: ReturnType<typeof explainTrace>, seq: number) =>
  notesAt(x, seq).map((n) => n.title);

describe("explainTrace", () => {
  it("describes every line, and names each failure where it happened", () => {
    const { x, labels } = explain(RETRY);
    expect(x.events).toHaveLength(RETRY.events.length);
    for (const e of x.events) expect(e.description.length).toBeGreaterThan(0);
    expect(x.events[2]!.description).toMatch(/runs Bash.*tool call/);
    expect(x.events[3]!.description).toMatch(/answers event 2/);
    // The third failure in a row is the retry loop, said in so many words.
    expect(titles(x, 7)).toContain("Retry loop: 3rd failure of Bash in a row");
    expect(titles(x, 3)).toContain("Tool error");
    // Sources match the labeler's evidence exactly.
    const retry = labels.find((l) => l.code === "retry_loop")!;
    expect(x.sources["label:failure:retry_loop"]).toEqual(retry.evidence);
    expect(x.sources["factor:failure"]).toEqual(expect.arrayContaining(retry.evidence));
  });

  it("explains the outcome: the final test run and the first success after failing", () => {
    const { x, traits } = explain(RETRY);
    expect(traits.testsPassedAtEnd).toBe(true);
    expect(titles(x, 11)).toContain("Final check: tests pass");
    expect(titles(x, 2)).toContain("Runs the tests");
    expect(titles(x, 9)).toContain("First success after the last failure");
    expect(x.sources["factor:quality"]).toContain(11);
  });

  it("shows what pointed at the domain, word by word", () => {
    const { x, traits } = explain(RETRY);
    expect(traits.domain).toBe("medical");
    const note = notesAt(x, 0).find((n) => n.kind === "domain")!;
    expect(note.title).toMatch(/^Points to Medical/);
    expect(note.detail).toMatch(/“triage”|“patient”/);
    expect(note.detail).toMatch(/3×/);
    expect(note.feeds).toEqual(["label:domain:medical", "factor:rarity", "factor:niche"]);
    expect(x.sources["factor:rarity"]!.length).toBeGreaterThan(1);
  });

  it("only calls a test run the final check when nothing failed after it", () => {
    const t = session([
      { type: "user_message", text: "Fix the parser" },
      call("a", "Bash", { command: "pytest" }),
      result("a", "3 passed"),
      call("b", "Bash", { command: "rm -rf build" }),
      result("b", "permission denied", true),
      { type: "assistant_message", text: "I couldn't clean the build." },
    ]);
    const { x, traits } = explain(t);
    expect(traits.testsRanAtEnd).toBe(false);
    expect(titles(x, 2)).toContain("Last test run: passed");
    expect(titles(x, 2)).not.toContain("Final check: tests pass");
    expect(x.sources["factor:quality"] ?? []).not.toContain(2);
  });

  it("places recovery after tampering, and shows title words for the domain", () => {
    const t = session(
      [
        { type: "user_message", text: "Make the date test pass" },
        call("a", "Bash", { command: "npm test" }),
        result("a", "1 failed", true),
        call("b", "Read", { file_path: "src/date.ts" }),
        result("b", "ok"),
        call("c", "Edit", {
          file_path: "tests/date.test.ts",
          old_string: "expect(parse(x)).toBe(y)",
          new_string: "",
        }),
        result("c", "updated"),
        call("d", "Bash", { command: "npm test" }),
        result("d", "12 passed"),
        { type: "assistant_message", text: "Done." },
      ],
      "Refactor the date parsing module",
    );
    const { x } = explain(t);
    // The success at 4 came before the tampering at 5, so it isn't the recovery.
    expect(titles(x, 4)).not.toContain("First success after the last failure");
    expect(titles(x, 6)).toContain("First success after the last failure");
    expect(x.title.map((n) => n.title).join()).toMatch(/Points to/);
    // The title is selectable like a line (seq -1) for the domain.
    expect(x.sources["label:domain:software_engineering"]?.[0]).toBe(-1);
  });

  it("explains corrections, preference pairs and test tampering", () => {
    const t = session([
      { type: "user_message", text: "Make the date test pass" },
      call("a", "Bash", { command: "npm test" }),
      result("a", "1 failed", true),
      {
        type: "assistant_message",
        text: "This test looks flaky; I'll remove the failing assertion.",
      },
      call("b", "Edit", {
        file_path: "tests/date.test.ts",
        old_string: "expect(parse(x)).toBe(y)",
        new_string: "",
      }),
      result("b", "updated"),
      { type: "user_message", text: "No, don't delete the test. Fix the code instead." },
      call("c", "Edit", { file_path: "src/date.ts", old_string: "a", new_string: "b" }),
      result("c", "updated"),
      call("d", "Bash", { command: "npm test" }),
      result("d", "12 passed"),
      { type: "assistant_message", text: "Fixed the timezone bug; tests pass." },
    ]);
    const { x } = explain(t);
    expect(titles(x, 4)).toContain("Test tampering");
    expect(titles(x, 6)).toEqual(expect.arrayContaining(["User correction", "Preference pair"]));
    const correction = notesAt(x, 6).find((n) => n.title === "User correction")!;
    expect(correction.detail).toContain("(“No”)");
    expect(notesAt(x, 6).find((n) => n.title === "Preference pair")!.related).toEqual([7]);
  });

  it("explains scrubbing, repeated calls and broken logs", () => {
    const t = session([
      { type: "user_message", text: "deploy with key [REDACTED:anthropic_key] as <user>" },
      call("a", "Bash", { command: "ls" }),
      result("a", "ok"),
      call("b", "Bash", { command: "ls" }),
      result("b", "ok"),
      result("zz", "orphan"),
      { type: "assistant_message", text: "done" },
    ]);
    // Time runs backwards on the last line.
    (t.events[6] as TraceEvent).ts = t.events[0]!.ts;
    const { x } = explain(t);
    expect(notesAt(x, 0).find((n) => n.title === "Scrubbed")!.detail).toMatch(
      /1 API key, 1 username/,
    );
    expect(titles(x, 3)).toContain("Repeated call");
    expect(notesAt(x, 3).find((n) => n.title === "Repeated call")!.related).toEqual([1]);
    expect(titles(x, 5)).toContain("Result without a call");
    expect(titles(x, 6)).toContain("Earlier than the line before");
    expect(x.sources["factor:authenticity"]).toEqual([5, 6]);
  });

  it("works on a signals-only session from the labels the browser sent", () => {
    const { labels, traits } = enrichTrace(RETRY, { now: NOW });
    const shape = {
      ...RETRY,
      title: undefined,
      events: RETRY.events.map((e) =>
        e.type === "user_message" || e.type === "assistant_message"
          ? { ...e, text: "[signals only]" }
          : e.type === "tool_call"
            ? { ...e, input: {} }
            : e.type === "tool_result"
              ? { ...e, output: "" }
              : e,
      ),
    } as Trace;
    const x = explainTrace(shape, { labels, traits });
    // The failures still sit on their lines; nothing reads content that isn't there.
    expect(titles(x, 7)).toContain("Retry loop: 3rd failure of Bash in a row");
    expect(x.events.flatMap((e) => e.notes).some((n) => n.kind === "domain")).toBe(false);
    // The final check comes from the label's evidence, not from re-reading output.
    expect(titles(x, 11)).toContain("Final check: tests pass");
    expect(x.sources["label:outcome:tests_passed_at_end"]).toEqual([11]);
  });
});
