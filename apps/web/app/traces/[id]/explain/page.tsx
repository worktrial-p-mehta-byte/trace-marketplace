import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getListingDetail, listingTitle } from "@tm/core";
import { explainTrace } from "@tm/enrich";
import { ExplainedTrace, type DerivationGroup } from "@/components/explain/ExplainedTrace";
import {
  AUTHENTICITY_DESCRIPTIONS,
  AUTHENTICITY_NAMES,
  DOMAIN_DESCRIPTIONS,
  DOMAIN_NAMES,
  FACTOR_NAMES,
  FAILURE_DESCRIPTIONS,
  FAILURE_NAMES,
  money,
  TIER_NAMES,
} from "@/lib/labels";
import { getBlobs, getConfig, getCurrentUser, getDb } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `How it was read: ${listingTitle(getDb(), id) ?? "trace"}` };
}

const OUTCOMES: Record<string, [string, string]> = {
  recovered: ["Recovered", "Nothing failed after the agent's last mistake, so it got past them."],
  unresolved: ["Unresolved", "The session ended without getting past its last failure."],
  tests_passed_at_end: [
    "Tests pass at the end",
    "The last test run came after the last failure and passed: the recovery is proven.",
  ],
  tests_failed_at_end: [
    "Tests fail at the end",
    "The last test run came after the last failure and still failed.",
  ],
};
const SIGNALS: Record<string, [string, string]> = {
  context_compaction: [
    "Context compaction",
    "The harness summarised earlier context to make room.",
  ],
  long_session: ["Long session", "A hundred or more turns."],
};

/** What each price factor reads, for factors whose reason needs context. */
const FACTOR_SOURCE: Record<string, string> = {
  failure: "From the failures and outcome on the highlighted lines.",
  rarity: "From how many listings share this domain, failure and stack.",
  niche: "From the domain's share of demand against its share of supply.",
  quality: "From scrubbing and whether the outcome can be checked.",
  richness: "From the session's length and variety of tools.",
  authenticity: "From the authenticity checks.",
  freshness: "From the session's age and model.",
  demand: "From buyers' recent searches, saves and purchases.",
  bounty: "From open bounties and campaigns this session matches.",
  duplicates: "From near-identical sessions by the same seller.",
};

