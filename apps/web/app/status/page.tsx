import type { Metadata } from "next";
import { lastRefreshAt } from "@tm/core";
import { getConfig, getDb } from "@/lib/server";
import { getSystemStatus } from "@/lib/status";

export const metadata: Metadata = { title: "System status" };

export const dynamic = "force-dynamic";

function count(sql: string): number | undefined {
  try {
    return (getDb().$client.prepare(sql).get() as { n: number }).n;
  } catch {
    return undefined;
  }
}

/** Plain operational checks for whoever runs the demo or the server. */
export default function StatusPage() {
  const status = getSystemStatus();
  const config = getConfig();
  const active = count("SELECT count(*) AS n FROM listings WHERE status = 'active'");
  const indexed = count("SELECT count(*) AS n FROM listing_search");
  const traces = count("SELECT count(*) AS n FROM traces");
  let refreshed: Date | undefined;
  try {
    refreshed = lastRefreshAt(getDb());
  } catch {
    refreshed = undefined;
  }
  const minutes = refreshed ? Math.round((Date.now() - refreshed.getTime()) / 60_000) : undefined;
  const stale = minutes === undefined || minutes > config.pricing.refreshIntervalMinutes;

  const rows: { label: string; value: string; ok: boolean; hint?: string }[] = [
    {
      label: "Database",
      value: status.database.ok ? "Ready" : (status.database.error ?? "Unavailable"),
      ok: status.database.ok,
      hint: status.database.ok ? undefined : "Run pnpm db:migrate",
    },
    {
      label: "Listings",
      value:
        active === undefined ? "Unknown" : `${active} on sale, from ${traces ?? 0} shared traces`,
      ok: active !== undefined,
      hint: active === 0 ? "Empty catalog: pnpm seed adds the demo market" : undefined,
    },
    {
      label: "Search index",
      value:
        indexed === undefined || active === undefined
          ? "Unknown"
          : indexed === active
            ? `In step (${indexed} listings)`
            : `${indexed} of ${active} listings; rebuilds on the next search`,
      ok: indexed !== undefined && indexed === active,
    },
    {
      label: "Prices",
      value:
        minutes === undefined
          ? "Not priced yet"
          : minutes < 1
            ? "Refreshed just now"
            : `Refreshed ${minutes} min ago`,
      ok: !stale,
      hint: stale ? "Refreshes on the next page load, or run pnpm reprice" : undefined,
    },
    {
      label: "Revenue split",
      value: `${Math.round(status.sellerShare * 100)}% seller, ${Math.round((1 - status.sellerShare) * 100)}% platform`,
      ok: true,
    },
    { label: "Trace schema", value: `Version ${status.traceSchemaVersion}`, ok: true },
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">System status</h1>
      <p className="mt-2 text-ink-2">
        Checks for whoever runs this marketplace. Machines can use{" "}
        <code className="font-mono text-sm">/api/health</code>.
      </p>
      <dl className="mt-8 divide-y divide-rule rounded-lg border border-rule bg-surface">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3"
          >
            <dt className="text-ink-2">{r.label}</dt>
            <dd className="text-right">
              <span className={`font-semibold ${r.ok ? "text-ink" : "text-brick"}`}>{r.value}</span>
              {r.hint && <span className="block text-sm text-ink-3">{r.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
