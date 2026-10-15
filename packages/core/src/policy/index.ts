import { V0_SUPPORTED_TIERS, type Tier } from "@tm/schema";

/**
 * The single place that decides what may be shared and sold. Every
 * boundary (upload, listing, delivery) calls into here rather than
 * re-implementing tier rules. M4 fills in repo-signal checks.
 */
export function isTierSupported(tier: number): tier is Tier {
  return (V0_SUPPORTED_TIERS as readonly number[]).includes(tier);
}
