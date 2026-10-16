import type { Metadata } from "next";
import Link from "next/link";
import {
  BEHAVIOURS,
  browseCatalog,
  criteriaOf,
  describe as describeQuery,
  ensureSearchIndex,
  getBuyerPreferences,
  intentWords,
  recommendFor,
  listSavedSearches,
  recordBuyerInterest,
  type BrowseQuery,
  type FacetValue,
  type IntentChip,
} from "@tm/core";
import { deleteSavedSearchAction, saveSearchAction } from "./actions";
import {
  AUTHENTICITY_NAMES,
  DOMAIN_NAMES,
  FAILURE_NAMES,
  OUTCOME_NAMES as OUTCOMES,
  money,
  OUTCOME_NAMES,
  SOURCE_NAMES,
  TIER_NAMES,
} from "@/lib/labels";
import {
  getBlobs,
  getBus,
  getConfig,
  getCurrentUser,
  getDb,
  getSearch,
  refreshPrices,
} from "@/lib/server";

export const metadata: Metadata = { title: "Browse traces" };

export const dynamic = "force-dynamic";

type Params = Record<string, string | undefined>;
const PAGE = 20;
const FILTER_KEYS = [
  "domain",
  "authenticity",
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
    domain: p.domain,
    authenticity: p.authenticity,
    language: p.language,
    framework: p.framework,
    failure: p.failure,
    outcome: p.outcome as BrowseQuery["outcome"],
    model: p.model,
    tier: p.tier === "0" ? 0 : p.tier === "1" ? 1 : undefined,
    source: p.source as BrowseQuery["source"],
    sort: p.sort as BrowseQuery["sort"],
    // In a search, sessions of the same shape fold into one result unless
    // asked to show them; browsing lists every listing.
    group: Boolean(p.q) && p.similar !== "show",
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
  if (key === "domain") return DOMAIN_NAMES[value] ?? value;
  if (key === "authenticity") return AUTHENTICITY_NAMES[value] ?? value;
  if (key === "failure") return FAILURE_NAMES[value] ?? value;
  if (key === "outcome") return OUTCOME_NAMES[value] ?? value;
  if (key === "source") return SOURCE_NAMES[value] ?? value;
  if (key === "tier") return TIER_NAMES[value] ?? value;
  return value;
}

function chipName(c: IntentChip): string {
  if (c.key === "behaviour") return BEHAVIOURS[c.value]?.name ?? c.value;
  if (c.key === "tier") return TIER_NAMES[c.value] ?? c.value;
  if (c.key === "outcome") return OUTCOMES[c.value] ?? c.value;
  return nameFor(c.key, c.value);
}

/**
 * The search with one recognised phrase taken out: removing a chip. Uses the
 * parser's own tokenisation, so "open-source" or "medical." are found.
 */
function without(p: Params, phrase: string): string {
  const words = intentWords(p.q ?? "");
  const drop = intentWords(phrase);
  for (let i = 0; i + drop.length <= words.length; i++) {
    if (drop.every((d, k) => words[i + k] === d)) {
      words.splice(i, drop.length);
      break;
    }
  }
  return href(p, { q: words.join(" ").trim() || undefined });
}

