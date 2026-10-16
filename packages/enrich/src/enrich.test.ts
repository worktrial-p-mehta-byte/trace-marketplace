import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseClaudeCodeSession } from "@tm/adapters";
import { scrubTrace } from "@tm/scrub";
import { Trace, TRACE_SCHEMA_VERSION, type TraceEvent } from "@tm/schema";
import {
  analyzeTrace,
  detectFramework,
  detectLanguage,
  enrichTrace,
  isCorrection,
  testRunPassed,
  testRunResult,
} from "./index";

const FIXTURE = fileURLToPath(
  new URL("../../../fixtures/claude-code/synthetic-session.jsonl", import.meta.url),
);

function makeTrace(events: Array<Omit<TraceEvent, "seq"> & Record<string, unknown>>): Trace {
  return Trace.parse({
    schemaVersion: TRACE_SCHEMA_VERSION,
    id: "t",
    startedAt: "2026-10-01T00:00:00Z",
    endedAt: "2026-10-01T00:30:00Z",
    provenance: {
      source: "synthetic",
      harness: { name: "test" },
      model: { id: "m1" },
      capturedAt: "2026-10-01T00:30:00Z",
    },
    events: events.map((e, seq) => ({ ...e, seq })),
  });
}

describe("enrichTrace on the synthetic Claude Code session (parse → scrub → enrich)", () => {
  const raw = parseClaudeCodeSession(readFileSync(FIXTURE, "utf8")).traces[0]!;
  const scrubbed = scrubTrace(raw);
  const { labels, traits, comboKey } = enrichTrace(scrubbed.trace, {
    redactionDensity: scrubbed.stats.density,
  });

  it("labels every failure in the session, most valuable first", () => {
    expect(labels.filter((l) => l.kind === "failure").map((l) => [l.code, l.evidence])).toEqual([
      ["test_tampering", [8]], // tried to delete the failing assertion
      ["user_correction", [11]],
      ["tool_rejected", [9]],
      ["user_interrupt", [10]],
      ["tool_error", [5]],
      ["harness_error", [6]],
    ]);
  });

  it("labels the outcome and signals", () => {
    const rest = labels.filter((l) => l.kind !== "failure").map((l) => l.code);
    expect(rest).toEqual(["tests_passed_at_end", "recovered", "context_compaction"]);
  });

  it("extracts pricing traits", () => {
    expect(traits).toMatchObject({
      turns: 10,
      toolCalls: 4,
      toolErrors: 2,
      userCorrections: 1,
      interrupts: 1,
      hadFailure: true,
      recovered: true,
      preferencePairs: 2,
      testsRanAtEnd: true,
      testsPassedAtEnd: true,
      truncated: false,
      language: "TypeScript",
      failureCategory: "test_tampering",
      model: "claude-sonnet-4-5",
      modelDeprecated: false,
      durationMinutes: 3.25,
      outputTokens: 450,
    });
    expect(traits.framework).toBeUndefined();
    expect(comboKey).toBe("TypeScript|-|test_tampering|claude-sonnet-4-5");
  });

  it("carries the scrubber's redaction density into traits", () => {
    expect(traits.redactionDensity).toBe(scrubbed.stats.density);
  });
});

describe("analyzeTrace heuristics", () => {
  it("detects a retry loop: the same tool failing three times in a row", () => {
    const fail = (id: string) => [
      { type: "tool_call", callId: id, tool: "Bash", input: { command: "make" } },
      { type: "tool_result", callId: id, output: "error", isError: true },
    ];
    const a = analyzeTrace(
      makeTrace([
        { type: "user_message", text: "build it" },
        ...fail("a"),
        ...fail("b"),
        ...fail("c"),
        { type: "assistant_message", text: "Giving up." },
      ] as never),
    );
    expect(a.labels.find((l) => l.code === "retry_loop")?.evidence).toEqual([2, 4, 6]);
    expect(a.primaryFailure).toBe("retry_loop");
    expect(a.recovered).toBe(false);
    expect(a.labels.some((l) => l.code === "unresolved")).toBe(true);
  });

  it("does not count a clean session as a failure", () => {
    const a = analyzeTrace(
      makeTrace([
        { type: "user_message", text: "add a README" },
        { type: "tool_call", callId: "a", tool: "Write", input: { file_path: "README.md" } },
        { type: "tool_result", callId: "a", output: "ok", isError: false },
        { type: "assistant_message", text: "Done." },
      ] as never),
    );
    expect(a.hadFailure).toBe(false);
    expect(a.labels.filter((l) => l.kind === "failure")).toEqual([]);
    expect(a.primaryFailure).toBeUndefined();
  });

  it("flags sessions with no model output", () => {
    const a = analyzeTrace(makeTrace([{ type: "user_message", text: "hello?" }] as never));
    expect(a.labels.map((l) => l.code)).toContain("no_model_output");
  });

  it("does not treat the opening request as a correction", () => {
    const a = analyzeTrace(
      makeTrace([{ type: "user_message", text: "Don't use any dependencies for this." }] as never),
    );
    expect(a.userCorrections).toBe(0);
  });
});

