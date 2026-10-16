"use client";

import { useMemo, useState } from "react";
import type { EventNote, NoteKind, TraceExplanation } from "@tm/enrich";
import type { Trace, TraceEvent } from "@tm/schema";
import { Redacted } from "../Redacted";

/** One thing derived from the session, linked to the lines behind it. */
export interface Derivation {
  /** Key into explanation.sources ("label:failure:retry_loop", "factor:rarity", ...). */
  key: string;
  name: string;
  /** Its value, when it has one ("2.22×", "14 turns", "Consistent"). */
  value?: string;
  tone?: "up" | "down" | "bad" | "good";
  /** Why it is what it is, in a sentence. */
  detail: string;
}

export interface DerivationGroup {
  title: string;
  /** A sentence under the title. */
  intro?: string;
  items: Derivation[];
}

const KIND_STYLE: Record<NoteKind, { bar: string; chip: string; name: string }> = {
  failure: { bar: "border-brick", chip: "bg-brick/10 text-brick", name: "Failure" },
  outcome: { bar: "border-moss", chip: "bg-moss/10 text-moss", name: "Outcome" },
  domain: { bar: "border-cobalt", chip: "bg-cobalt/10 text-cobalt", name: "Domain" },
  quality: { bar: "border-ink-3", chip: "bg-ink/10 text-ink-2", name: "Scrubbing" },
  authenticity: { bar: "border-brick", chip: "bg-brick/10 text-brick", name: "Authenticity" },
  signal: { bar: "border-ink-3", chip: "bg-ink/10 text-ink-2", name: "Signal" },
};

const WHO: Record<TraceEvent["type"], string> = {
  user_message: "Person",
  assistant_message: "Agent",
  tool_call: "Tool call",
  tool_result: "Result",
  system: "System",
};

const CLIP = 600;

function contentOf(e: TraceEvent): string {
  switch (e.type) {
    case "user_message":
    case "assistant_message":
      return e.text;
    case "tool_call": {
      const i = (e.input ?? {}) as Record<string, unknown>;
      if (typeof i.command === "string") return `${e.tool}  $ ${i.command}`;
      const path = i.file_path ?? i.path;
      if (typeof path === "string") return `${e.tool}  ${path}`;
      return Object.keys(i).length ? `${e.tool}  ${JSON.stringify(i)}` : e.tool;
    }
    case "tool_result":
      return e.output;
    case "system":
      return e.text ? `${e.kind.replace(/_/g, " ")}: ${e.text}` : e.kind.replace(/_/g, " ");
  }
}

function Content({ e }: { e: TraceEvent }) {
  const [open, setOpen] = useState(false);
  const text = contentOf(e);
  if (text === "[signals only]" || (e.type === "tool_result" && !text)) {
    return <span className="text-ink-3">(text not shared: signals only)</span>;
  }
  const long = text.length > CLIP;
  return (
    <>
      <Redacted text={long && !open ? `${text.slice(0, CLIP)}…` : text} />
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ml-2 font-sans text-xs font-semibold text-cobalt"
        >
          {open ? "Show less" : `Show all ${text.length.toLocaleString()} characters`}
        </button>
      )}
    </>
  );
}

function Note({
  n,
  selected,
  onPick,
}: {
  n: EventNote;
  selected?: string;
  onPick: (key: string) => void;
}) {
  const s = KIND_STYLE[n.kind];
  const lit = selected !== undefined && n.feeds.includes(selected);
  return (
    <li
      className={`rounded-md border-l-2 bg-paper px-3 py-2 ${s.bar} ${lit ? "ring-2 ring-highlight" : ""}`}
    >
      <p className="text-sm font-semibold">
        <span className={`mr-2 rounded px-1.5 py-0.5 text-[0.7rem] ${s.chip}`}>{s.name}</span>
        {n.title}
      </p>
      <p className="mt-1 text-sm leading-snug text-ink-2">{n.detail}</p>
      {(n.related?.length ?? 0) > 0 && (
        <p className="mt-1 text-xs">
          See{" "}
          {n.related!.map((r, i) => (
            <a key={r} href={`#x-${r}`} className="text-cobalt hover:underline">
              {i ? ", " : ""}line {r}
            </a>
          ))}
        </p>
      )}
      {n.feeds.some((f) => f.startsWith("factor:") || f.startsWith("label:")) && (
        <p className="mt-1 flex flex-wrap gap-1">
          {n.feeds
            .filter((f) => f.startsWith("factor:") || f.startsWith("label:"))
            .map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onPick(f)}
                className={`rounded border px-1.5 text-[0.7rem] ${
                  selected === f
                    ? "border-ink bg-ink text-paper"
                    : "border-rule text-ink-3 hover:border-ink"
                }`}
              >
                {f.startsWith("factor:")
                  ? `price: ${f.slice(7)}`
                  : f.split(":").slice(1).join(": ").replace(/_/g, " ")}
              </button>
            ))}
        </p>
      )}
    </li>
  );
}

