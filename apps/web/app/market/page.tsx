import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { browseCatalog, ensureSearchIndex, openBounties, watchList } from "@tm/core";
import { PriceChart } from "@/components/PriceChart";
import { PATTERNS, STACKS } from "@tm/synth";
import { FAILURE_NAMES, money, reasonText } from "@/lib/labels";
import { getBlobs, getConfig, getCurrentUser, getDb, getSearch, refreshPrices } from "@/lib/server";
import { floodAction, postBountyAction, resetAction } from "./actions";

export const metadata: Metadata = { title: "Market simulator" };

export const dynamic = "force-dynamic";

type Params = Record<string, string | undefined>;

// The failure types the simulator can generate supply for.
const FAILURES = PATTERNS.map((p) => p.pattern).filter((p) => p !== "clean");

function Outcome({ p }: { p: Params }) {
  if (p.error) {
    return (
      <p role="alert" className="rounded-md border border-brick/40 bg-brick/5 px-4 py-3 text-brick">
        {p.error}
      </p>
    );
  }
  if (!p.did) return null;
  const [n = 0, avg = 0] = (p.r ?? "0:0").split(":").map(Number);
  const moved =
    n === 0
      ? "No matching prices moved."
      : `${n} matching trace${n === 1 ? "" : "s"} repriced, ${avg > 0 ? "up" : "down"} ${Math.abs(avg)}% on average.`;
  const text =
    p.did === "bounty"
      ? `Bounty posted: a buyer offers ${money(Number(p.budget ?? 0) * 100)} in total. ${moved}`
      : p.did === "flood"
        ? `Added ${p.added} synthetic sessions of this kind. ${moved}`
        : `Simulator reset: bounties closed and ${p.withdrawn} simulated sessions withdrawn. Prices are back to normal.`;
  return (
    <p role="status" className="rounded-md border border-moss/40 bg-moss/5 px-4 py-3 text-ink">
      {text}
    </p>
  );
}