export default async function ExplainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const config = getConfig();
  const d = await getListingDetail(getDb(), { config, blobs: getBlobs() }, id, user);
  if (!d || !d.trace) notFound();
  const t = d.traits;
  const x = explainTrace(d.trace, { labels: d.labels, traits: t });
  const title =
    d.title ?? `${d.language ?? "Untitled"} session, ${d.startedAt.toLocaleDateString()}`;
  const domain = t.domain ?? "unknown";

  const groups: DerivationGroup[] = [];
  groups.push({
    title: "What it was about",
    items: [
      {
        key: `label:domain:${domain}`,
        name: DOMAIN_NAMES[domain] ?? "Unknown domain",
        value: domain === "unknown" ? undefined : `${Math.round(t.domainConfidence * 100)}% sure`,
        detail: `${DOMAIN_DESCRIPTIONS[domain] ?? ""} Read from the words, tools and file types on the highlighted lines${x.title.length ? " and the title" : ""}.${
          (t.domains ?? []).length > 1
            ? ` Also ${t.domains
                .slice(1)
                .map((s) => `${DOMAIN_NAMES[s.domain] ?? s.domain} ${Math.round(s.share * 100)}%`)
                .join(", ")}.`
            : ""
        }${d.tier === 1 ? " Reported by the seller's browser, which read the text before it was removed." : ""}`,
      },
    ],
  });

  const failures = d.labels.filter((l) => l.kind === "failure");
  const outcomes = d.labels.filter((l) => l.kind === "outcome" && OUTCOMES[l.code]);
  const signals = d.labels.filter((l) => l.kind === "signal" && SIGNALS[l.code]);
  groups.push({
    title: "What happened",
    intro: failures.length
      ? "Failures are what buyers study most. Click one to see its lines."
      : "No failures were found in this session.",
    items: [
      ...failures.map((l) => ({
        key: `label:failure:${l.code}`,
        name: FAILURE_NAMES[l.code] ?? l.code,
        tone: "bad" as const,
        detail: FAILURE_DESCRIPTIONS[l.code] ?? "",
      })),
      ...outcomes.map((l) => ({
        key: `label:outcome:${l.code}`,
        name:
          (l.code === "tests_passed_at_end" || l.code === "tests_failed_at_end") && !t.testsRanAtEnd
            ? `Last test run ${l.code === "tests_passed_at_end" ? "passed" : "failed"}`
            : OUTCOMES[l.code]![0],
        tone:
          l.code === "unresolved" || l.code === "tests_failed_at_end"
            ? ("bad" as const)
            : ("good" as const),
        detail:
          (l.code === "tests_passed_at_end" || l.code === "tests_failed_at_end") && !t.testsRanAtEnd
            ? `The last test run ${l.code === "tests_passed_at_end" ? "passed" : "failed"}, but something failed after it, so it doesn't prove how the session ended.`
            : OUTCOMES[l.code]![1],
      })),
      ...signals.map((l) => ({
        key: `label:signal:${l.code}`,
        name: SIGNALS[l.code]![0],
        detail: SIGNALS[l.code]![1],
      })),
    ],
  });

  if (d.quotes) {
    const q = d.quotes.research;
    groups.push({
      title: `Price: ${money(q.priceCents)} for a research licence`,
      intro: `${q.summary} Each factor multiplies the base price; above 1× raises it.`,
      items: q.drivers
        .filter(
          (dr) =>
            dr.direction !== "neutral" || ["failure", "rarity", "quality"].includes(dr.factor),
        )
        .sort((a, b) => Math.abs(Math.log(b.value)) - Math.abs(Math.log(a.value)))
        .map((dr) => ({
          key: `factor:${dr.factor}`,
          name: FACTOR_NAMES[dr.factor] ?? dr.factor,
          value: `${dr.value.toFixed(2)}×`,
          tone:
            dr.direction === "up"
              ? ("up" as const)
              : dr.direction === "down"
                ? ("down" as const)
                : undefined,
          detail: `${dr.reason}. ${FACTOR_SOURCE[dr.factor] ?? ""}`,
        })),
    });
  }

  groups.push({
    title: "Counts",
    intro: "What the price reads from the whole session.",
    items: [
      {
        key: "trait:turns",
        name: "Turns",
        value: String(t.turns),
        detail: "Messages and tool calls. Longer sessions are richer, with diminishing returns.",
      },
      {
        key: "trait:toolErrors",
        name: "Tool errors",
        value: String(t.toolErrors),
        detail: "Results that failed or that the person refused.",
      },
      {
        key: "trait:userCorrections",
        name: "Corrections",
        value: String(t.userCorrections),
        detail: "Times the person told the agent it was wrong.",
      },
      {
        key: "trait:preferencePairs",
        name: "Preference pairs",
        value: String(t.preferencePairs),
        detail: "Feedback the agent then acted on: a wrong move and a corrected one.",
      },
      {
        key: "trait:repeatRatio",
        name: "Repeated calls",
        value: `${Math.round((t.repeatRatio ?? 0) * 100)}%`,
        detail: "Exact repeats of an earlier call count for little in richness.",
      },
      {
        key: "trait:redactionDensity",
        name: "Scrubbed",
        value: `${Math.round(t.redactionDensity * 100)}%`,
        detail: "Share of the text removed. Over a fifth lowers the quality factor.",
      },
    ],
  });

  if (t.authenticity) {
    groups.push({
      title: `Authenticity: ${AUTHENTICITY_NAMES[t.authenticity.level]}`,
      intro: AUTHENTICITY_DESCRIPTIONS[t.authenticity.level],
      items: t.authenticity.checks.map((c) => ({
        key: `check:${c.id}`,
        name: c.passed ? "Passed" : "Failed",
        value: `tier ${c.tier}`,
        tone: c.passed ? ("good" as const) : ("bad" as const),
        detail: c.detail,
      })),
    });
  }

  return (
    <main className="mx-auto max-w-[96rem] px-6 py-10">
      <Link href={`/traces/${d.listingId}`} className="text-sm font-semibold text-cobalt">
        ← Back to the listing
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">How this session was read</h1>
      <p className="mt-1 text-lg text-ink-2">{title}</p>
      <p className="mt-3 max-w-3xl leading-relaxed text-ink-2">
        Every line of the session, with what the marketplace read from it: the failures and outcome
        it found, what told it the domain, what was scrubbed, and what feeds the price. Pick
        anything in the panel to see the lines behind it. Nothing here is a judgement made by a
        person or a model; it is the same rules that labelled and priced the session, written out.
      </p>
      {d.tier === 1 && (
        <p className="mt-3 max-w-3xl rounded-md border border-rule bg-surface p-3 text-sm text-ink-2">
          Shared as {TIER_NAMES["1"]?.toLowerCase()}: the text was removed in the seller&apos;s
          browser before upload, so the notes come from the session&apos;s shape and the labels the
          browser sent. Only tool names remain, so the words that pointed at the domain can&apos;t
          be shown.
        </p>
      )}
      {!d.contentVisible && d.tier !== 1 && (
        <p className="mt-3 max-w-3xl rounded-md border border-rule bg-surface p-3 text-sm text-ink-2">
          <Link href="/login" className="font-semibold text-cobalt">
            Sign in
          </Link>{" "}
          to see the text of each line. Until then the notes come from the session&apos;s shape.
        </p>
      )}
      <div className="mt-8">
        <ExplainedTrace
          trace={d.trace}
          explanation={x}
          groups={groups}
          signalsOnly={d.tier === 1}
        />
      </div>
    </main>
  );
}
