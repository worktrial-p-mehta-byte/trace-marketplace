import type { Trace } from "@tm/schema";

/** One redaction made by a scrubber stage, kept so the review screen can show it. */
export interface Redaction {
  stage: string;
  /** Category shown to the seller, e.g. "api_key", "email", "home_path". */
  kind: string;
  eventSeq: number;
}

/**
 * A scrubber stage transforms text and reports what it removed. Stages run
 * in order; rules for secrets come first and are zero-tolerance. An ML or
 * LLM scrubber later is just another stage. Rules arrive in M2.
 */
export interface ScrubStage {
  readonly name: string;
  scrubText(text: string): { text: string; kinds: string[] };
}

export interface ScrubResult {
  trace: Trace;
  redactions: Redaction[];
}
