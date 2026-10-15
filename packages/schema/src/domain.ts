import { z } from "zod";

/**
 * Sharing tiers. v0 supports tiers 0 and 1; the rest exist so consent
 * records and policy checks never need a migration to add them.
 */
export const Tier = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type Tier = z.infer<typeof Tier>;

export const TIER_NAMES: Record<Tier, string> = {
  0: "Open source",
  1: "Signals only",
  2: "Abstracted",
  3: "Full private",
  4: "Employer-authorized",
};

export const V0_SUPPORTED_TIERS: readonly Tier[] = [0, 1];

export const LicenseScope = z.enum(["research", "eval", "training"]);
export type LicenseScope = z.infer<typeof LicenseScope>;

export const AssetKind = z.enum([
  "scrubbed_trace",
  "labels",
  "signals",
  "preference_pairs",
  "task_bundle",
]);
export type AssetKind = z.infer<typeof AssetKind>;

export const LabelKind = z.enum(["failure", "outcome", "signal"]);
export const LabelSource = z.enum(["heuristic", "model", "human"]);

export const Label = z.object({
  kind: LabelKind,
  /** Machine code, e.g. "tool_error_loop", "user_correction", "tests_passed". */
  code: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: LabelSource,
  /** Event seq numbers that support the label. */
  evidence: z.array(z.number().int().nonnegative()).default([]),
});
export type Label = z.infer<typeof Label>;

export const UserRole = z.enum(["seller", "buyer", "both", "admin"]);
export type UserRole = z.infer<typeof UserRole>;

/** Money is always integer cents. */
export type Cents = number;
