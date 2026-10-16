"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectAdapter } from "@tm/adapters";
import { enrichTrace } from "@tm/enrich";
import { placeholderDensity, scrubTrace, toSignalsOnly } from "@tm/scrub";
import type { Trace } from "@tm/schema";
import { AUTHENTICITY_NAMES, DOMAIN_NAMES, FACTOR_NAMES } from "@/lib/labels";
import { redactionLabel } from "../Redacted";
import { SignalsView } from "./SignalsView";
import { Timeline } from "./Timeline";
import { money, type Item, type Quote, type ShareOutcome } from "./types";

/** "3 API keys, 1 password": kinds that share a label are counted together. */
function removedSummary(byKind: Record<string, number>): string {
  const byLabel = new Map<string, number>();
  for (const [kind, n] of Object.entries(byKind)) {
    const label = redactionLabel(kind);
    byLabel.set(label, (byLabel.get(label) ?? 0) + n);
  }
  return [...byLabel]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([label, n]) => `${n} ${n === 1 ? label : label.endsWith("s") ? `${label}es` : `${label}s`}`,
    )
    .join(", ");
}

const FAILURE_NAMES: Record<string, string> = {
  test_tampering: "Test tampering",
  retry_loop: "Retry loop",
  user_correction: "You corrected it",
  tool_rejected: "You rejected an action",
  user_interrupt: "You interrupted",
  tool_error: "Tool errors",
  harness_error: "API errors",
};

const COPY_COMMAND =
  "mkdir -p ~/Desktop/agent-sessions && cp ~/.claude/projects/*/*.jsonl ~/Desktop/agent-sessions/";

function build(raw: Trace, fileName: string, customTerms: string[], prev?: Item): Item {
  const scrub = scrubTrace(raw, { customTerms });
  // Price on the same redaction measure the server uses (placeholders left in
  // the scrubbed text), so the estimate the seller approves is the price they get.
  const enrich = enrichTrace(scrub.trace, { redactionDensity: placeholderDensity(scrub.trace) });
  const noOutput = enrich.labels.some((l) => l.code === "no_model_output");
  return {
    key: prev?.key ?? `${fileName}:${raw.id}`,
    fileName,
    raw,
    scrub,
    enrich,
    tier: prev?.tier ?? 1,
    rightToShare: prev?.rightToShare ?? false,
    staged: prev?.staged ?? false,
    selected: prev?.selected ?? !noOutput,
    eligible: !noOutput,
    ineligibleReason: noOutput
      ? "No replies from the model, so there is nothing to share."
      : undefined,
    // Keep a previous price only if what it priced has not changed.
    quote:
      prev && JSON.stringify(prev.enrich.traits) === JSON.stringify(enrich.traits)
        ? prev.quote
        : undefined,
    state: prev?.state ?? "ready",
    message: prev?.message,
    outcome: prev?.outcome,
  };
}

/** What leaves the browser for an item: scrubbed, provenance set, stripped for signals only. */
function outgoing(item: Item): Trace {
  const t: Trace = {
    ...item.scrub.trace,
    provenance: { ...item.scrub.trace.provenance, source: item.staged ? "staged" : "real" },
  };
  return item.tier === 1 ? toSignalsOnly(t) : t;
}

/** Everything a price estimate depends on, exactly. */
function pricingStamp(item: Item): string {
  return `${item.tier}:${JSON.stringify(item.enrich.traits)}`;
}

function failureLabels(item: Item) {
  return item.enrich.labels.filter((l) => l.kind === "failure").map((l) => l.code);
}

function titleOf(item: Item) {
  return item.scrub.trace.title || `Session from ${new Date(item.raw.startedAt).toLocaleString()}`;
}

