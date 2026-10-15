import type { Trace, TraceEvent } from "@tm/schema";

export const SIGNALS_ONLY_TEXT = "[signals only]";

/**
 * Tier 1 ("signals only"): keep the shape of the session and drop every
 * piece of content. What survives: event order and types, timestamps, tool
 * names, error / rejected / interrupted flags, compaction markers and token
 * totals. Message text, tool inputs and outputs, and the title are removed.
 * Runs in the browser before upload, and again on the server.
 */
export function toSignalsOnly(trace: Trace): Trace {
  const events: TraceEvent[] = trace.events.map((e) => {
    switch (e.type) {
      case "user_message":
        return { ...e, text: SIGNALS_ONLY_TEXT };
      case "assistant_message":
        return { ...e, text: SIGNALS_ONLY_TEXT };
      case "tool_call":
        return { ...e, input: {} };
      case "tool_result":
        return { ...e, output: "" };
      case "system":
        return { seq: e.seq, ts: e.ts, type: "system", kind: e.kind };
    }
  });
  return { ...trace, title: undefined, events };
}

/** True when a trace carries no content beyond what toSignalsOnly keeps. */
export function isSignalsOnly(trace: Trace): boolean {
  return (
    trace.title === undefined &&
    trace.events.every((e) => {
      switch (e.type) {
        case "user_message":
        case "assistant_message":
          return e.text === SIGNALS_ONLY_TEXT;
        case "tool_call":
          return (
            typeof e.input === "object" && e.input !== null && Object.keys(e.input).length === 0
          );
        case "tool_result":
          return e.output === "";
        case "system":
          return e.text === undefined;
      }
    })
  );
}

const PLACEHOLDER = /\[REDACTED:[a-z_]+\]|<user>/g;

function strings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
}

/**
 * Estimate the share of a scrubbed trace that was redacted, from the
 * placeholders left in it. Lets the server compute the quality signal
 * without trusting a number sent by the browser.
 */
export function placeholderDensity(trace: Trace): number {
  const texts: string[] = [];
  if (trace.title) texts.push(trace.title);
  for (const e of trace.events) {
    if (e.type === "tool_call") strings(e.input, texts);
    else if (e.type === "tool_result") texts.push(e.output);
    else if (e.type === "system") {
      if (e.text) texts.push(e.text);
    } else texts.push(e.text);
  }
  let total = 0;
  let marked = 0;
  for (const t of texts) {
    total += t.length;
    for (const m of t.matchAll(PLACEHOLDER)) marked += m[0].length;
  }
  return total === 0 ? 0 : marked / total;
}
