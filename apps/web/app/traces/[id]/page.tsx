import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getListingDetail, listingTitle, recordBuyerInterest } from "@tm/core";
import { sellerShareFor } from "@tm/config";
import { splitSale } from "@tm/pricing";
import { PriceCard } from "@/components/PriceCard";
import { PriceChart } from "@/components/PriceChart";
import { SignalsView } from "@/components/share/SignalsView";
import { Timeline } from "@/components/share/Timeline";
import { WithdrawButton } from "@/components/WithdrawButton";
import {
  AUTHENTICITY_DESCRIPTIONS,
  AUTHENTICITY_NAMES,
  DOMAIN_DESCRIPTIONS,
  DOMAIN_NAMES,
  FAILURE_DESCRIPTIONS,
  FAILURE_NAMES,
  money,
  OUTCOME_NAMES,
  reasonText,
  SOURCE_NAMES,
  TIER_NAMES,
} from "@/lib/labels";
import { getBlobs, getBus, getConfig, getCurrentUser, getDb, refreshPrices } from "@/lib/server";

export const dynamic = "force-dynamic";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: listingTitle(getDb(), id) ?? "Trace" };
}

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const config = getConfig();
  refreshPrices();
  const load = () => getListingDetail(getDb(), { config, blobs: getBlobs() }, id, user);
  let d = await load();
  if (!d) notFound();
  // Record the view first, then price: a buyer's view can move the price, and
  // the page should show the price as it stands after that, not one view behind.
  if (
    !d.isOwner &&
    recordBuyerInterest(getDb(), { config, bus: getBus() }, user, "view", {
      domain: d.traits.domain && d.traits.domain !== "unknown" ? d.traits.domain : undefined,
      language: d.language ?? undefined,
      failure: d.traits.failureCategory,
    })
  ) {
    d = (await load()) ?? d;
  }

  const t = d.traits;
  const domain = t.domain ?? "unknown";
  const domainLabel = d.labels.find((l) => l.kind === "domain");
  const failures = d.labels.filter((l) => l.kind === "failure");
  const outcomes = d.labels.filter((l) => l.kind === "outcome").map((l) => l.code);
  const evidence = failures.flatMap((l) => l.evidence);
  const title =
    d.title ?? `${d.language ?? "Untitled"} session, ${d.startedAt.toLocaleDateString()}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/traces" className="text-sm font-semibold text-cobalt">
        ← All traces
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-ink-2">
            {DOMAIN_NAMES[domain] ?? "Unknown domain"}
            {(d.language || d.framework) && (
              <> · {[d.language, d.framework].filter(Boolean).join(" / ")}</>
            )}
            , {d.model}, shared as {TIER_NAMES[String(d.tier)]?.toLowerCase()} by{" "}
            {d.isOwner ? "you" : d.sellerAlias}
          </p>
        </div>
        <span
          className={`rounded px-2 py-1 text-sm font-semibold ${
            d.source === "real" ? "bg-moss/10 text-moss" : "bg-ink/10 text-ink-2"
          }`}
        >
          {SOURCE_NAMES[d.source]}
        </span>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="about">
            <h2 id="about" className="text-lg font-semibold">
              What it was about
            </h2>
            <p className="mt-2 text-ink-2">
              <span className="rounded bg-cobalt/10 px-1.5 py-0.5 text-sm font-semibold text-cobalt">
                {DOMAIN_NAMES[domain] ?? "Unknown domain"}
              </span>{" "}
              <span className="text-sm">{DOMAIN_DESCRIPTIONS[domain]}</span>
            </p>
            <p className="mt-2 text-sm text-ink-2">
              {domain === "unknown"
                ? "There was not enough to go on to tell what this session was about."
                : `${Math.round((t.domainConfidence ?? 0) * 100)}% sure`}
              {(t.domains ?? []).length > 1 && (
                <>
                  ; also{" "}
                  {t.domains
                    .slice(1)
                    .map(
                      (x) => `${DOMAIN_NAMES[x.domain] ?? x.domain} ${Math.round(x.share * 100)}%`,
                    )
                    .join(", ")}
                </>
              )}
              {d.tier === 1
                ? ". Reported by the seller's browser: the text it was read from was never uploaded."
                : ". Verified from the content on upload."}
              {domainLabel && domainLabel.evidence.length > 0 && d.trace && (
                <span>
                  {" "}
                  Evidence:{" "}
                  {domainLabel.evidence.slice(0, 3).map((seq, i) => (
                    <a key={seq} href={`#e-${seq}`} className="text-cobalt hover:underline">
                      {i ? ", " : ""}event {seq}
                    </a>
                  ))}
                </span>
              )}
            </p>
          </section>

          <section aria-labelledby="authenticity">
            <h2 id="authenticity" className="text-lg font-semibold">
              Authenticity
            </h2>
            <p className="mt-2 text-ink-2">
              <span
                className={`rounded px-1.5 py-0.5 text-sm font-semibold ${
                  t.authenticity?.level === "consistent"
                    ? "bg-cobalt/10 text-cobalt"
                    : t.authenticity?.level === "flagged"
                      ? "bg-brick/10 text-brick"
                      : "bg-ink/10 text-ink-2"
                }`}
              >
                {AUTHENTICITY_NAMES[t.authenticity?.level ?? "unchecked"]}
              </span>{" "}
              <span className="text-sm">
                {AUTHENTICITY_DESCRIPTIONS[t.authenticity?.level ?? "unchecked"]}
              </span>
            </p>
            {t.authenticity && (
              <ul className="mt-2 space-y-1 text-sm" aria-label="Authenticity checks">
                {t.authenticity.checks.map((c) => (
                  <li key={c.id} className={c.passed ? "text-ink-2" : "text-brick"}>
                    <span aria-hidden>{c.passed ? "✓" : "✕"}</span>{" "}
                    <span className="sr-only">{c.passed ? "Passed:" : "Failed:"}</span>
                    {c.detail}
                    <span className="text-ink-3"> (tier {c.tier})</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink-3">
              Tier 1 checks the log is well-formed; tier 2 that its parts agree. Replaying the
              session in a sandbox (tiers 3–4) comes later.
            </p>
          </section>

          <section aria-labelledby="happened">
            <h2 id="happened" className="text-lg font-semibold">
              What happened
            </h2>
            {failures.length === 0 ? (
              <p className="mt-2 text-ink-2">No failures were detected in this session.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {failures.map((l) => (
                  <li key={l.code} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="rounded bg-brick/10 px-1.5 py-0.5 text-sm font-semibold text-brick">
                      {FAILURE_NAMES[l.code] ?? l.code}
                    </span>
                    <span className="text-sm text-ink-2">{FAILURE_DESCRIPTIONS[l.code]}</span>
                    {l.evidence.length > 0 && d.trace && (
                      <span className="text-sm">
                        {l.evidence.slice(0, 4).map((seq, i) => (
                          <a key={seq} href={`#e-${seq}`} className="text-cobalt hover:underline">
                            {i ? ", " : ""}event {seq}
                          </a>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {outcomes.length > 0 && (
              <p className="mt-3 text-sm text-ink-2">
                Outcome:{" "}
                <strong className="text-ink">
                  {outcomes
                    .map((o) =>
                      o === "tests_passed_at_end"
                        ? "tests pass at the end"
                        : o === "tests_failed_at_end"
                          ? "tests fail at the end"
                          : (OUTCOME_NAMES[o] ?? o).toLowerCase(),
                    )
                    .join(", ")}
                </strong>
              </p>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-4 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-4">
              <Fact label="Turns" value={t.turns} />
              <Fact label="Tool calls" value={t.toolCalls} />
              <Fact label="Tool errors" value={t.toolErrors} />
              <Fact label="Preference pairs" value={t.preferencePairs} />
              <Fact label="User corrections" value={t.userCorrections} />
              <Fact label="Interrupts" value={t.interrupts} />
              <Fact label="Duration" value={`${Math.max(1, Math.round(t.durationMinutes))} min`} />
              <Fact label="Output tokens" value={t.outputTokens?.toLocaleString() ?? "—"} />
            </dl>
          </section>

          <section aria-labelledby="session">
            <h2 id="session" className="text-lg font-semibold">
              The session
            </h2>
            {!d.contentVisible && (
              <p className="mt-2 rounded-md border border-rule bg-surface p-3 text-sm text-ink-2">
                {d.tier === 1 ? (
                  "The seller shared this session as signals only: you can see which tools ran, what failed and when the user stepped in, but no text or code."
                ) : (
                  <>
                    <Link href="/login" className="font-semibold text-cobalt">
                      Sign in
                    </Link>{" "}
                    to read this open-source session. Until then you can see its structure only.
                  </>
                )}
              </p>
            )}
            {d.contentVisible && d.tier === 1 && (
              <p className="mt-2 rounded-md border border-rule bg-surface p-3 text-sm text-ink-2">
                You shared this session as signals only, so its text and code were never stored.
                This is what buyers see.
              </p>
            )}
            {d.trace && (
              <div className="mt-3 rounded-lg border border-rule bg-surface p-4">
                {/* Render at least through the last evidence event, so every evidence link has a target. */}
                {/* Signals-only traces were stripped before storage: even the owner gets the structural view. */}
                {d.contentVisible && d.tier !== 1 ? (
                  <Timeline
                    trace={d.trace}
                    highlight={evidence}
                    initial={Math.max(200, ...evidence.map((seq) => seq + 1))}
                  />
                ) : (
                  <SignalsView
                    trace={d.trace}
                    labels={d.labels}
                    highlight={evidence}
                    counts={false}
                  />
                )}
              </div>
            )}
          </section>
        </div>

        {/* On phones the price comes first, above the (often long) session. */}
        <aside className="order-first space-y-4 lg:sticky lg:top-6 lg:order-none lg:self-start">
          {d.isOwner && (
            <section className="rounded-lg border border-cobalt/40 bg-surface p-4 text-sm">
              <p className="font-semibold">This is your trace</p>
              {d.quotes ? (
                <p className="mt-1 text-ink-2">
                  You earn{" "}
                  {money(
                    splitSale(d.quotes.research.priceCents, sellerShareFor(config, d.traits.domain))
                      .seller,
                  )}{" "}
                  per research-license sale.
                </p>
              ) : (
                <p className="mt-1 text-ink-2">Withdrawn. Buyers can no longer see or buy it.</p>
              )}
              {d.status === "active" && (
                <div className="mt-2">
                  <WithdrawButton traceId={d.traceId} />
                </div>
              )}
            </section>
          )}
          {d.quotes && <PriceCard quotes={d.quotes} />}
          {d.history.length > 0 && (
            <section
              className="rounded-lg border border-rule bg-surface p-5"
              aria-label="Price history"
            >
              <h3 className="text-sm font-semibold">Price history, research license</h3>
              <p className="mt-1 text-xs text-ink-3">
                {d.history.length === 1
                  ? "Listed at this price; no changes yet."
                  : `${d.history.length - 1} change${d.history.length > 2 ? "s" : ""} since listing.`}
              </p>
              <div className="mt-3">
                <PriceChart
                  points={d.history.map((h) => ({
                    t: h.createdAt.toISOString(),
                    cents: h.priceCents,
                    reason: reasonText(h.reason),
                  }))}
                  height={150}
                />
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
