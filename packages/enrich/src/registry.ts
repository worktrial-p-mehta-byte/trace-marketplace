import { DOMAINS } from "./domains";
import { FAILURE_CODES, OUTCOME_CODES, SIGNAL_CODES } from "./labels";

/**
 * The label vocabulary, in one place. Codes are namespaced by kind; new
 * kinds and codes are added here (or by a labeler plugin at runtime through
 * `registerLabel`) without touching the catalog, search or pricing code,
 * which read names and descriptions from the registry.
 */
export type LabelKindId = "failure" | "outcome" | "signal" | "domain";

export interface LabelDef {
  kind: LabelKindId;
  code: string;
  name: string;
  description: string;
}

const FAILURE_DEFS: Record<(typeof FAILURE_CODES)[number], [string, string]> = {
  test_tampering: [
    "Test tampering",
    "The agent tried to delete or weaken a failing test instead of fixing the code.",
  ],
  retry_loop: ["Retry loop", "The same tool failed three or more times in a row."],
  user_correction: ["User corrected it", "The user told the agent it was wrong."],
  tool_rejected: ["User rejected an action", "The user refused an action the agent proposed."],
  user_interrupt: ["User interrupted", "The user stopped the agent mid-action."],
  tool_error: ["Tool errors", "A tool call returned an error."],
  harness_error: ["API errors", "The agent harness reported an API error."],
};

const OUTCOME_DEFS: Record<(typeof OUTCOME_CODES)[number], [string, string]> = {
  tests_passed_at_end: ["Tests pass at end", "The last check the agent ran passed."],
  tests_failed_at_end: ["Tests fail at end", "The last check the agent ran failed."],
  recovered: ["Recovered", "The session had a failure and the agent got past it."],
  unresolved: ["Unresolved", "The session had a failure the agent did not get past."],
};

const SIGNAL_DEFS: Record<(typeof SIGNAL_CODES)[number], [string, string]> = {
  context_compaction: ["Context compacted", "The conversation was compacted at least once."],
  long_session: ["Long session", "A hundred or more conversational events."],
  no_model_output: ["No model output", "The session has no replies from the model."],
};

const registry = new Map<string, LabelDef>();
const key = (kind: LabelKindId, code: string) => `${kind}:${code}`;

export function registerLabel(def: LabelDef): void {
  registry.set(key(def.kind, def.code), def);
}

for (const [code, [name, description]] of Object.entries(FAILURE_DEFS)) {
  registerLabel({ kind: "failure", code, name, description });
}
for (const [code, [name, description]] of Object.entries(OUTCOME_DEFS)) {
  registerLabel({ kind: "outcome", code, name, description });
}
for (const [code, [name, description]] of Object.entries(SIGNAL_DEFS)) {
  registerLabel({ kind: "signal", code, name, description });
}
for (const d of DOMAINS) {
  registerLabel({ kind: "domain", code: d.id, name: d.name, description: d.description });
}
registerLabel({
  kind: "domain",
  code: "unknown",
  name: "Unknown domain",
  description: "Not enough evidence to tell what the session was about.",
});

export function labelDef(kind: LabelKindId, code: string): LabelDef | undefined {
  return registry.get(key(kind, code));
}

/** Display name for a code; falls back to the code with underscores as spaces. */
export function labelName(kind: LabelKindId, code: string): string {
  return registry.get(key(kind, code))?.name ?? code.replace(/_/g, " ");
}

export function labelDescription(kind: LabelKindId, code: string): string | undefined {
  return registry.get(key(kind, code))?.description;
}

export function labelsOfKind(kind: LabelKindId): LabelDef[] {
  return [...registry.values()].filter((d) => d.kind === kind);
}

/** Each failure as a clause, for sentences like "sessions where …". */
const FAILURE_CLAUSES: Record<string, string> = {
  test_tampering: "the agent tampered with a test",
  retry_loop: "the agent got stuck retrying",
  user_correction: "the person corrected the agent",
  tool_rejected: "the person refused an action",
  user_interrupt: "the person interrupted the agent",
  tool_error: "tools failed",
  harness_error: "the harness hit API errors",
};

export function failureClause(code: string): string {
  return FAILURE_CLAUSES[code] ?? `there was ${labelName("failure", code).toLowerCase()}`;
}
