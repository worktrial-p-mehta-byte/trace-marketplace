import Link from "next/link";
import { browseCatalog, priceExamples, type PriceExample } from "@tm/core";
import { TIER_NAMES } from "@tm/schema";
import { RedactingDemo } from "@/components/RedactingDemo";
import { DOMAIN_NAMES, FACTOR_NAMES, FAILURE_NAMES, money } from "@/lib/labels";
import { getConfig, getCurrentUser, getDb, getSearch } from "@/lib/server";

function steps(sharePct: number) {
  return [
    {
      title: "Choose sessions",
      body: "Pick Claude Code session files from your machine. They are read in your browser and never uploaded as they are.",
    },
    {
      title: "Review what leaves",
      body: "Keys, emails, your username and any words you add are blacked out. You see every redaction and the estimated price before anything is sent.",
    },
    {
      title: "Share and earn",
      body: `Approved sessions are listed and priced. You keep ${sharePct}% of each sale and can withdraw a session from sale at any time.`,
    },
  ];
}

export const dynamic = "force-dynamic";

// Domains shown first in "What a trace is worth": the common case, then the
// scarcer kinds of work labs pay more for.
const EXAMPLE_DOMAINS = [
  "software_engineering",
  "data_querying",
  "medical",
  "legal",
  "research",
  "customer_support",
];

/** One line on what the session is, from its traits. */
function describeExample(e: PriceExample): string {
  const stack = [e.language, e.framework].filter(Boolean).join(" and ");
  const failure = e.failureCategory
    ? `${(FAILURE_NAMES[e.failureCategory] ?? e.failureCategory).toLowerCase()}${
        e.recovered
          ? e.testsPassedAtEnd
            ? ", recovered with the check passing"
            : ", recovered"
          : ", not recovered"
      }`
    : "no failures";
  const age = e.ageDays === 0 ? "today" : e.ageDays === 1 ? "a day old" : `${e.ageDays} days old`;
  return [stack, `${e.turns} turns`, failure, age, TIER_NAMES[e.tier].toLowerCase()]
    .filter(Boolean)
    .join(" · ");
}

/** The two biggest moves away from the base price, largest first. */
function topDrivers(e: PriceExample) {
  return e.quote.drivers
    .filter((d) => d.direction !== "neutral")
    .sort((a, b) => Math.abs(Math.log(b.value)) - Math.abs(Math.log(a.value)))
    .slice(0, 2);
}

export default async function Home() {
  const user = await getCurrentUser();
  const start = user ? "/share" : "/signup";
  // What is for sale right now, by domain, most listings first; every domain
  // the labeler knows when the catalog is empty.
  const { facets } = await browseCatalog(
    getDb(),
    { config: getConfig(), search: getSearch() },
    { limit: 1 },
  );
  const domains = facets.domain.filter((d) => d.value !== "unknown");
  const examples = priceExamples(getDb(), { config: getConfig() }, { order: EXAMPLE_DOMAINS });
  // The hero session: open-source coding work, a tampered test, corrected,
  // recovered with the tests passing.
  const [hero] = priceExamples(
    getDb(),
    { config: getConfig() },
    {
      order: ["software_engineering"],
      limit: 1,
      where: (t, tier) =>
        t.domain === "software_engineering" &&
        tier === 0 &&
        t.failureCategory === "test_tampering" &&
        t.recovered &&
        t.testsPassedAtEnd,
    },
  );
  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-16 pb-20 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <h1 className="text-[2.6rem] leading-[1.05] font-bold tracking-tight sm:text-[3.4rem]">
            Sell the sessions your AI agent already logs.
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-ink-2">
            AI labs pay for real examples of agents getting things wrong and recovering, whether the
            work was code, data, research, clinical evaluation or support. Your sessions are
            scrubbed on your own machine, priced by what makes them rare, and you can withdraw them
            whenever you like.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={start} className="btn">
              Share your sessions
            </Link>
            <Link href="/traces" className="btn-quiet">
              Browse traces
            </Link>
          </div>
        </div>
        <RedactingDemo priceCents={hero?.quote.priceCents} />
      </section>

      <section className="border-t border-rule" aria-labelledby="domains">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 id="domains" className="text-2xl font-bold tracking-tight">
            Browse by domain
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-ink-2">
            Every session is labelled with what the agent was working on, so labs can buy the
            domains they train on, not just code.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {(domains.length
              ? domains
              : Object.keys(DOMAIN_NAMES)
                  .filter((d) => d !== "unknown")
                  .map((value) => ({ value, count: 0 }))
            ).map((d) => (
              <li key={d.value}>
                <Link
                  href={`/traces?domain=${d.value}`}
                  className="flex items-baseline gap-2 rounded-full border border-rule px-3 py-1.5 text-sm text-ink-2 hover:border-ink hover:text-ink"
                >
                  <span>{DOMAIN_NAMES[d.value] ?? d.value}</span>
                  {d.count > 0 && <span className="text-xs text-ink-3">{d.count}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-rule bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-bold tracking-tight">How sharing works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {steps(Math.round(getConfig().revenue.sellerShare * 100)).map((s, i) => (
              <li key={s.title} className="border-t-2 border-ink pt-4">
                <p className="text-sm font-semibold text-ink-3">Step {i + 1}</p>
                <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-bold tracking-tight">What a trace is worth</h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-ink-2">
          Price follows what buyers learn from a session: failures, especially ones the agent
          recovered from with proof, scarce domains such as clinical evaluation or legal review,
          unusual languages, and what buyers are asking for right now. Every price comes with its
          reasons.
        </p>
        {examples.length ? (
          <>
            <ul className="mt-8 grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
              {examples.map((e) => (
                <li key={e.listingId} className="bg-surface">
                  <Link href={`/traces/${e.listingId}`} className="block h-full p-6 hover:bg-paper">
                    <p className="text-sm font-semibold text-ink-3">
                      {DOMAIN_NAMES[e.domain] ?? e.domain}
                    </p>
                    <p className="mt-1 text-3xl font-bold">
                      <span className="price">{money(e.quote.priceCents)}</span>
                    </p>
                    {e.quote.band && (
                      <p className="text-xs text-ink-3">
                        Likely {money(e.quote.band.lowCents)}–{money(e.quote.band.highCents)}
                      </p>
                    )}
                    <p className="mt-3 font-semibold">{e.title ?? "Untitled session"}</p>
                    <p className="mt-1 text-sm text-ink-2">{describeExample(e)}</p>
                    <ul className="mt-3 space-y-1 text-sm">
                      {topDrivers(e).map((d) => (
                        <li key={d.factor} className="flex gap-2">
                          <span
                            className={`font-semibold tabular-nums ${d.direction === "up" ? "text-moss" : "text-brick"}`}
                          >
                            {d.value.toFixed(2)}×
                          </span>
                          <span className="text-ink-2">
                            {FACTOR_NAMES[d.factor] ?? d.factor}: {d.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink-3">
              Live: a typical listing from each domain (its median price), priced by the current
              pricing model for a research licence. Evaluation and training licences cost more.
            </p>
          </>
        ) : (
          <p className="mt-8 text-ink-2">
            Nothing is listed yet. Prices appear here as soon as the first sessions are shared.
          </p>
        )}
      </section>
    </main>
  );
}