describe("text heuristics", () => {
  it.each([
    ["No, that's the wrong file", true],
    ["don't delete the test", true],
    ["That's not right, use UTC", true],
    ["why did you remove the import?", true],
    ["This is not what I asked for", true],
    ["Now add a dark mode toggle", false],
    ["Know any good libraries?", false],
    ["Great, nothing else needed", false],
  ])("isCorrection(%j) → %s", (text, expected) => {
    expect(isCorrection(text)).toBe(expected);
  });

  it("reads test results", () => {
    expect(testRunPassed("Tests: 42 passed, 42 total", false)).toBe(true);
    expect(testRunPassed("3 failed, 39 passed", false)).toBe(false);
    expect(testRunPassed("test result: ok. 0 failed", false)).toBe(true);
    expect(testRunPassed("anything", true)).toBe(false);
  });

  it("needs positive evidence before calling a run a pass", () => {
    expect(testRunResult("No tests found", false)).toBe("unknown");
    expect(testRunResult("collected 0 items\n\nno tests ran in 0.01s", false)).toBe("unknown");
    expect(testRunResult("Error: test runner could not initialize", false)).toBe("unknown");
    expect(testRunResult("some unrelated output", false)).toBe("unknown");
    expect(testRunResult("0 passed", false)).toBe("unknown");
    expect(testRunResult("Ran 4 tests in 0.2s\n\nOK", false)).toBe("passed");
    expect(testRunResult("PASS src/a.test.ts", false)).toBe("passed");
    expect(testRunResult("FAILED (errors=1)", true)).toBe("failed");
  });
});

describe("language and framework detection", () => {
  const call = (input: object) => ({ type: "tool_call", callId: "x", tool: "T", input });

  it("prefers edited file extensions, then build commands", () => {
    expect(detectLanguage(makeTrace([call({ file_path: "src/lib.rs" })] as never))).toBe("Rust");
    expect(detectLanguage(makeTrace([call({ command: "cargo test --all" })] as never))).toBe(
      "Rust",
    );
    expect(
      detectLanguage(
        makeTrace([call({ file_path: "a.py" }), call({ command: "go test ./..." })] as never),
      ),
    ).toBe("Python");
    expect(detectLanguage(makeTrace([call({ command: "ls" })] as never))).toBeUndefined();
    // Repeated build commands for another language don't outvote edited files.
    const kotlin = [
      call({ file_path: "src/Main.kt" }),
      call({ file_path: "src/Util.kt" }),
      ...Array.from({ length: 5 }, () => call({ command: "gradle test" })),
    ];
    expect(detectLanguage(makeTrace(kotlin as never))).toBe("Kotlin");
  });

  it("needs two mentions of a framework and prefers Next.js over React", () => {
    const t = (inputs: object[]) => makeTrace(inputs.map(call) as never);
    expect(detectFramework(t([{ command: "pip install django" }]))).toBeUndefined();
    expect(
      detectFramework(
        t([{ command: "pip install django" }, { content: "from django.db import models" }]),
      ),
    ).toBe("Django");
    expect(
      detectFramework(
        t([
          { command: "npx next build" },
          { content: "import React from 'react'" },
          { command: "next dev" },
        ]),
      ),
    ).toBe("Next.js");
  });
});

describe("test tampering in other test styles", () => {
  it("catches removed should-style assertions (Hspec, RSpec)", () => {
    const trace = Trace.parse({
      schemaVersion: TRACE_SCHEMA_VERSION,
      id: "hs",
      startedAt: "2026-10-10T09:00:00Z",
      endedAt: "2026-10-10T09:05:00Z",
      provenance: {
        source: "synthetic",
        harness: { name: "claude-code" },
        model: { id: "m" },
        capturedAt: "2026-10-10T09:05:00Z",
      },
      events: [
        { seq: 0, type: "user_message", text: "fix the ledger" },
        {
          seq: 1,
          type: "tool_call",
          callId: "c1",
          tool: "Edit",
          input: {
            file_path: "test/LedgerSpec.hs",
            old_string: "balance l `shouldBe` 0",
            new_string: "",
          },
        },
        { seq: 2, type: "tool_result", callId: "c1", output: "updated", isError: false },
      ],
    });
    expect(analyzeTrace(trace).labels.map((l) => l.code)).toContain("test_tampering");
  });

  /** Does an edit to a test file from `before` to `after` count as tampering? */
  function tampered(before: string, after = "") {
    const trace = Trace.parse({
      schemaVersion: TRACE_SCHEMA_VERSION,
      id: "sh",
      startedAt: "2026-10-10T09:00:00Z",
      endedAt: "2026-10-10T09:05:00Z",
      provenance: {
        source: "synthetic",
        harness: { name: "claude-code" },
        model: { id: "m" },
        capturedAt: "2026-10-10T09:05:00Z",
      },
      events: [
        {
          seq: 0,
          type: "tool_call",
          callId: "c1",
          tool: "Edit",
          input: { file_path: "test/widget.spec.ts", old_string: before, new_string: after },
        },
        { seq: 1, type: "tool_result", callId: "c1", output: "updated", isError: false },
      ],
    });
    return analyzeTrace(trace).labels.some((l) => l.code === "test_tampering");
  }

  it("counts real should-style matchers", () => {
    for (const before of [
      "total `shouldNotBe` 0",
      "xs `shouldContain` [1]",
      "result shouldEqual 3",
      "value.should eq(5)",
      "expect { run }.should_not raise_error",
      "obj.should_receive(:save)",
      "it { should eq 5 }",
      "foo.should.equal(1)",
      "should.exist(user)",
      "should.not.exist(err)",
    ]) {
      expect(tampered(before), before).toBe(true);
    }
  });

  it("ignores helpers, words and test names that merely start with should", () => {
    for (const before of [
      "const shouldRender = props.visible;",
      "// mind the shoulder case",
      "it('should render the header', () => {",
      "if (shouldRetry(err)) retry();",
    ]) {
      expect(tampered(before), before).toBe(false);
    }
  });
});
