import { getSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export default function StatusPage() {
  const status = getSystemStatus();
  const rows: [string, string, boolean][] = [
    [
      "Database",
      status.database.ok
        ? `${status.database.tables} tables`
        : (status.database.error ?? "unavailable"),
      status.database.ok,
    ],
    [
      "Seller share",
      `${Math.round(status.sellerShare * 100)}% seller / ${Math.round((1 - status.sellerShare) * 100)}% platform`,
      true,
    ],
    ["Trace schema", `v${status.traceSchemaVersion}`, true],
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="text-sm font-medium tracking-wide text-stone-500">v0 scaffold</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Trace Marketplace</h1>
      <p className="mt-4 text-lg text-stone-600">
        Share scrubbed AI agent sessions. Buyers find the rare failures that make models better.
      </p>

      <section className="mt-12 rounded-xl border border-stone-200 bg-white">
        <h2 className="border-b border-stone-200 px-5 py-3 text-sm font-medium text-stone-500">
          System status
        </h2>
        <dl>
          {rows.map(([label, value, ok]) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-stone-100 px-5 py-3 last:border-0"
            >
              <dt className="text-stone-600">{label}</dt>
              <dd className={ok ? "font-medium" : "font-medium text-red-700"}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-6 text-sm text-stone-500">
        Onboarding, sharing and the trace viewer arrive in milestones M4 and M5.
      </p>
    </main>
  );
}
