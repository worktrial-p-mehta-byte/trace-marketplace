import { describe, expect, it } from "vitest";
import { Trace, TRACE_SCHEMA_VERSION } from "./trace";

const minimal = {
  schemaVersion: TRACE_SCHEMA_VERSION,
  id: "t_123",
  startedAt: "2026-10-15T10:00:00.000Z",
  endedAt: "2026-10-15T10:05:00.000Z",
  provenance: {
    source: "synthetic",
    harness: { name: "claude-code" },
    model: { id: "claude-opus-5-5" },
    capturedAt: "2026-10-15T10:05:00.000Z",
  },
  events: [
    { seq: 0, type: "user_message", text: "Fix the failing test" },
    { seq: 1, type: "tool_call", callId: "c1", tool: "Bash", input: { command: "npm test" } },
    { seq: 2, type: "tool_result", callId: "c1", output: "1 failing", isError: true },
    { seq: 3, type: "assistant_message", text: "The test fails because..." },
  ],
};

describe("Trace schema", () => {
  it("accepts a minimal valid trace and fills defaults", () => {
    const parsed = Trace.parse(minimal);
    expect(parsed.provenance.repo.languages).toEqual([]);
    expect(parsed.events).toHaveLength(4);
  });

  it("rejects an unknown event type", () => {
    const bad = { ...minimal, events: [{ seq: 0, type: "mystery", text: "?" }] };
    expect(Trace.safeParse(bad).success).toBe(false);
  });

  it("rejects a trace with no events", () => {
    expect(Trace.safeParse({ ...minimal, events: [] }).success).toBe(false);
  });

  it("rejects an unknown provenance source", () => {
    const bad = { ...minimal, provenance: { ...minimal.provenance, source: "scraped" } };
    expect(Trace.safeParse(bad).success).toBe(false);
  });
});
