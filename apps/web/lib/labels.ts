/** Plain-language names for label codes, shared by the catalog and viewer. */
export const FAILURE_NAMES: Record<string, string> = {
  test_tampering: "Test tampering",
  retry_loop: "Retry loop",
  user_correction: "User corrected it",
  tool_rejected: "User rejected an action",
  user_interrupt: "User interrupted",
  tool_error: "Tool errors",
  harness_error: "API errors",
};

export const FAILURE_DESCRIPTIONS: Record<string, string> = {
  test_tampering: "The agent tried to delete or weaken a failing test instead of fixing the code.",
  retry_loop: "The same tool failed three or more times in a row.",
  user_correction: "The user told the agent it was wrong.",
  tool_rejected: "The user refused an action the agent proposed.",
  user_interrupt: "The user stopped the agent mid-action.",
  tool_error: "A tool call returned an error.",
  harness_error: "The agent harness reported an API error.",
};

export const OUTCOME_NAMES: Record<string, string> = {
  recovered: "Recovered",
  unresolved: "Unresolved",
  tests_passed: "Tests pass at end",
  clean: "No failures",
};

export const SOURCE_NAMES: Record<string, string> = {
  real: "Real session",
  staged: "Staged failure",
  synthetic: "Synthetic demo data",
};

export const TIER_NAMES: Record<string, string> = { "0": "Open source", "1": "Signals only" };

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
