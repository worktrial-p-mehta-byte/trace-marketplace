import Link from "next/link";
import {
  browseCatalog,
  criteriaOf,
  ensureSearchIndex,
  recordBuyerInterest,
  type BrowseQuery,
  type FacetValue,
} from "@tm/core";
import { FAILURE_NAMES, money, OUTCOME_NAMES, SOURCE_NAMES, TIER_NAMES } from "@/lib/labels";
import {
  getBlobs,
  getBus,
  getConfig,
  getCurrentUser,
  getDb,
  getSearch,
  refreshPrices,
} from "@/lib/server";

export const dynamic = "force-dynamic";

type Params = Record<string, string | undefined>;
const PAGE = 20;
const FILTER_KEYS = [
  "language",
  "framework",
  "failure",
  "outcome",
  "model",
  "tier",
  "source",
] as const;

function toQuery(p: Params): BrowseQuery {
  return {
    text: p.q || undefined,
    language: p.language,
    framework: p.framework,
    failure: p.failure,
    outcome: p.outcome as BrowseQuery["outcome"],
    model: p.model,
    tier: p.tier === "0" ? 0 : p.tier === "1" ? 1 : undefined,
    source: p.source as BrowseQuery["source"],
    sort: p.sort as BrowseQuery["sort"],
    offset: Math.max(0, Number(p.page ?? 1) - 1) * PAGE,
    limit: PAGE,
  };
}

function href(p: Params, change: Params): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...change })) if (v) next.set(k, v);
  if (!("page" in change)) next.delete("page");
  const s = next.toString();
  return s ? `/traces?${s}` : "/traces";
}

function nameFor(key: string, value: string): string {
  if (key === "failure") return FAILURE_NAMES[value] ?? value;
  if (key === "outcome") return OUTCOME_NAMES[value] ?? value;
  if (key === "source") return SOURCE_NAMES[value] ?? value;
  if (key === "tier") return TIER_NAMES[value] ?? value;
  return value;
}

