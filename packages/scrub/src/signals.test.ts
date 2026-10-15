import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseClaudeCodeSession } from "@tm/adapters";
import { isSignalsOnly, placeholderDensity, scrubTrace, toSignalsOnly } from "./index";

const FIXTURE = fileURLToPath(
  new URL("../../../fixtures/claude-code/synthetic-session.jsonl", import.meta.url),
);
const trace = parseClaudeCodeSession(readFileSync(FIXTURE, "utf8")).traces[0]!;

describe("signals only", () => {
  const s = toSignalsOnly(trace);

  it("removes every piece of content", () => {
    const json = JSON.stringify(s);
    for (const phrase of ["parseDueDate", "npm test", "dates.ts", "42 passed", "UTC date"]) {
      expect(json).not.toContain(phrase);
    }
    expect(isSignalsOnly(s)).toBe(true);
    expect(isSignalsOnly(trace)).toBe(false);
  });

  it("keeps the structure buyers analyse", () => {
    expect(s.events.map((e) => e.type)).toEqual(trace.events.map((e) => e.type));
    const tools = s.events.flatMap((e) => (e.type === "tool_call" ? [e.tool] : []));
    expect(tools).toEqual(["Bash", "Edit", "Edit", "Bash"]);
    const flags = s.events.flatMap((e) =>
      e.type === "tool_result" ? [[e.isError, e.rejected ?? false]] : [],
    );
    expect(flags).toEqual([
      [true, false],
      [true, true],
      [false, false],
      [false, false],
    ]);
    expect(s.metrics).toEqual(trace.metrics);
  });
});

describe("placeholderDensity", () => {
  it("is zero for clean traces and grows with redactions", () => {
    expect(placeholderDensity(trace)).toBe(0);
    const withEmail = {
      ...trace,
      events: trace.events.map((e) =>
        e.type === "user_message" ? { ...e, text: "mail me at someone@acme.io" } : e,
      ),
    };
    const scrubbed = scrubTrace(withEmail).trace;
    expect(placeholderDensity(scrubbed)).toBeGreaterThan(0);
  });
});