function FacetGroup({
  title,
  k,
  values,
  p,
  max = 8,
  fromText,
}: {
  title: string;
  k: string;
  values: FacetValue[];
  p: Params;
  /** The value the search text set for this facet, and the words that set it. */
  fromText?: { value: string; phrase: string };
  /** How many values to show; the long tail of domains is the point, so it shows whole. */
  max?: number;
}) {
  if (!values.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      {/* Chips that wrap on phones; a vertical list beside the results on wide screens. */}
      <ul className="mt-2 flex flex-wrap gap-1.5 text-sm lg:block lg:space-y-0.5">
        {values.slice(0, max).map((v) => {
          const viaText = !p[k] && fromText?.value === v.value;
          const on = p[k] === v.value || viaText;
          return (
            <li key={v.value}>
              <Link
                href={
                  viaText
                    ? without(p, fromText!.phrase)
                    : href(p, { [k]: on ? undefined : v.value })
                }
                className={`flex justify-between gap-2 rounded border px-2 py-1 lg:gap-3 lg:border-transparent ${
                  on
                    ? "border-ink bg-ink font-semibold text-paper"
                    : "border-rule text-ink-2 hover:bg-surface hover:text-ink"
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
  const textChip = (key: string) => {
    const c = r.intent?.chips.find(
      (x) =>
        x.key === key && !r.intent!.overridden.some((o) => o.key === x.key && o.value === x.value),
    );
    return c ? { value: c.value, phrase: c.phrase } : undefined;
  };
  const saved = user?.buyerOrgId ? listSavedSearches(getDb(), user.buyerOrgId) : [];
  // A buyer who told us what they need sees picks first when just browsing.
  const prefs = user?.buyerOrgId ? getBuyerPreferences(getDb(), user.buyerOrgId) : undefined;
  const picks =
    prefs && !p.q && active.length === 0 && Number(p.page ?? 1) === 1
      ? await recommendFor(getDb(), { config, search }, prefs, 4, user?.buyerOrgId ?? undefined)
      : [];
  const canSave = Boolean(user?.buyerOrgId) && (Boolean(p.q) || active.length > 0);
  const page = Number(p.page ?? 1);
  const pages = Math.max(1, Math.ceil(r.total / PAGE));
  const sort = p.sort ?? (p.q ? "relevance" : "price_desc");

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Browse traces</h1>
          <p className="mt-2 text-ink-2">
            Real agent sessions from every kind of work, scrubbed by their sellers and labelled by
            domain and by what went wrong.
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
            placeholder="Describe it, e.g. medical evaluations where the agent was corrected"
          />
          <button className="btn">Search</button>
        </form>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_1fr]">
        <aside className="space-y-4 lg:space-y-6" aria-label="Filters">
          <FacetGroup
            title="Domain"
            k="domain"
            values={r.facets.domain}
            p={p}
            max={16}
            fromText={textChip("domain")}
          />
          <FacetGroup
            title="Authenticity"
            k="authenticity"
            values={r.facets.authenticity}
            p={p}
            fromText={textChip("authenticity")}
          />
          <FacetGroup
            title="What went wrong"
            k="failure"
            values={r.facets.failure}
            p={p}
            fromText={textChip("failure")}
          />
          <FacetGroup
            title="Outcome"
            k="outcome"
            values={r.facets.outcome}
            p={p}
            fromText={textChip("outcome")}
          />
          <FacetGroup
            title="Language"
            k="language"
            values={r.facets.language}
            p={p}
            fromText={textChip("language")}
          />
          <FacetGroup
            title="Framework"
            k="framework"
            values={r.facets.framework}
            p={p}
            fromText={textChip("framework")}
          />
          <FacetGroup title="Model" k="model" values={r.facets.model} p={p} />
          <FacetGroup
            title="Shared as"
            k="tier"
            values={r.facets.tier}
            p={p}
            fromText={textChip("tier")}
          />
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
            {(p.similar === "show" || r.items.some((i) => i.similar)) && (
              <Link
                href={href(p, { similar: p.similar === "show" ? undefined : "show" })}
                className="text-cobalt"
              >
                {p.similar === "show" ? "Group similar sessions" : "Show similar sessions"}
              </Link>
            )}
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

          {picks.length > 0 && (
            <section
              className="mt-4 rounded-lg border border-cobalt/30 bg-cobalt/5 p-4"
              aria-label="Picked for you"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">Picked for you</h2>
                <Link href="/welcome" className="text-sm text-cobalt">
                  Change what you need
                </Link>
              </div>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {picks.map((i) => (
                  <li key={i.listingId}>
                    <Link
                      href={`/traces/${i.listingId}`}
                      className="flex justify-between gap-3 rounded border border-rule bg-paper px-3 py-2 text-sm hover:border-cobalt"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {i.title ?? "Signals-only session"}
                        </span>
                        <span className="block truncate text-xs text-ink-3">
                          {DOMAIN_NAMES[i.domain]} ·{" "}
                          {i.failures.map((f) => FAILURE_NAMES[f]).join(", ") || "no failures"}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold">{money(i.priceCents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r.intent && (r.intent.chips.length > 0 || r.intent.rest) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm" aria-label="Read as">
              <span className="text-ink-3">Read as</span>
              {r.intent.chips.map((c) => {
                const off = r.intent!.overridden.some(
                  (o) => o.key === c.key && o.value === c.value,
                );
                return (
                  <Link
                    key={`${c.key}:${c.value}`}
                    href={without(p, c.phrase)}
                    className={`rounded-full border px-2.5 py-0.5 ${
                      off
                        ? "border-rule text-ink-3 line-through"
                        : "border-cobalt/40 bg-cobalt/5 text-ink hover:border-brick hover:text-brick"
                    }`}
                    title={
                      off
                        ? "A filter you chose overrides this"
                        : `From “${c.phrase}”. Remove it from the search`
                    }
                  >
                    {chipName(c)} <span aria-hidden>×</span>
                    <span className="sr-only">remove</span>
                  </Link>
                );
              })}
              {r.intent.rest && (
                <span
                  className={`rounded-full border border-dashed border-rule px-2.5 py-0.5 ${r.intent.restIgnored ? "text-ink-3" : "text-ink-2"}`}
                  title={
                    r.intent.restIgnored
                      ? "These words matched nothing, so they only rank results"
                      : "Matched against titles and labels (and content, signed in)"
                  }
                >
                  words: “{r.intent.rest}”{r.intent.restIgnored && " (no matches)"}
                </span>
              )}
            </div>
          )}

          {(canSave || saved.length > 0 || p.saved || p.saveError) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {canSave && (
                <form action={saveSearchAction}>
                  {["q", ...FILTER_KEYS].map(
                    (k) => p[k] && <input key={k} type="hidden" name={k} value={p[k]} />,
                  )}
                  <button className="btn-quiet !py-1 text-sm">Save this search</button>
                </form>
              )}
              {p.saved && (
                <span role="status" className="text-moss">
                  Saved. Matching prices will feel your demand.
                </span>
              )}
              {p.saveError && (
                <span role="alert" className="text-brick">
                  {p.saveError}
                </span>
              )}
              {saved.length > 0 && (
                <nav aria-label="Saved searches" className="flex flex-wrap items-center gap-1.5">
                  <span className="text-ink-3">Saved:</span>
                  {saved.map((sv) => (
                    <span
                      key={sv.id}
                      className="inline-flex items-center rounded border border-rule"
                    >
                      <Link
                        href={href(
                          {},
                          {
                            q: sv.query.text,
                            domain: sv.query.domain,
                            authenticity: sv.query.authenticity,
                            language: sv.query.language,
                            framework: sv.query.framework,
                            failure: sv.query.failure,
                            outcome: sv.query.outcome,
                            tier: sv.query.tier === undefined ? undefined : String(sv.query.tier),
                            model: sv.query.model,
                            source: sv.query.source,
                          },
                        )}
                        className="px-2 py-0.5 text-ink-2 hover:text-ink"
                      >
                        {sv.name || describeQuery(sv.query)}
                      </Link>
                      <form action={deleteSavedSearchAction}>
                        {["q", ...FILTER_KEYS].map(
                          (k) => p[k] && <input key={k} type="hidden" name={k} value={p[k]} />,
                        )}
                        <input type="hidden" name="id" value={sv.id} />
                        <button
                          className="px-1.5 text-ink-3 hover:text-brick"
                          aria-label={`Delete saved search ${sv.name}`}
                        >
                          ×
                        </button>
                      </form>
                    </span>
                  ))}
                </nav>
              )}
            </div>
          )}

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
                        {DOMAIN_NAMES[i.domain] ?? "Unknown domain"}
                        {(i.language || i.framework) && (
                          <> · {[i.language, i.framework].filter(Boolean).join(" / ")}</>
                        )}
                        , {i.model}, {i.turns} turns, {TIER_NAMES[String(i.tier)]?.toLowerCase()}
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
                        {i.authenticity === "consistent" && (
                          <span
                            className="rounded bg-cobalt/10 px-1.5 py-0.5 text-xs font-semibold text-cobalt"
                            title="Well-formed and internally consistent"
                          >
                            ✓ Consistent
                          </span>
                        )}
                        {i.authenticity === "flagged" && (
                          <span
                            className="rounded border border-brick/50 px-1.5 py-0.5 text-xs font-semibold text-brick"
                            title="The log is not well-formed"
                          >
                            Flagged
                          </span>
                        )}
                        {i.outcomes.includes("recovered") && (
                          <span className="rounded bg-moss/10 px-1.5 py-0.5 text-xs font-semibold text-moss">
                            Recovered
                          </span>
                        )}
                      </p>
                      {i.reasons && i.reasons.length > 0 && (
                        <p className="mt-1.5 text-xs text-ink-3">
                          <span className="font-semibold text-ink-2">Why it matched: </span>
                          {i.reasons.slice(0, 4).join(" · ")}
                        </p>
                      )}
                      {i.similar ? (
                        <p className="mt-1 text-xs text-ink-3">
                          +{i.similar} similar session{i.similar > 1 ? "s" : ""} of the same shape
                        </p>
                      ) : null}
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
