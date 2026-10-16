import type { Enrichment } from "@tm/enrich";
import type { PriceDriver } from "@tm/pricing";
import type { ScrubResult } from "@tm/scrub";
import type { Trace } from "@tm/schema";

export interface Quote {
  priceCents: number;
  sellerCents: number;
  summary: string;
  drivers: PriceDriver[];
  /** The seller's share for this session (it can differ by domain). */
  sellerShare?: number;
  /** Where the price is likely to settle. */
  band?: { lowCents: number; highCents: number };
}

export interface ShareOutcome {
  traceId: string;
  listingId: string;
  priceCents: number;
  sellerCents: number;
  labels: string[];
  pricePending?: boolean;
  /** Campaigns that bought the trace the moment it was listed. */
  campaignFills?: number;
}

export interface Item {
  key: string;
  fileName: string;
  raw: Trace;
  scrub: ScrubResult;
  enrich: Enrichment;
  tier: 0 | 1;
  /** Seller confirms the work is open source or their own (required for tier 0). */
  rightToShare: boolean;
  /** Seller made this session on purpose to show a failure (failure lab). */
  staged: boolean;
  selected: boolean;
  eligible: boolean;
  ineligibleReason?: string;
  quote?: Quote;
  state: "ready" | "sharing" | "shared" | "error";
  message?: string;
  outcome?: ShareOutcome;
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
