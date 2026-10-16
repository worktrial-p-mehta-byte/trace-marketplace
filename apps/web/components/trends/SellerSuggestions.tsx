import Link from "next/link";
import type { SellerSuggestion } from "@tm/core";

/** "What buyers want from you": where the seller's next share pays most, and why. */
export function SellerSuggestions({
  suggestions,
  compact = false,
}: {
  suggestions: SellerSuggestion[];
  compact?: boolean;
}) {
  if (!suggestions.length) return null;
  const personal = suggestions.some((s) => s.relation !== "market");
  return (
    <section
      aria-labelledby="seller-suggestions"
      className="rounded-lg border border-cobalt/30 bg-cobalt/5 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="seller-suggestions" className="font-semibold">
          {personal ? "What buyers want from you" : "What buyers want"}
        </h2>
        <Link href="/trends" className="text-sm text-cobalt">
          See all trends
        </Link>
      </div>
      {!personal && !compact && (
        <p className="mt-1 text-sm text-ink-2">
          Share a session or follow a domain on Trends and these become about what you know.
        </p>
      )}
      <ul className="mt-3 grid gap-3 md:grid-cols-3" aria-label="Suggestions">
        {suggestions.map((s) => (
          <li key={s.key} className="rounded border border-rule bg-paper p-3 text-sm">
            <p className="font-semibold">{s.label}</p>
            <p className="mt-1 text-ink-2">{s.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