function FacetGroup({
  title,
  k,
  values,
  p,
}: {
  title: string;
  k: string;
  values: FacetValue[];
  p: Params;
}) {
  if (!values.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-0.5 text-sm">
        {values.slice(0, 8).map((v) => {
          const on = p[k] === v.value;
          return (
            <li key={v.value}>
              <Link
                href={href(p, { [k]: on ? undefined : v.value })}
                className={`flex justify-between gap-3 rounded px-2 py-1 ${
                  on
                    ? "bg-ink font-semibold text-paper"
                    : "text-ink-2 hover:bg-surface hover:text-ink"
                }`}
                aria-current={on ? "true" : undefined}
              >
                <span className="truncate">{nameFor(k, v.value)}</span>
                <span className={on ? "" : "text-ink-3"}>{v.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const SORTS: [string, string][] = [
  ["price_desc", "Highest price"],
  ["rarest", "Rarest"],
  ["newest", "Newest"],
  ["price_asc", "Lowest price"],
];

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const user = await getCurrentUser();
  const config = getConfig();
  const q = toQuery(p);
  // A buyer asking for something specific is demand: it nudges matching prices up.
  recordBuyerInterest(getDb(), { config, bus: getBus() }, user, "search", criteriaOf(q));
  const search = getSearch();
  // Heals an index that is missing listings, e.g. after upgrading an older database.
  await ensureSearchIndex(getDb(), getBlobs(), search);
  refreshPrices();
  // Signed-out visitors can't read trace content, so their text search can't match it either.
  const r = await browseCatalog(
    getDb(),
    { config, search },
    { ...q, includeContent: Boolean(user) },
  );
  const active = FILTER_KEYS.filter((k) => p[k]);
  const page = Number(p.page ?? 1);
  const pages = Math.max(1, Math.ceil(r.total / PAGE));
  const sort = p.sort ?? (p.q ? "relevance" : "price_desc");

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Browse traces</h1>
          <p className="mt-2 text-ink-2">
            Real coding-agent sessions, scrubbed by their sellers and labelled by what went wrong.
          </p>
        </div>
        <form action="/traces" className="flex w-full max-w-md gap-2">
          {FILTER_KEYS.map((k) => p[k] && <input key={k} type="hidden" name={k} value={p[k]} />)}
          <label className="sr-only" htmlFor="q">
            Search traces
          </label>
          <input
            id="q"
            name="q"
            defaultValue={p.q}
            className="field"
            placeholder="Search, e.g. deadlock, timezone, terraform"
          />
          <button className="btn">Search</button>
        </form>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_1fr]">
        <aside className="space-y-6" aria-label="Filters">
          <FacetGroup title="What went wrong" k="failure" values={r.facets.failure} p={p} />
          <FacetGroup title="Outcome" k="outcome" values={r.facets.outcome} p={p} />
          <FacetGroup title="Language" k="language" values={r.facets.language} p={p} />
          <FacetGroup title="Framework" k="framework" values={r.facets.framework} p={p} />
          <FacetGroup title="Model" k="model" values={r.facets.model} p={p} />
          <FacetGroup title="Shared as" k="tier" values={r.facets.tier} p={p} />
          <FacetGroup title="Source" k="source" values={r.facets.source} p={p} />
        </aside>

        <section aria-label="Results">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3 text-sm">
            <p className="text-ink-2">
              <strong className="text-ink">{r.total}</strong> trace{r.total === 1 ? "" : "s"}
              {p.q ? ` matching “${p.q}”` : ""}
              {p.q && !user && (
                <>
                  {" "}
                  in titles and tags ·{" "}
                  <Link href="/login" className="text-cobalt">
                    Sign in to search inside traces
                  </Link>
                </>
              )}
              {active.length > 0 && (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    href={p.q ? `/traces?q=${encodeURIComponent(p.q)}` : "/traces"}
                    className="text-cobalt"
                  >
                    Clear filters
                  </Link>
                </>
              )}
            </p>
            <nav className="flex gap-1" aria-label="Sort">
              {(p.q ? [["relevance", "Best match"] as [string, string], ...SORTS] : SORTS).map(
                ([key, label]) => (
                  <Link
                    key={key}
                    href={href(p, { sort: key })}
                    className={`rounded px-2 py-1 ${sort === key ? "bg-surface font-semibold text-ink" : "text-ink-2 hover:text-ink"}`}
                    aria-current={sort === key ? "true" : undefined}
                  >
                    {label}
                  </Link>
                ),
              )}
            </nav>
          </div>

          {r.items.length === 0 ? (
            <div className="mt-8 rounded-lg border border-rule bg-surface p-8">
              <h2 className="text-lg font-semibold">No traces match</h2>
              <p className="mt-2 text-ink-2">Remove a filter or try a broader search.</p>
              <Link href="/traces" className="btn-quiet mt-4">
                Show all traces
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-rule">
              {r.items.map((i) => (
                <li key={i.listingId}>
                  <Link
                    href={`/traces/${i.listingId}`}
                    className="group grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold group-hover:text-cobalt">
                        {i.title ??
                          `${i.language ?? "Untitled"} session, ${i.startedAt.toLocaleDateString()}`}
                      </h2>
                      <p className="mt-0.5 text-sm text-ink-3">
                        {[i.language, i.framework].filter(Boolean).join(" / ") || "Unknown stack"},{" "}
                        {i.model}, {i.turns} turns, {TIER_NAMES[String(i.tier)]?.toLowerCase()}
                        {i.source !== "real" && <>, {SOURCE_NAMES[i.source]?.toLowerCase()}</>}
                      </p>
                      <p className="mt-1.5 flex flex-wrap gap-1">
                        {i.failures.slice(0, 4).map((f) => (
                          <span
                            key={f}
                            className="rounded bg-brick/10 px-1.5 py-0.5 text-xs font-semibold text-brick"
                          >
                            {FAILURE_NAMES[f] ?? f}
                          </span>
                        ))}
                        {i.outcomes.includes("recovered") && (
                          <span className="rounded bg-moss/10 px-1.5 py-0.5 text-xs font-semibold text-moss">
                            Recovered
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-lg font-bold">{money(i.priceCents)}</p>
                      <p className="text-xs text-ink-3">research license</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {pages > 1 && (
            <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pages">
              {page > 1 ? (
                <Link className="btn-quiet" href={href(p, { page: String(page - 1) })}>
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-ink-3">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link className="btn-quiet" href={href(p, { page: String(page + 1) })}>
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