export default async function MarketPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const p = await searchParams;
  const config = getConfig();
  const search = getSearch();
  await ensureSearchIndex(getDb(), getBlobs(), search);
  refreshPrices();

  // Stack options come from the live catalog, most common first.
  const all = await browseCatalog(getDb(), { config, search }, { limit: 1 });
  // Languages already in the catalog first, then every language the
  // simulator can generate, so an empty catalog can still be given supply.
  const stacks = [
    ...new Set([...all.facets.language.map((l) => l.value), ...STACKS.map((s) => s.language)]),
  ];
  const [language, framework] = (p.language ?? "").split("/");
  const failure = p.failure || undefined;
  const criteria = { language: language || undefined, framework: framework || undefined, failure };
  const hasSelection = Boolean(criteria.language || criteria.failure);
  const watched = hasSelection ? watchList(getDb(), config, criteria, 4) : [];
  const yMax = Math.max(
    0,
    ...watched.flatMap((w) => w.history.map((h) => h.priceCents)),
    ...watched.map((w) => w.priceCents),
  );
  const bounties = openBounties(getDb());

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Market simulator</h1>
      <p className="mt-2 max-w-2xl text-ink-2">
        Move the market and watch prices respond. A bounty is buyers asking for something; added
        supply makes it common. Simulated sessions are synthetic and everything here can be reset.
      </p>

      {/* One row of controls: what kind of trace to act on. */}
      <form
        action="/market"
        className="mt-8 flex flex-wrap items-end gap-3 border-b border-rule pb-5"
      >
        <label className="block">
          <span className="block text-sm font-semibold">Language</span>
          <select name="language" defaultValue={p.language ?? ""} className="field mt-1.5 !w-56">
            <option value="">Any language</option>
            {stacks.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-semibold">What went wrong</span>
          <select name="failure" defaultValue={p.failure ?? ""} className="field mt-1.5 !w-56">
            <option value="">Any failure</option>
            {FAILURES.map((f) => (
              <option key={f} value={f}>
                {FAILURE_NAMES[f]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-quiet">Show these traces</button>
        <div className="ml-auto flex gap-2 text-sm">
          {[
            ["Rust", "user_correction"],
            ["Python", "retry_loop"],
            ["TypeScript", "test_tampering"],
          ].map(([l, f]) => (
            <Link
              key={`${l}${f}`}
              href={`/market?language=${l}&failure=${f}`}
              className="rounded px-2 py-1 text-ink-2 hover:bg-surface hover:text-ink"
            >
              {l} + {FAILURE_NAMES[f!]!.toLowerCase()}
            </Link>
          ))}
        </div>
      </form>

      <div className="mt-6 space-y-6">
        <Outcome p={p} />

        <div className="grid gap-6 md:grid-cols-2">
          <form action={postBountyAction} className="rounded-lg border border-rule bg-surface p-5">
            <input type="hidden" name="language" value={p.language ?? ""} />
            <input type="hidden" name="failure" value={p.failure ?? ""} />
            <h2 className="text-lg font-semibold">Post a bounty</h2>
            <p className="mt-1 text-sm text-ink-2">
              A buyer asks for traces like these. Matching prices rise, most where supply is scarce.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="block">
                <span className="block text-sm font-semibold">Per trace ($)</span>
                <input
                  name="perTrace"
                  type="number"
                  min="1"
                  max="500"
                  defaultValue="20"
                  className="field mt-1.5 !w-28"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-semibold">How many</span>
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  max="500"
                  defaultValue="10"
                  className="field mt-1.5 !w-28"
                />
              </label>
            </div>
            <button className="btn mt-4" disabled={!hasSelection}>
              Post bounty
            </button>
          </form>

          <form action={floodAction} className="rounded-lg border border-rule bg-surface p-5">
            <input type="hidden" name="language" value={p.language ?? ""} />
            <input type="hidden" name="failure" value={p.failure ?? ""} />
            <h2 className="text-lg font-semibold">Add supply</h2>
            <p className="mt-1 text-sm text-ink-2">
              Sellers share many sessions like these. The combination stops being rare and prices
              fall.
            </p>
            <label className="mt-4 block">
              <span className="block text-sm font-semibold">Sessions to add</span>
              <input
                name="count"
                type="number"
                min="1"
                max="100"
                defaultValue="25"
                className="field mt-1.5 !w-28"
              />
            </label>
            <button className="btn mt-4" disabled={!criteria.language}>
              Add sessions
            </button>
          </form>
        </div>

        <section aria-labelledby="watch">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="watch" className="text-lg font-semibold">
              {hasSelection ? "Most valuable matching traces" : "Choose a kind of trace to follow"}
            </h2>
            <form action={resetAction}>
              <input type="hidden" name="language" value={p.language ?? ""} />
              <input type="hidden" name="failure" value={p.failure ?? ""} />
              <button className="btn-quiet text-sm">Reset simulator</button>
            </form>
          </div>
          {!hasSelection ? (
            <p className="mt-3 text-ink-2">
              Pick a language or a failure type above, or try one of the shortcuts.
            </p>
          ) : watched.length === 0 ? (
            <p className="mt-3 text-ink-2">No traces match yet. Add supply to create some.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {watched.map((w) => (
                <li
                  key={w.listingId}
                  className="min-w-0 rounded-lg border border-rule bg-surface p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/traces/${w.listingId}`}
                      className="min-w-0 truncate font-semibold hover:text-cobalt"
                    >
                      {w.title ?? "Untitled session"}
                    </Link>
                    <span className="shrink-0 font-bold">{money(w.priceCents)}</span>
                  </div>
                  <div className="mt-3">
                    <PriceChart
                      compact
                      spacing="even"
                      height={96}
                      yMax={yMax}
                      title={`Price history of ${w.title ?? "this trace"}`}
                      points={w.history.map((h) => ({
                        t: h.createdAt.toISOString(),
                        cents: h.priceCents,
                        reason: reasonText(h.reason),
                      }))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {watched.length > 1 && (
            <p className="mt-2 text-xs text-ink-3">All four charts share one price scale.</p>
          )}
        </section>

        {bounties.length > 0 && (
          <section aria-labelledby="bounties">
            <h2 id="bounties" className="text-lg font-semibold">
              Open bounties
            </h2>
            <ul className="mt-2 divide-y divide-rule border-y border-rule text-sm">
              {bounties.map((b) => (
                <li key={b.id} className="flex justify-between gap-4 py-2">
                  <span>{b.title}</span>
                  <span className="text-ink-2">
                    {b.quantity} × {money(b.perTraceCents)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
