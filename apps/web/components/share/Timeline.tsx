"use client";

import { useState } from "react";
import type { Trace, TraceEvent } from "@tm/schema";
import { Redacted } from "../Redacted";

const MAX_TEXT = 900;
const PAGE = 40;

function clip(s: string) {
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
}

function describeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  if (typeof i.command === "string") return `$ ${i.command}`;
  const path = i.file_path ?? i.path ?? i.notebook_path;
  if (typeof path === "string") {
    const rest = Object.keys(i).filter((k) => !["file_path", "path", "notebook_path"].includes(k));
    return rest.length ? `${path}  (${rest.join(", ")})` : path;
  }
  if (Object.keys(i).length === 0) return "";
  return JSON.stringify(i);
}

const WHO: Record<TraceEvent["type"], string> = {
  user_message: "You",
  assistant_message: "Agent",
  tool_call: "Tool call",
  tool_result: "Result",
  system: "System",
};

function Row({ e, plain }: { e: TraceEvent; plain: boolean }) {
  const Text = ({ t }: { t: string }) => (plain ? <>{clip(t)}</> : <Redacted text={clip(t)} />);
  let tone = "border-transparent";
  let body: React.ReactNode = null;
  let who = WHO[e.type];
  switch (e.type) {
    case "user_message":
      if (e.interrupted) {
        tone = "border-brick";
        who = "You stopped it";
      }
      body = <Text t={e.text} />;
      break;
    case "assistant_message":
      body = <Text t={e.text} />;
      break;
    case "tool_call":
      body = (
        <>
          <span className="font-semibold">{e.tool}</span> <Text t={describeInput(e.input)} />
        </>
      );
      break;
    case "tool_result":
      if (e.rejected) {
        tone = "border-brick";
        who = "You rejected";
      } else if (e.isError) {
        tone = "border-brick";
        who = "Error";
      }
      body = e.output ? (
        <Text t={e.output} />
      ) : (
        <span className="text-ink-3">(no output shared)</span>
      );
      break;
    case "system":
      body = (
        <span className="text-ink-3">
          {e.kind.replace(/_/g, " ")}
          {e.text ? ": " : ""}
          {e.text ? <Text t={e.text} /> : null}
        </span>
      );
      break;
  }
  return (
    <li className={`grid grid-cols-[6.5rem_1fr] gap-3 border-l-2 py-2 pl-3 ${tone}`}>
      <span className="pt-0.5 font-sans text-xs font-semibold text-ink-3">{who}</span>
      <span className="font-mono text-[0.78rem] leading-relaxed break-words whitespace-pre-wrap">
        {body}
      </span>
    </li>
  );
}

export function Timeline({ trace, plain = false }: { trace: Trace; plain?: boolean }) {
  const [shown, setShown] = useState(PAGE);
  const events = trace.events.slice(0, shown);
  return (
    <div>
      <ol className="divide-y divide-rule/60">
        {events.map((e) => (
          <Row key={e.seq} e={e} plain={plain} />
        ))}
      </ol>
      {trace.events.length > shown && (
        <button
          type="button"
          className="btn-quiet mt-3 text-sm"
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show {Math.min(PAGE, trace.events.length - shown)} more of {trace.events.length - shown}{" "}
          remaining
        </button>
      )}
    </div>
  );
}
