import { DOMAINS, KNOWN_FRAMEWORKS, KNOWN_LANGUAGES } from "@tm/enrich";

/**
 * The deterministic intent parser: a buyer types what they need in plain
 * words ("medical evaluations where the agent was corrected and recovered")
 * and it becomes facets, shown as chips the buyer can remove. Curated
 * aliases only, so it runs locally, instantly, and never claims more than
 * it recognised; whatever it does not recognise stays as free text.
 */
export type IntentKey =
  | "domain"
  | "language"
  | "framework"
  | "failure"
  | "outcome"
  | "tier"
  | "authenticity"
  | "behaviour";

export interface IntentChip {
  key: IntentKey;
  value: string;
  /** The words in the query that produced it. */
  phrase: string;
}

export interface ParsedIntent {
  chips: IntentChip[];
  /** Words left over, for lexical search. */
  rest: string;
}

/** Behaviours: properties of a session's shape, matched on its traits rather than its text. */
export const BEHAVIOURS: Record<string, { name: string; aliases: string[] }> = {
  repeats: {
    name: "Repeats the same call",
    aliases: [
      "same command again",
      "same command",
      "repeating",
      "repeated",
      "repeats",
      "over and over",
      "keeps rerunning",
      "reruns",
    ],
  },
  many_tools: {
    name: "Uses many tools",
    aliases: ["many tools", "lots of tools", "multi tool", "multi-tool", "tool heavy"],
  },
  long: {
    name: "Long session",
    aliases: ["long session", "long sessions", "marathon", "long running", "long-running"],
  },
  short: { name: "Short session", aliases: ["short session", "short sessions", "quick"] },
  compaction: {
    name: "Context compacted",
    aliases: ["compaction", "compacted", "context compaction", "ran out of context"],
  },
  preference_pairs: {
    name: "Has preference pairs",
    aliases: ["preference pairs", "preference pair", "preference data", "rlhf", "dpo"],
  },
};

const FAILURE_ALIASES: Record<string, string[]> = {
  retry_loop: [
    "retry loop",
    "retry loops",
    "retrying",
    "retries",
    "stuck in a loop",
    "stuck",
    "loops",
    "looping",
  ],
  user_correction: [
    "user corrected",
    "corrected",
    "corrections",
    "correction",
    "pushback",
    "pushed back",
    "told it was wrong",
    "user said no",
  ],
  tool_rejected: ["rejected", "rejection", "refused", "denied", "blocked action", "user rejected"],
  user_interrupt: [
    "interrupted",
    "interrupt",
    "interruptions",
    "stopped by the user",
    "user stopped",
  ],
  test_tampering: [
    "test tampering",
    "tampering",
    "tampered",
    "deleted the test",
    "deleted tests",
    "weakened the test",
    "weakened tests",
    "cheating",
    "cheated",
    "reward hacking",
  ],
  tool_error: ["tool errors", "tool error", "errors", "error", "failing", "failed", "crashes"],
  harness_error: ["api errors", "api error", "rate limit", "overloaded"],
};

const OUTCOME_ALIASES: Record<string, string[]> = {
  recovered: ["recovered", "recovery", "recovers", "got past it", "fixed itself", "self-corrected"],
  unresolved: ["unresolved", "gave up", "never fixed", "not fixed", "failed in the end"],
  tests_passed: [
    "tests pass",
    "tests passed",
    "tests passing",
    "passing tests",
    "green tests",
    "verified fix",
  ],
  clean: ["clean", "no failures", "successful", "happy path"],
};

const DOMAIN_EXTRA: Record<string, string[]> = {
  software_engineering: [
    "coding",
    "code",
    "programming",
    "software",
    "bug fix",
    "bug fixes",
    "refactor",
  ],
  data_querying: [
    "sql",
    "queries",
    "query",
    "data",
    "analytics",
    "warehouse",
    "dbt",
    "dashboards",
    "spreadsheet",
  ],
  research: ["research", "literature", "papers", "citations", "literature review"],
  writing: ["writing", "editing", "copywriting", "proofreading", "drafting"],
  design: ["design", "ui design", "figma", "mockups", "typography"],
  medical: [
    "medical",
    "clinical",
    "healthcare",
    "health care",
    "patient",
    "patients",
    "triage",
    "diagnosis",
    "clinical evaluation",
    "medical evaluation",
  ],
  legal: ["legal", "contracts", "contract review", "compliance", "law"],
  finance: ["finance", "financial", "accounting", "bookkeeping", "ledger", "invoices"],
  customer_support: ["customer support", "support tickets", "support", "helpdesk", "refunds"],
  devops: [
    "devops",
    "infrastructure",
    "infra",
    "kubernetes",
    "terraform",
    "deployments",
    "incidents",
  ],
  science: ["science", "scientific", "simulation", "simulations", "numerical"],
  education: ["education", "tutoring", "teaching", "grading homework", "lesson plans"],
  web_tasks: ["web tasks", "browser", "browsing", "web automation", "form filling", "booking"],
  productivity: ["productivity", "calendar", "email", "scheduling", "inbox"],
};

