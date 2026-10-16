import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canSell, expireCampaigns, interestsOf, marketTrends, type TrendRow } from "@tm/core";
import { money } from "@/lib/labels";
import { getConfig, getCurrentUser, getDb, refreshPrices } from "@/lib/server";
import { followDomainAction } from "./actions";

export const metadata: Metadata = { title: "What buyers want" };
export const dynamic = "force-dynamic";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Gap({ r }: { r: TrendRow }) {
  switch (r.status) {
    case "unsupplied":
      return (
        <span className="rounded bg-moss/10 px-1.5 py-0.5 text-xs font-semibold text-moss">
          Wanted, none listed
        </span>
      );
    case "undersupplied":
      return (
        <span className="rounded bg-moss/10 px-1.5 py-0.5 text-xs font-semibold text-moss">
          Undersupplied {r.gap.toFixed(1)}×
        </span>
      );
    case "crowded":
      return (
        <span className="rounded bg-ink/10 px-1.5 py-0.5 text-xs font-semibold text-ink-2">
          Crowded {r.gap.toFixed(1)}×
        </span>
      );
    case "quiet":
      return <span className="text-xs text-ink-3">No demand or supply yet</span>;
    default:
      return <span className="text-xs text-ink-3">Balanced {r.gap.toFixed(1)}×</span>;
  }
}

/** The bid landscape: what each open campaign will pay, highest first. */
function Bids({ bids }: { bids: number[] }) {
  return (
    <span
      className="flex flex-wrap items-center gap-1"
      title="Open campaigns' maximum prices. A new listing goes to the highest bid, which pays the second-highest (or the list price, if higher)."
    >
      {bids.slice(0, 4).map((b, i) => (
        <span
          key={i}
          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${i === 0 ? "bg-moss/10 text-moss" : "bg-ink/5 text-ink-2"}`}
        >
          {money(b)}
        </span>
      ))}
      {bids.length > 4 && <span className="text-xs text-ink-3">+{bids.length - 4}</span>}
    </span>
  );
}

const ARROW = { rising: "↑ rising", steady: "→ steady", falling: "↓ falling" };

export default async function TrendsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  expireCampaigns(getDb(), {});
  refreshPrices();
  const t = marketTrends(getDb(), { config: getConfig() });
  const following = new Set(interestsOf(getDb(), user.id));
  const seller = canSell(user);
  const wanted = t.segments
    .filter((s) => s.status === "unsupplied" || s.status === "undersupplied")
    .slice(0, 3);
  const maxDemand = Math.max(0.01, ...t.domains.map((d) => d.demandShare));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">What buyers want</h1>
      <p className="mt-2 max-w-2xl text-ink-2">
        Demand from buyers&apos; searches, saves, purchases and campaigns over the last two weeks,
        against what is for sale. Where demand outruns supply, prices are higher and campaigns buy
        new sessions the moment they are listed.
      </p>

      {wanted.length > 0 && (
        <section aria-labelledby="wanted" className="mt-8">
          <h2 id="wanted" className="text-lg font-semibold">
            Most wanted right now
          </h2>
          <ul className="mt-3 grid gap-4 md:grid-cols-3">
            {wanted.map((s) => (
              <li key={s.key} className="rounded-lg border border-rule bg-surface p-4">
                <p className="font-semibold">{s.label}</p>
                <p className="mt-1 text-sm text-ink-2">
                  {pct(s.demandShare)} of demand, {pct(s.supplyShare)} of supply ({s.supply} listed)
                </p>
                <p className="mt-2">
                  <Gap r={s} />
                </p>
                <p className="mt-2 text-sm">
                  {s.supply > 0 ? (
                    <>Typical price {money(s.medianPriceCents)}</>
                  ) : (
                    "None listed yet"
                  )}
                </p>
                {s.bids.length > 0 && (
                  <p className="mt-2 flex flex-wrap items-center gap-1 text-sm">
                    <span className="text-ink-2">
                      {s.bids.length} campaign{s.bids.length > 1 ? "s" : ""} bidding:
                    </span>
                    <Bids bids={s.bids} />
                  </p>
                )}
                {seller && (
                  <Link href="/share" className="btn-quiet mt-3 text-sm">
                    Share a session like this
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="domains" aria-labelledby="by-domain" className="mt-10">
        <h2 id="by-domain" className="text-lg font-semibold">
          By domain
        </h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-rule text-left text-ink-3">
              <tr>
                <th className="px-4 py-2 font-semibold">Domain</th>
                <th className="px-4 py-2 font-semibold">Demand</th>
                <th className="px-4 py-2 font-semibold">Supply</th>
                <th className="px-4 py-2 font-semibold">Gap</th>
                <th className="px-4 py-2 text-right font-semibold">Typical price</th>
                <th className="px-4 py-2 font-semibold">Campaign bids</th>
                {seller && <th className="px-4 py-2 font-semibold">Notify me</th>}
              </tr>
            </thead>
            <tbody>
              {t.domains.map((d) => (
                <tr key={d.key} className="border-t border-rule/70 align-middle">
                  <td className="px-4 py-2">
                    <Link
                      href={`/traces?domain=${d.domain}`}
                      className="font-semibold hover:text-cobalt"
                    >
                      {d.label}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 rounded-sm bg-cobalt"
                        style={{ width: `${Math.max(2, (60 * d.demandShare) / maxDemand)}px` }}
                        aria-hidden
                      />
                      {pct(d.demandShare)}
                      <span className="text-xs text-ink-3">{ARROW[d.direction]}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {d.supply} <span className="text-xs text-ink-3">({pct(d.supplyShare)})</span>
                  </td>
                  <td className="px-4 py-2">
                    <Gap r={d} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {d.supply ? money(d.medianPriceCents) : "—"}
                  </td>
                  <td className="px-4 py-2">{d.bids.length ? <Bids bids={d.bids} /> : "—"}</td>
                  {seller && (
                    <td className="px-4 py-2">
                      <form action={followDomainAction}>
                        <input type="hidden" name="domain" value={d.domain} />
                        <input
                          type="hidden"
                          name="on"
                          value={following.has(d.domain) ? "0" : "1"}
                        />
                        <button
                          className={`rounded border px-2 py-0.5 text-xs ${
                            following.has(d.domain)
                              ? "border-cobalt bg-cobalt/10 text-cobalt"
                              : "border-rule text-ink-2 hover:text-ink"
                          }`}
                          aria-pressed={following.has(d.domain)}
                          aria-label={`Notify me about ${d.label} campaigns`}
                        >
                          {following.has(d.domain) ? "✓ Following" : "Follow"}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {seller && (
          <p className="mt-2 text-xs text-ink-3">
            Follow the domains you work in to hear when a buyer starts a campaign there.
          </p>
        )}
      </section>

      {t.segments.length > 0 && (
        <section aria-labelledby="segments" className="mt-10">
          <h2 id="segments" className="text-lg font-semibold">
            Segments buyers ask for
          </h2>
          <ul className="mt-3 divide-y divide-rule border-y border-rule text-sm">
            {t.segments.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <Link
                  href={`/traces?domain=${s.domain}&failure=${s.failure}`}
                  className="font-semibold hover:text-cobalt"
                >
                  {s.label}
                </Link>
                <span className="flex flex-wrap items-center gap-3 text-ink-2">
                  <span>
                    {pct(s.demandShare)} of demand · {s.supply} listed
                  </span>
                  <Gap r={s} />
                  {s.supply > 0 && <span>{money(s.medianPriceCents)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