export function ExplainedTrace({
  trace,
  explanation,
  groups,
}: {
  trace: Trace;
  explanation: TraceExplanation;
  groups: DerivationGroup[];
}) {
  const [selected, setSelected] = useState<string | undefined>();
  const [onlyNoted, setOnlyNoted] = useState(trace.events.length > 120);
  const [cursor, setCursor] = useState(0);
  const byseq = useMemo(() => new Map(explanation.events.map((x) => [x.seq, x])), [explanation]);
  const lit = new Set(selected ? (explanation.sources[selected] ?? []) : []);
  const litList = selected ? (explanation.sources[selected] ?? []) : [];
  const shown = trace.events.filter(
    (e) => !onlyNoted || (byseq.get(e.seq)?.notes.length ?? 0) > 0 || lit.has(e.seq),
  );
  const noted = explanation.events.filter((x) => x.notes.length > 0).length;

  const pick = (key: string) => {
    setSelected((cur) => (cur === key ? undefined : key));
    setCursor(0);
    const first = explanation.sources[key]?.[0];
    if (first !== undefined && selected !== key)
      requestAnimationFrame(() =>
        document
          .getElementById(`x-${first}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
  };
  const jump = (step: number) => {
    if (!litList.length) return;
    const next = (cursor + step + litList.length) % litList.length;
    setCursor(next);
    document
      .getElementById(`x-${litList[next]}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const selectedName = groups.flatMap((g) => g.items).find((i) => i.key === selected)?.name;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0">
        <div className="sticky top-0 z-10 -mx-2 mb-3 flex flex-wrap items-center gap-3 border-b border-rule bg-paper/95 px-2 py-2 text-sm backdrop-blur">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyNoted}
              onChange={(e) => setOnlyNoted(e.target.checked)}
              className="size-4 accent-cobalt"
            />
            Only lines with notes ({noted} of {trace.events.length})
          </label>
          {selected && (
            <span className="flex flex-wrap items-center gap-2" role="status">
              <span className="rounded bg-highlight/40 px-2 py-0.5 font-semibold">
                {selectedName ?? selected}: {litList.length} line{litList.length === 1 ? "" : "s"}
              </span>
              {litList.length > 0 && (
                <>
                  <button
                    type="button"
                    className="btn-quiet px-2 py-0.5 text-xs"
                    onClick={() => jump(-1)}
                  >
                    ↑ Previous
                  </button>
                  <button
                    type="button"
                    className="btn-quiet px-2 py-0.5 text-xs"
                    onClick={() => jump(1)}
                  >
                    ↓ Next
                  </button>
                </>
              )}
              <button
                type="button"
                className="text-xs font-semibold text-cobalt"
                onClick={() => setSelected(undefined)}
              >
                Clear
              </button>
            </span>
          )}
        </div>
        {explanation.title.length > 0 && trace.title && (
          <div className="grid gap-3 border-b border-rule/60 py-3 md:grid-cols-[3rem_1fr] xl:grid-cols-[3rem_minmax(0,1fr)_22rem]">
            <div className="text-xs font-semibold text-ink-3">Title</div>
            <p className="font-mono text-[0.78rem]">{trace.title}</p>
            <ul
              className="space-y-2 md:col-start-2 xl:col-start-auto"
              aria-label="Notes on the title"
            >
              {explanation.title.map((n, i) => (
                <Note key={i} n={n} selected={selected} onPick={pick} />
              ))}
            </ul>
          </div>
        )}
        <ol className="divide-y divide-rule/60" aria-label="The session, line by line">
          {shown.map((e) => {
            const x = byseq.get(e.seq);
            const hot = lit.has(e.seq);
            const dim = selected !== undefined && !hot;
            return (
              <li
                key={e.seq}
                id={`x-${e.seq}`}
                className={`grid scroll-mt-28 gap-3 py-3 md:grid-cols-[3rem_1fr] xl:grid-cols-[3rem_minmax(0,1fr)_22rem] ${
                  hot ? "bg-highlight/20" : ""
                } ${dim ? "opacity-55" : ""}`}
              >
                <div className="text-xs text-ink-3">
                  <a href={`#x-${e.seq}`} className="font-mono hover:text-ink">
                    {e.seq}
                  </a>
                  <div className="font-semibold">{WHO[e.type]}</div>
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-[0.78rem] leading-relaxed break-words whitespace-pre-wrap">
                    <Content e={e} />
                  </p>
                </div>
                <div className="md:col-start-2 xl:col-start-auto">
                  <p className="text-xs text-ink-3">{x?.description}</p>
                  {(x?.notes.length ?? 0) > 0 && (
                    <ul className="mt-2 space-y-2" aria-label={`Notes on line ${e.seq}`}>
                      {x!.notes.map((n, i) => (
                        <Note key={i} n={n} selected={selected} onPick={pick} />
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <aside className="order-first space-y-6 lg:sticky lg:top-6 lg:order-none lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h2 className="text-sm font-semibold">{g.title}</h2>
            {g.intro && <p className="mt-1 text-xs text-ink-3">{g.intro}</p>}
            <ul className="mt-2 space-y-1.5">
              {g.items.map((it) => {
                const n = explanation.sources[it.key]?.length ?? 0;
                const on = selected === it.key;
                return (
                  <li key={it.key}>
                    <button
                      type="button"
                      onClick={() => n && pick(it.key)}
                      disabled={!n}
                      aria-pressed={on}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                        on
                          ? "border-ink bg-highlight/30"
                          : "border-rule bg-surface hover:border-ink-3"
                      } disabled:cursor-default disabled:hover:border-rule`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{it.name}</span>
                        {it.value && (
                          <span
                            className={`shrink-0 font-semibold tabular-nums ${
                              it.tone === "up" || it.tone === "good"
                                ? "text-moss"
                                : it.tone === "down" || it.tone === "bad"
                                  ? "text-brick"
                                  : ""
                            }`}
                          >
                            {it.value}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-ink-2">
                        {it.detail}
                      </span>
                      <span className="mt-1 block text-xs text-ink-3">
                        {n
                          ? `${n} line${n === 1 ? "" : "s"} · show`
                          : "From the whole session or the market"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </aside>
    </div>
  );
}
