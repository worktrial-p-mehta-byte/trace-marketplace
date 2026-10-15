import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Trace } from "@tm/schema";
import { claudeCodeAdapter, detectAdapter, parseClaudeCodeSession } from "../index";

const FIXTURE = fileURLToPath(
  new URL("../../../../fixtures/claude-code/synthetic-session.jsonl", import.meta.url),
);
const contents = readFileSync(FIXTURE, "utf8");

describe("Claude Code adapter: synthetic session fixture", () => {
  const report = parseClaudeCodeSession(contents, { fileName: "synthetic-session.jsonl" });
  const trace = report.traces[0]!;

  it("produces one valid canonical trace", () => {
    expect(report.traces).toHaveLength(1);
    expect(Trace.safeParse(trace).success).toBe(true);
    expect(trace.id).toMatch(/^cc_[0-9a-z]{11}$/);
  });

  it("never exposes the raw session id or working directory", () => {
    const json = JSON.stringify(trace);
    expect(json).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(json).not.toContain("/Users/");
  });

  it("captures title, timing, harness version and model", () => {
    expect(trace.title).toBe("Fix UTC date parsing in todo API"); // ai-title beats summary
    expect(trace.startedAt).toBe("2026-10-10T09:00:05.000Z");
    expect(trace.endedAt).toBe("2026-10-10T09:03:20.000Z");
    expect(trace.provenance.harness).toEqual({ name: "claude-code", version: "2.1.300" });
    expect(trace.provenance.model.id).toBe("claude-sonnet-4-5");
    expect(trace.provenance.source).toBe("real");
  });

  it("maps lines to events in order, with sequential seq numbers", () => {
    expect(trace.events.map((e) => e.type)).toEqual([
      "system", // /clear command
      "system", // local_command output
      "user_message",
      "assistant_message",
      "tool_call",
      "tool_result",
      "system", // <synthetic> API error notice from Claude Code itself
      "assistant_message",
      "tool_call",
      "tool_result", // rejected edit
      "user_message", // interrupt
      "user_message", // correction
      "tool_call",
      "tool_result",
      "system", // compaction
      "tool_call",
      "tool_result",
      "assistant_message",
    ]);
    expect(trace.events.map((e) => e.seq)).toEqual(trace.events.map((_, i) => i));
  });

  it("flags tool errors, rejected tool calls and interrupts", () => {
    const results = trace.events.filter((e) => e.type === "tool_result");
    expect(results.map((r) => r.isError)).toEqual([true, true, false, false]);
    expect(results.map((r) => r.rejected ?? false)).toEqual([false, true, false, false]);
    const interrupt = trace.events[10];
    expect(interrupt).toMatchObject({ type: "user_message", interrupted: true });
  });

  it("links tool calls to their results", () => {
    const calls = trace.events.filter((e) => e.type === "tool_call").map((e) => e.callId);
    const results = trace.events.filter((e) => e.type === "tool_result").map((e) => e.callId);
    expect(results).toEqual(calls);
  });

  it("flattens array tool output and records compaction", () => {
    expect(trace.events[13]).toMatchObject({ output: "The file src/dates.ts has been updated." });
    expect(trace.events[14]).toMatchObject({ type: "system", kind: "compaction" });
  });

  it("marks Claude Code's own messages as harness messages, not model output", () => {
    expect(trace.events[6]).toMatchObject({ type: "system", kind: "harness_message" });
    expect(trace.events[1]).toMatchObject({ type: "system", kind: "command" });
  });

  it("totals token usage once per model response, excluding synthetic messages", () => {
    expect(trace.metrics).toEqual({
      inputTokens: 2000,
      outputTokens: 450,
      cacheReadTokens: 5000,
      cacheWriteTokens: 0,
      modelResponses: 2,
    });
  });

  it("skips meta, sidechain, malformed and unknown lines and reports them", () => {
    expect(report.stats).toEqual({
      lines: 27,
      malformed: 1,
      sidechain: 1,
      meta: 1,
      ignoredTypes: {
        mode: 1,
        attachment: 1,
        "file-history-snapshot": 1,
        "system:turn_duration": 1,
        "system:away_summary": 1,
      },
    });
    expect(report.warnings).toEqual([{ line: 17, message: "Not valid JSON; skipped" }]);
  });
});

describe("Claude Code adapter: edge cases", () => {
  const line = (o: object) => JSON.stringify({ sessionId: "s1", ...o });

  it("splits a file with two session ids into two traces", () => {
    const text = [
      line({ type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: "hi" } }),
      JSON.stringify({
        sessionId: "s2",
        type: "user",
        timestamp: "2026-01-02T00:00:00Z",
        message: { content: "hello" },
      }),
    ].join("\n");
    const { traces } = parseClaudeCodeSession(text);
    expect(traces).toHaveLength(2);
    expect(new Set(traces.map((t) => t.id)).size).toBe(2);
  });

  it("drops sessions that contain only bookkeeping", () => {
    const text = line({ type: "user", message: { content: "<command-name>/help</command-name>" } });
    expect(parseClaudeCodeSession(text).traces).toEqual([]);
  });

  it("returns nothing (and does not throw) for garbage input", () => {
    const r = parseClaudeCodeSession("not json\n\n[1,2,3]\nnull");
    expect(r.traces).toEqual([]);
    expect(r.stats.malformed).toBeGreaterThan(0);
  });

  it("truncates very large tool output", () => {
    const big = "x".repeat(50_000);
    const text = [
      line({ type: "user", message: { content: "go" } }),
      line({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: big }] },
      }),
    ].join("\n");
    const out = parseClaudeCodeSession(text).traces[0]!.events[1]!;
    expect(out.type === "tool_result" && out.output.length).toBeLessThan(20_100);
  });

  it("gives the same session the same trace id every time", () => {
    const text = line({ type: "user", message: { content: "hi" } });
    expect(parseClaudeCodeSession(text).traces[0]!.id).toBe(
      parseClaudeCodeSession(text).traces[0]!.id,
    );
  });
});

describe("adapter detection", () => {
  it("detects Claude Code session files", () => {
    expect(detectAdapter("abc.jsonl", contents)?.name).toBe("claude-code");
  });

  it("rejects other files", () => {
    expect(detectAdapter("notes.txt", contents)).toBeUndefined();
    expect(detectAdapter("other.jsonl", '{"foo":1}')).toBeUndefined();
    expect(claudeCodeAdapter.detect("x.jsonl", "not json")).toBe(false);
  });
});
