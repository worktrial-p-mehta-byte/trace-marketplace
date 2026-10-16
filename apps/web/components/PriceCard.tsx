"use client";

import { useState } from "react";
import type { PriceQuote } from "@tm/pricing";
import { addToCartAction, buyNowAction } from "@/app/cart/actions";
import { FACTOR_NAMES } from "@/lib/labels";

type License = "research" | "eval" | "training";
const LICENSES: { key: License; label: string; body: string }[] = [
  { key: "research", label: "Research", body: "Study and analyse; no training or evaluation." },
  { key: "eval", label: "Evaluation", body: "Use in evals and benchmarks." },
  { key: "training", label: "Training", body: "Use to train or fine-tune models." },
];

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export function PriceCard({
  quotes,
  listingId,
  buyer = "none",
  held = [],
  defaultLicense = "research",
}: {
  quotes: Record<License, PriceQuote>;
  listingId?: string;
  /** Who is looking: a buyer can buy, a seller or visitor sees why not. */
  buyer?: "buyer" | "seller" | "none";
  /** Licences the viewer's team already holds on this trace. */
  held?: License[];
  /** The licence to show first (the buyer's stated use). */
  defaultLicense?: License;
}) {
  const [license, setLicense] = useState<License>(defaultLicense);
  const q = quotes[license];
  const chosen = LICENSES.find((l) => l.key === license)!;
  return (
    <section className="rounded-lg border border-rule bg-surface p-5" aria-label="Price">
      <div
        role="radiogroup"
        aria-label="License"
        className="grid grid-cols-3 gap-1 rounded-md bg-paper p-1 text-sm"
      >
        {LICENSES.map((l) => (
          <button
            key={l.key}
            type="button"
            role="radio"
            aria-checked={license === l.key}
            onClick={() => setLicense(l.key)}
            className={`rounded px-2 py-1.5 font-semibold ${
              license === l.key
                ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-rule)]"
                : "text-ink-2"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-4xl font-bold">
        <span className="price">{money(q.priceCents)}</span>
      </p>
      {q.band && (
        <p className="text-sm text-ink-3">
          Likely range {money(q.band.lowCents)}–{money(q.band.highCents)}
        </p>
      )}
      <p className="mt-1 text-sm text-ink-2">{chosen.body}</p>
      {held.includes(license) ? (
        <div className="mt-4 rounded-md border border-moss/40 bg-moss/5 p-3 text-sm">
          <p className="font-semibold text-moss">
            You hold {license === "eval" ? "an" : "a"} {chosen.label.toLowerCase()} licence
          </p>
          <a href={`/api/listings/${listingId}/download`} className="mt-1 inline-block text-cobalt">
            Download the trace
          </a>
        </div>
      ) : buyer === "buyer" && listingId ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <form action={buyNowAction}>
            <input type="hidden" name="listingId" value={listingId} />
            <input type="hidden" name="license" value={license} />
            <button className="btn w-full">Buy {chosen.label.toLowerCase()}</button>
          </form>
          <form action={addToCartAction}>
            <input type="hidden" name="listingId" value={listingId} />
            <button className="btn-quiet w-full">Add to cart</button>
          </form>
        </div>
      ) : (
        <>
          <button type="button" className="btn mt-4 w-full" disabled>
            Buy {chosen.label.toLowerCase()} license
          </button>
          <p className="mt-2 text-xs text-ink-3">
            {buyer === "seller"
              ? "Buying needs a buyer account."
              : "Sign in with a buyer account to buy."}
          </p>
        </>
      )}

      <h3 className="mt-6 text-sm font-semibold">Why this price</h3>
      <p className="mt-1 text-sm text-ink-2">{q.summary}</p>
      <table className="mt-2 w-full text-sm">
        <tbody>
          {q.drivers.map((d) => (
            <tr key={d.factor} className="border-t border-rule/70 align-top">
              <td className="py-1.5 pr-2 text-ink-2">{FACTOR_NAMES[d.factor] ?? d.factor}</td>
              <td
                className={`py-1.5 pr-2 font-semibold ${
                  d.direction === "up" ? "text-moss" : d.direction === "down" ? "text-brick" : ""
                }`}
              >
                {d.value.toFixed(2)}×
              </td>
              <td className="py-1.5 text-ink-2">{d.reason}</td>
            </tr>
          ))}
          <tr className="border-t border-rule/70 align-top">
            <td className="py-1.5 pr-2 text-ink-2">License</td>
            <td className="py-1.5 pr-2 font-semibold">{q.factors.license.toFixed(2)}×</td>
            <td className="py-1.5 text-ink-2">{chosen.label.toLowerCase()} use</td>
          </tr>
        </tbody>
      </table>
      {q.factors.capped && (
        <p className="mt-2 text-xs text-ink-3">Capped by the marketplace&apos;s price limits.</p>
      )}
    </section>
  );
}
