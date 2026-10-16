import { describe, expect, it } from "vitest";
import { Trace, TRACE_SCHEMA_VERSION } from "@tm/schema";
import { stepsOf } from "../components/share/SignalsView";

describe("stepsOf", () => {
  it("keeps a tool result whose call is missing, so label evidence still has a target", () => {
    const trace = Trace.parse({
      schemaVersion: TRACE_SCHEMA_VERSION,
      id: "t",
      startedAt: "2026-10-10T09:00:00Z",
      endedAt: "2026-10-10T09:05:00Z",
      provenance: {
        source: "synthetic",
        harness: { name: "claude-code" },
        model: { id: "m" },
        capturedAt: "2026-10-10T09:05:00Z",
      },
      events: [
        { seq: 0, type: "user_message", text: "[signals only]" },
        // The adapter skipped the malformed assistant line that held this call.
        { seq: 1, type: "tool_result", callId: "orphan", output: "", isError: true },
        { seq: 2, type: "tool_call", callId: "c2", tool: "Bash", input: {} },
        { seq: 3, type: "tool_result", callId: "c2", output: "", isError: false },
        { seq: 4, type: "assistant_message", text: "[signals only]" },
      ],
    });
    const steps = stepsOf(trace, new Set());
    expect(steps.map((s) => s.seq)).toEqual([0, 1, 2, 4]);
    expect(steps[1]).toMatchObject({ kind: "tool", tool: "result", status: "error" });
    expect(steps[2]).toMatchObject({ kind: "tool", tool: "Bash", status: "ok", resultSeq: 3 });
  });
});
