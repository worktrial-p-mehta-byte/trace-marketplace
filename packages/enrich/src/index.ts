import type { Label, Trace } from "@tm/schema";

/** Produces labels from a scrubbed trace. Heuristic labelers arrive in M2. */
export interface Labeler {
  readonly name: string;
  label(trace: Trace): Label[];
}

/**
 * Traits the pricing policy reads. Extracted once per trace and stored,
 * so pricing never re-parses trace content.
 */
export interface TraceTraits {
  turns: number;
  toolCalls: number;
  toolErrors: number;
  userCorrections: number;
  interrupts: number;
  hadFailure: boolean;
  recovered: boolean;
  preferencePairs: number;
  testsRanAtEnd: boolean;
  truncated: boolean;
  redactionDensity: number;
  language?: string;
  framework?: string;
  failureCategory?: string;
  model: string;
  modelDeprecated: boolean;
  capturedAt: string;
}