export function ShareFlow({ sellerShare }: { sellerShare: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [termsText, setTermsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const customTerms = useMemo(
    () =>
      termsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [termsText],
  );

  // Folder picking is a non-standard attribute; set it on the element directly.
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setLoading(true);
    const next: Item[] = [];
    const skip: string[] = [];
    for (const f of Array.from(list)) {
      if (!f.name.endsWith(".jsonl")) continue;
      const text = await f.text();
      const adapter = detectAdapter(f.name, text);
      if (!adapter) {
        skip.push(f.name);
        continue;
      }
      const traces = adapter.parse(f.name, text);
      if (!traces.length) skip.push(f.name);
      for (const t of traces) next.push(build(t, f.name, customTerms));
    }
    next.sort((a, b) => b.raw.startedAt.localeCompare(a.raw.startedAt));
    setItems(next);
    setSkipped(skip);
    setActiveKey(next[0]?.key ?? null);
    setLoading(false);
  }

  // Re-scrub everything when the seller changes the words to hide.
  useEffect(() => {
    setItems((cur) => cur.map((it) => build(it.raw, it.fileName, customTerms, it)));
  }, [customTerms]);

  // Fetch price estimates (traits only, never content) when tiers or traits change.
  const estimateKey = items
    .filter((i) => i.eligible)
    .map((i) => `${i.key}=${pricingStamp(i)}`)
    .join("|");
  useEffect(() => {
    if (!estimateKey) return;
    // A newer estimate supersedes this one: abort the request so an older
    // response can never overwrite a newer price.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const sent = items
        .filter((i) => i.eligible)
        .map((i) => ({
          key: i.key,
          tier: i.tier,
          traits: i.enrich.traits,
          stamp: pricingStamp(i),
        }));
      let quotes: (Quote & { key: string })[];
      try {
        const res = await fetch("/api/pricing/estimate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            items: sent.map(({ key, tier, traits }) => ({ key, tier, traits })),
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        quotes = ((await res.json()) as { quotes: (Quote & { key: string })[] }).quotes;
      } catch {
        return; // aborted or offline: a newer request (or none) owns the price
      }
      if (controller.signal.aborted) return;
      const stampOf = new Map(sent.map((s) => [s.key, s.stamp]));
      const byKey = new Map(quotes.map((q) => [q.key, q]));
      setItems((cur) =>
        cur.map((it) => {
          const q = byKey.get(it.key);
          // Belt and braces: apply only if the item still has the tier and traits we priced.
          return q && stampOf.get(it.key) === pricingStamp(it) ? { ...it, quote: q } : it;
        }),
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [estimateKey]);

  const update = useCallback((key: string, patch: Partial<Item>) => {
    setItems((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  const active = items.find((i) => i.key === activeKey);
  const toShare = items.filter((i) => i.selected && i.eligible && i.state !== "shared");
  const blocked = toShare.filter((i) => i.tier === 0 && !i.rightToShare);
  const shared = items.filter((i) => i.state === "shared");

  async function shareSelected() {
    setSharing(true);
    try {
      for (const it of toShare) {
        if (it.tier === 0 && !it.rightToShare) continue;
        update(it.key, { state: "sharing", message: undefined });
        const body =
          it.tier === 1
            ? {
                trace: outgoing(it),
                tier: 1,
                clientTraits: it.enrich.traits,
                clientLabels: it.enrich.labels,
              }
            : { trace: outgoing(it), tier: 0 };
        try {
          const res = await fetch("/api/traces", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (res.ok) update(it.key, { state: "shared", outcome: data as unknown as ShareOutcome });
          else
            update(it.key, {
              state: "error",
              message: data.error ?? `The server answered ${res.status}. Try again.`,
            });
        } catch {
          // Network drop: mark this one and carry on with the rest.
          update(it.key, {
            state: "error",
            message: "Couldn't reach the server. Check your connection and share again.",
          });
        }
      }
    } finally {
      setSharing(false);
    }
  }

  // ---------------------------------------------------------------- step 1: choose
  if (!items.length) {
    return (
      <section className="mt-8 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div
          className="flex flex-col items-start justify-center rounded-lg border-2 border-dashed border-rule bg-surface p-8"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
        >
          <h2 className="text-xl font-semibold">Choose Claude Code sessions</h2>
          <p className="mt-2 max-w-md text-ink-2">
            Drop session files here, or choose them. Each file is a{" "}
            <code className="font-mono text-sm">.jsonl</code> log. They are read in this tab;
            nothing is uploaded until you approve it.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn"
              onClick={() => fileInput.current?.click()}
              disabled={loading}
            >
              {loading ? "Reading sessions…" : "Choose files"}
            </button>
            <button
              type="button"
              className="btn-quiet"
              onClick={() => folderInput.current?.click()}
              disabled={loading}
            >
              Choose a folder
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".jsonl"
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
          {skipped.length > 0 && (
            <p className="mt-4 text-sm text-brick">
              {skipped.length} file{skipped.length > 1 ? "s" : ""} didn&apos;t contain a Claude Code
              session.
            </p>
          )}
        </div>
        <aside className="text-sm leading-relaxed text-ink-2">
          <h3 className="font-semibold text-ink">Where to find your sessions</h3>
          <p className="mt-2">
            Claude Code keeps one file per session in the hidden folder{" "}
            <code className="font-mono">~/.claude/projects</code>. In the file picker on a Mac,
            press <kbd className="rounded border border-rule bg-surface px-1 font-mono">⌘ ⇧ .</kbd>{" "}
            to show hidden folders, or copy them somewhere visible with:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-ink p-3 font-mono text-xs text-paper">
            {COPY_COMMAND}
          </pre>
          <button
            type="button"
            className="btn-quiet mt-2 text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(COPY_COMMAND);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy command"}
          </button>
        </aside>
      </section>
    );
  }

  // ---------------------------------------------------------------- step 3: done
  if (shared.length && !items.some((i) => i.state !== "shared" && i.selected && i.eligible)) {
    const total = shared.reduce((s, i) => s + (i.outcome?.sellerCents ?? 0), 0);
    return (
      <section className="mt-8 max-w-2xl">
        <h2 className="text-2xl font-bold tracking-tight">
          {shared.length} session{shared.length > 1 ? "s" : ""} shared
        </h2>
        <p className="mt-2 text-ink-2">
          They are listed now. At today&apos;s prices you would earn{" "}
          <strong className="price text-ink">{money(total)}</strong> from one sale of each. Prices
          move with demand and new supply.
        </p>
        <ul className="mt-6 divide-y divide-rule border-y border-rule">
          {shared.map((i) => (
            <li key={i.key} className="flex items-center justify-between gap-4 py-3">
              <span className="truncate">
                {titleOf(i)}
                {i.outcome!.campaignFills ? (
                  <span className="ml-2 rounded bg-moss/10 px-1.5 py-0.5 text-xs font-semibold text-moss">
                    Bought by {i.outcome!.campaignFills} campaign
                    {i.outcome!.campaignFills > 1 ? "s" : ""} already
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 font-semibold">
                {i.outcome!.pricePending ? "Price pending" : money(i.outcome!.priceCents)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex gap-3">
          <Link href="/me/traces" className="btn">
            See my traces
          </Link>
          <button type="button" className="btn-quiet" onClick={() => setItems([])}>
            Share more sessions
          </button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- step 2: review
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
        <label className="block w-full max-w-xl sm:w-auto sm:flex-1">
          <span className="text-sm font-semibold">Also hide these words</span>
          <input
            className="field mt-1.5"
            placeholder="Your name, company, project codename (comma separated)"
            value={termsText}
            onChange={(e) => setTermsText(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-4">
          {blocked.length > 0 && (
            <p className="max-w-xs text-sm text-brick">
              Confirm you can share {blocked.length} open-source session
              {blocked.length > 1 ? "s" : ""}, or switch them to signals only.
            </p>
          )}
          <button
            type="button"
            className="btn"
            disabled={sharing || toShare.length === 0 || blocked.length > 0}
            onClick={shareSelected}
          >
            {sharing
              ? "Sharing…"
              : `Share ${toShare.length} session${toShare.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[21rem_1fr]">
        {/* Session list */}
        <ul className="space-y-1.5" aria-label="Sessions">
          {items.map((it) => {
            const fails = failureLabels(it);
            return (
              <li key={it.key}>
                <div
                  className={`flex gap-3 rounded-md border p-3 ${
                    it.key === activeKey ? "border-cobalt bg-surface" : "border-rule bg-surface/50"
                  } ${it.eligible ? "" : "opacity-60"}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Include ${titleOf(it)}`}
                    className="mt-1 size-4 accent-cobalt"
                    checked={it.selected && it.eligible}
                    disabled={!it.eligible || it.state === "shared"}
                    onChange={(e) => update(it.key, { selected: e.target.checked })}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setActiveKey(it.key)}
                  >
                    <span className="block truncate font-semibold">{titleOf(it)}</span>
                    <span className="mt-0.5 block text-xs text-ink-3">
                      {DOMAIN_NAMES[it.enrich.traits.domain] ?? "Unknown domain"},{" "}
                      {new Date(it.raw.startedAt).toLocaleDateString()}, {it.enrich.traits.turns}{" "}
                      turns, {it.tier === 0 ? "open source" : "signals only"}
                    </span>
                    {fails.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {fails.slice(0, 3).map((f) => (
                          <span
                            key={f}
                            className="rounded bg-brick/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-brick"
                          >
                            {FAILURE_NAMES[f] ?? f}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                  <span className="shrink-0 text-right text-sm">
                    {it.state === "shared" ? (
                      <span className="font-semibold text-moss">Shared</span>
                    ) : it.state === "error" ? (
                      <span className="font-semibold text-brick">Not shared</span>
                    ) : it.eligible && it.quote ? (
                      <span className="font-semibold">{money(it.quote.priceCents)}</span>
                    ) : it.eligible ? (
                      <span className="text-ink-3">…</span>
                    ) : (
                      <span className="text-xs text-ink-3">Can&apos;t share</span>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Detail */}
        {active && (
          <article className="min-w-0 rounded-lg border border-rule bg-surface p-6">
            <h2 className="text-xl font-semibold">{titleOf(active)}</h2>
            <p className="mt-1 text-sm text-ink-3">
              {active.fileName}, model {active.raw.provenance.model.id},{" "}
              {active.enrich.traits.toolCalls} tool calls,{" "}
              {Math.round(active.enrich.traits.durationMinutes)} min
            </p>
            {active.enrich.traits.authenticity && (
              <p className="mt-1 text-sm text-ink-2">
                <span className="font-semibold text-ink">Authenticity: </span>
                {AUTHENTICITY_NAMES[active.enrich.traits.authenticity.level]}
                {active.enrich.traits.authenticity.level !== "consistent" && (
                  <span className="text-brick">
                    {" "}
                    (
                    {active.enrich.traits.authenticity.checks
                      .filter((c) => !c.passed)
                      .map((c) => c.detail)
                      .join("; ")}
                    )
                  </span>
                )}
              </p>
            )}
            <p className="mt-1 text-sm text-ink-2">
              <span className="font-semibold text-ink">Domain: </span>
              {DOMAIN_NAMES[active.enrich.traits.domain] ?? "Unknown domain"}
              {active.enrich.traits.domain !== "unknown" && (
                <span className="text-ink-3">
                  {" "}
                  ({Math.round(active.enrich.traits.domainConfidence * 100)}% sure
                  {active.enrich.traits.domains.length > 1 &&
                    `; also ${active.enrich.traits.domains
                      .slice(1)
                      .map(
                        (d) =>
                          `${DOMAIN_NAMES[d.domain] ?? d.domain} ${Math.round(d.share * 100)}%`,
                      )
                      .join(", ")}`}
                  )
                </span>
              )}
            </p>

            {!active.eligible && <p className="mt-4 text-brick">{active.ineligibleReason}</p>}
            {active.state === "error" && <p className="mt-4 text-brick">{active.message}</p>}

            {active.eligible && (
              <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <fieldset>
                  <legend className="text-sm font-semibold">How to share it</legend>
                  <div className="mt-2 space-y-2">
                    {(
                      [
                        [
                          1,
                          "Signals only",
                          "Which tools ran, what failed, when you stepped in. No text or code.",
                        ],
                        [0, "Open source", "The full scrubbed session, as shown below."],
                      ] as const
                    ).map(([tier, title, body]) => (
                      <label
                        key={tier}
                        className={`flex cursor-pointer gap-3 rounded-md border p-3 ${
                          active.tier === tier ? "border-cobalt" : "border-rule"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`tier-${active.key}`}
                          className="mt-1 accent-cobalt"
                          checked={active.tier === tier}
                          disabled={active.state === "shared"}
                          onChange={() => update(active.key, { tier, quote: undefined })}
                        />
                        <span>
                          <span className="block font-semibold">{title}</span>
                          <span className="block text-sm text-ink-2">{body}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {active.tier === 0 && (
                    <label className="mt-3 flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-cobalt"
                        checked={active.rightToShare}
                        onChange={(e) => update(active.key, { rightToShare: e.target.checked })}
                      />
                      <span>
                        This is open-source work or my own project, and I have the right to share
                        it.
                      </span>
                    </label>
                  )}
                  <label className="mt-3 flex gap-2 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-cobalt"
                      checked={active.staged}
                      onChange={(e) => update(active.key, { staged: e.target.checked })}
                    />
                    <span>I set this session up on purpose to show a failure.</span>
                  </label>
                </fieldset>

                <div>
                  <p className="text-sm font-semibold">Estimated price</p>
                  {active.quote ? (
                    <>
                      <p className="mt-1 text-3xl font-bold">
                        <span className="price">{money(active.quote.priceCents)}</span>
                      </p>
                      {active.quote.band && (
                        <p className="text-sm text-ink-3">
                          Likely range {money(active.quote.band.lowCents)}–
                          {money(active.quote.band.highCents)} as the market moves
                        </p>
                      )}
                      <p className="mt-1 text-sm text-ink-2">
                        You earn {money(active.quote.sellerCents)} per sale (
                        {Math.round((active.quote.sellerShare ?? sellerShare) * 100)}%).{" "}
                        {active.quote.summary}
                      </p>
                      <table className="mt-3 w-full text-sm">
                        <tbody>
                          {active.quote.drivers.map((d) => (
                            <tr key={d.factor} className="border-t border-rule/70 align-top">
                              <td className="py-1.5 pr-3 text-ink-2">
                                {FACTOR_NAMES[d.factor] ?? d.factor}
                              </td>
                              <td
                                className={`py-1.5 pr-3 font-semibold ${
                                  d.direction === "up"
                                    ? "text-moss"
                                    : d.direction === "down"
                                      ? "text-brick"
                                      : ""
                                }`}
                              >
                                {d.value.toFixed(2)}×
                              </td>
                              <td className="py-1.5 text-ink-2">{d.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : (
                    <p className="mt-1 text-ink-3">Pricing…</p>
                  )}
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
              <div>
                <h3 className="font-semibold">
                  {active.tier === 1 ? "What buyers will see" : "What will be shared"}
                </h3>
                <p className="text-sm text-ink-2">
                  {active.tier === 1
                    ? "Signals only: no text, code or output leaves this computer. Buyers get the shape of the session below, plus the detected failures. Switch to Open source to share the scrubbed content."
                    : active.scrub.stats.redactions === 0
                      ? "Nothing needed removing. Read through it before sharing."
                      : `${active.scrub.stats.redactions} item${active.scrub.stats.redactions > 1 ? "s" : ""} removed: ${removedSummary(active.scrub.stats.byKind)}.`}
                </p>
              </div>
              {active.tier === 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-cobalt"
                    checked={showOriginal}
                    onChange={(e) => setShowOriginal(e.target.checked)}
                  />
                  Compare with my original (stays on this computer)
                </label>
              )}
            </div>
            <div
              className={`mt-4 grid gap-4 ${showOriginal && active.tier === 0 ? "xl:grid-cols-2" : ""}`}
            >
              {active.tier === 1 ? (
                <SignalsView trace={outgoing(active)} labels={active.enrich.labels} />
              ) : (
                <Timeline trace={outgoing(active)} />
              )}
              {showOriginal && active.tier === 0 && (
                <div className="rounded-md bg-paper p-3">
                  <p className="mb-2 text-xs font-semibold text-ink-3">Your original</p>
                  <Timeline trace={active.raw} plain />
                </div>
              )}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