const TIER_ALIASES: Record<string, string[]> = {
  "0": ["open source", "open-source", "full content", "with content"],
  "1": ["signals only", "signals-only", "structure only"],
};

const AUTHENTICITY_ALIASES: Record<string, string[]> = {
  consistent: ["authentic", "verified", "consistent", "trustworthy", "real sessions"],
};

/** Words that carry no meaning in a search ("sessions where the agent…"). */
const STOP = new Set(
  "a an the and or of in on for to with where which that who whose was were is are be been it its this these those some any agent agents model session sessions trace traces example examples find show me i want need looking like from by at as".split(
    " ",
  ),
);

interface Alias {
  key: IntentKey;
  value: string;
  tokens: string[];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);

/** Plurals match singulars: "evaluations" is "evaluation", "loops" is "loop". */
const stem = (w: string) =>
  w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
const norm = (s: string) => words(s).map(stem);

let aliases: Alias[] | undefined;

function vocabulary(): Alias[] {
  if (aliases) return aliases;
  const out: Alias[] = [];
  const add = (key: IntentKey, value: string, phrase: string) =>
    out.push({ key, value, tokens: norm(phrase) });
  for (const d of DOMAINS) {
    add("domain", d.id, d.name);
    for (const a of DOMAIN_EXTRA[d.id] ?? []) add("domain", d.id, a);
  }
  // One- and two-letter names ("Go", "C", "R") are ordinary words in a
  // sentence; they need their long form or a symbol ("golang", "C++").
  for (const l of KNOWN_LANGUAGES) if (l.length > 2 || /[+#]/.test(l)) add("language", l, l);
  add("language", "Go", "golang");
  for (const f of KNOWN_FRAMEWORKS) add("framework", f, f);
  for (const [v, as] of Object.entries(FAILURE_ALIASES)) for (const a of as) add("failure", v, a);
  for (const [v, as] of Object.entries(OUTCOME_ALIASES)) for (const a of as) add("outcome", v, a);
  for (const [v, as] of Object.entries(TIER_ALIASES)) for (const a of as) add("tier", v, a);
  for (const [v, as] of Object.entries(AUTHENTICITY_ALIASES))
    for (const a of as) add("authenticity", v, a);
  for (const [v, b] of Object.entries(BEHAVIOURS))
    for (const a of b.aliases) add("behaviour", v, a);
  // Longest phrases first, so "retry loop" wins over "loop" and "clinical
  // evaluation" over "evaluation".
  out.sort((a, b) => b.tokens.length - a.tokens.length);
  aliases = out;
  return out;
}

/** Facets that can hold one value; later mentions don't override the first. */
const SINGLE: IntentKey[] = [
  "domain",
  "language",
  "framework",
  "failure",
  "outcome",
  "tier",
  "authenticity",
];

export function parseIntent(text: string): ParsedIntent {
  const original = words(text);
  const tokens = original.map(stem);
  const used = new Array(tokens.length).fill(false);
  const chips: IntentChip[] = [];
  /** Where in the query each chip starts, to list them in the buyer's order. */
  const at = new Map<IntentChip, number>();
  const vocab = vocabulary();
  for (const a of vocab) {
    const n = a.tokens.length;
    for (let i = 0; i + n <= tokens.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      if (!a.tokens.every((t, k) => tokens[i + k] === t)) continue;
      if (SINGLE.includes(a.key) && chips.some((c) => c.key === a.key)) {
        // A second value for a single facet: consume the words, keep the first.
        if (chips.some((c) => c.key === a.key && c.value === a.value)) used.fill(true, i, i + n);
        continue;
      }
      if (chips.some((c) => c.key === a.key && c.value === a.value)) {
        used.fill(true, i, i + n);
        continue;
      }
      used.fill(true, i, i + n);
      const chip = { key: a.key, value: a.value, phrase: original.slice(i, i + n).join(" ") };
      at.set(chip, i);
      chips.push(chip);
    }
  }
  chips.sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
  const rest = original
    .filter((t, i) => !used[i] && !STOP.has(t) && !STOP.has(tokens[i]!))
    .join(" ");
  return { chips, rest };
}
