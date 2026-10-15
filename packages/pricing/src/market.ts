import type { TraceTraits } from "@tm/enrich";

/**
 * What a buyer is looking for. Every field is optional; a signal matches a
 * trace when all of its set fields match (case-insensitive).
 */
export interface DemandCriteria {
  language?: string;
  framework?: string;
  failure?: string;
  model?: string;
}

export interface DemandSignalInput {
  criteria: DemandCriteria;
  weight: number;
  createdAt: Date;
}

type Matchable = Pick<TraceTraits, "language" | "framework" | "failureCategory" | "model">;

const eq = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

export function matchesCriteria(t: Matchable, c: DemandCriteria): boolean {
  if (c.language && !eq(c.language, t.language)) return false;
  if (c.framework && !eq(c.framework, t.framework)) return false;
  if (c.failure && !eq(c.failure, t.failureCategory)) return false;
  if (c.model && !eq(c.model, t.model)) return false;
  return true;
}

/** True when a signal has no criteria at all (it would match everything). */
export function isEmptyCriteria(c: DemandCriteria): boolean {
  return !c.language && !c.framework && !c.failure && !c.model;
}

/**
 * Demand pressure on one trace: each recent matching signal contributes its
 * weight divided by how many listings it matches, so a bounty for a rare
 * combination moves those few prices a lot and a broad search moves many
 * prices a little.
 */
export function demandPressure(
  traits: Matchable,
  signals: DemandSignalInput[],
  supplyFor: (c: DemandCriteria) => number,
  now: Date,
  windowDays: number,
): number {
  const since = now.getTime() - windowDays * 86_400_000;
  let pressure = 0;
  for (const s of signals) {
    if (s.createdAt.getTime() < since || isEmptyCriteria(s.criteria)) continue;
    if (!matchesCriteria(traits, s.criteria)) continue;
    pressure += s.weight / Math.max(1, supplyFor(s.criteria));
  }
  return pressure;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Split a sale between seller and platform. Rounds in the seller's favour by
 * at most one cent so the two parts always add up to the price. Lives here
 * so the browser can show sellers their estimated earnings.
 */
export function splitSale(
  priceCents: number,
  sellerShare: number,
): { seller: number; platform: number } {
  const seller = Math.ceil(priceCents * sellerShare);
  return { seller, platform: priceCents - seller };
}
