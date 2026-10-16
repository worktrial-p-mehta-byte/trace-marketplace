import type { Trace, TraceEvent } from "@tm/schema";

/**
 * Domains: what the agent was working on, independent of which harness ran
 * it. The same Claude Code session can be a medical evaluation, a literature
 * review or a SQL investigation. Labs buy by domain, so it is a label, a
 * facet, a rarity level and a demand segment.
 *
 * Detection is rule-based (term lexicons plus tool, file and command
 * signals) so it runs in the seller's browser: labels leave the machine,
 * content does not. Open-source uploads are re-labelled on the server
 * (verified); signals-only labels are the seller's browser's claims.
 */
export const DOMAIN_IDS = [
  "software_engineering",
  "data_querying",
  "research",
  "writing",
  "design",
  "medical",
  "legal",
  "finance",
  "customer_support",
  "devops",
  "science",
  "education",
  "web_tasks",
  "productivity",
  "unknown",
] as const;
export type DomainId = (typeof DOMAIN_IDS)[number];

export interface DomainDef {
  id: DomainId;
  name: string;
  description: string;
  /** Lowercase terms or phrases. A term ending in "*" matches as a prefix. */
  terms: string[];
  /** Especially distinctive terms, counted double. */
  strong?: string[];
  /** Tool names that point at this domain (weak evidence on their own). */
  tools?: string[];
  /** File extensions that point at this domain. */
  extensions?: string[];
}

export const DOMAINS: DomainDef[] = [
  {
    id: "software_engineering",
    name: "Software engineering",
    description: "Writing, fixing and testing code: features, bugs, refactors, builds.",
    terms: [
      "bug",
      "refactor",
      "function",
      "method",
      "class",
      "module",
      "import",
      "compile",
      "compiler",
      "build",
      "lint",
      "type error",
      "typescript",
      "javascript",
      "python",
      "rust",
      "golang",
      "java",
      "kotlin",
      "ruby",
      "c++",
      "c#",
      "swift",
      "scala",
      "php",
      "elixir",
      "haskell",
      "solidity",
      "cobol",
      "verilog",
      "vhdl",
      "api",
      "endpoint",
      "handler",
      "middleware",
      "dependency",
      "package",
      "npm",
      "pnpm",
      "pip",
      "cargo",
      "exception",
      "stack trace",
      "null pointer",
      "undefined",
      "regression",
      "pull request",
      "merge",
      "branch",
      "commit",
      "git",
      "repo",
      "repository",
      "unit test",
      "test suite",
      "failing test",
      "flaky",
      "ci",
      "pipeline",
      "assertion",
      "mock",
      "fixture",
      "parser",
      "serializ*",
      "async",
      "await",
      "callback",
      "promise",
      "thread",
      "mutex",
      "deadlock",
      "race condition",
      "memory leak",
      "schema migration",
      "orm",
      "framework",
      "react",
      "component",
      "hook",
      "render",
    ],
    strong: [
      "unit test",
      "failing test",
      "stack trace",
      "null pointer",
      "pull request",
      "refactor",
    ],
    tools: ["Edit", "MultiEdit", "Write", "Bash", "Grep", "Glob"],
    extensions: [
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "rs",
      "go",
      "java",
      "kt",
      "rb",
      "php",
      "cs",
      "swift",
      "c",
      "h",
      "cpp",
      "hpp",
      "ex",
      "hs",
      "scala",
      "dart",
      "lua",
      "zig",
      "sol",
      "cob",
      "cbl",
      "v",
      "sv",
      "vhd",
      "vhdl",
      "ml",
      "clj",
      "erl",
      "exs",
      "fs",
      "kts",
      "mjs",
      "cjs",
      "mts",
      "cts",
      "cc",
      "cxx",
      "nim",
    ],
  },
  {
    id: "data_querying",
    name: "Data and querying",
    description: "SQL and analytics: queries, joins, pipelines, dashboards, spreadsheets.",
    terms: [
      "sql",
      "query",
      "queries",
      "select",
      "join",
      "group by",
      "order by",
      "where clause",
      "aggregate",
      "aggregation",
      "table",
      "column",
      "row count",
      "rows",
      "dataset",
      "dataframe",
      "pandas",
      "csv",
      "parquet",
      "warehouse",
      "bigquery",
      "snowflake",
      "redshift",
      "postgres",
      "mysql",
      "duckdb",
      "pivot",
      "metric",
      "kpi",
      "dashboard",
      "report",
      "cohort",
      "funnel",
      "retention",
      "churn rate",
      "etl",
      "pipeline",
      "dbt",
      "spreadsheet",
      "sheet",
      "cell",
      "formula",
      "vlookup",
      "null values",
      "duplicates",
      "dedupe",
      "outlier",
      "histogram",
      "percentile",
      "median",
    ],
    strong: ["group by", "order by", "where clause", "dataframe", "warehouse", "vlookup", "dbt"],
    tools: ["Query", "RunQuery", "SQL", "ExecuteSQL", "Spreadsheet"],
    extensions: ["sql", "csv", "parquet", "ipynb", "xlsx"],
  },
  {
    id: "research",
    name: "Research and literature",
    description: "Finding, reading and synthesising sources: papers, reports, citations.",
    terms: [
      "paper",
      "papers",
      "literature",
      "literature review",
      "citation",
      "cite",
      "cited",
      "reference list",
      "bibliography",
      "abstract",
      "arxiv",
      "doi",
      "journal",
      "study",
      "studies",
      "survey",
      "meta-analysis",
      "findings",
      "evidence",
      "hypothesis",
      "methodology",
      "source",
      "sources",
      "summarize",
      "summarise",
      "synthesis",
      "synthesize",
      "related work",
      "prior work",
      "state of the art",
      "benchmark",
      "preprint",
      "peer review",
      "author",
      "published",
      "publication",
      "search results",
      "web search",
      "fact-check",
      "verify the claim",
    ],
    strong: [
      "literature review",
      "citation",
      "arxiv",
      "doi",
      "meta-analysis",
      "related work",
      "bibliography",
    ],
    tools: ["WebSearch", "WebFetch", "Search", "Fetch", "Browse"],
    extensions: ["bib", "pdf"],
  },
  {
    id: "writing",
    name: "Writing and editing",
    description: "Drafting and editing prose: documents, posts, emails, copy.",
    terms: [
      "draft",
      "drafting",
      "rewrite",
      "proofread",
      "edit the paragraph",
      "paragraph",
      "sentence",
      "tone",
      "voice",
      "wording",
      "headline",
      "blog post",
      "article",
      "essay",
      "newsletter",
      "press release",
      "copy",
      "tagline",
      "outline",
      "chapter",
      "manuscript",
      "readability",
      "grammar",
      "typo",
      "style guide",
      "word count",
      "shorten",
      "tighten",
      "concise",
      "audience",
      "call to action",
      "subject line",
      "memo",
      "announcement",
    ],
    strong: ["proofread", "blog post", "press release", "manuscript", "style guide", "word count"],
    extensions: ["md", "txt", "docx", "rtf"],
  },
  {
    id: "design",
    name: "Design",
    description: "Visual and product design: layouts, mockups, typography, colour, components.",
    terms: [
      "design",
      "mockup",
      "wireframe",
      "figma",
      "sketch",
      "prototype",
      "layout",
      "typography",
      "font",
      "typeface",
      "color palette",
      "colour palette",
      "palette",
      "spacing",
      "padding",
      "margin",
      "alignment",
      "grid",
      "icon",
      "logo",
      "brand",
      "visual hierarchy",
      "contrast",
      "accessibility",
      "wcag",
      "hover state",
      "button style",
      "component library",
      "design system",
      "design tokens",
      "illustration",
      "banner",
      "poster",
      "slide deck",
      "pixel",
      "svg",
      "responsive",
      "breakpoint",
      "dark mode",
    ],
    strong: [
      "mockup",
      "wireframe",
      "figma",
      "typography",
      "design system",
      "design tokens",
      "color palette",
      "colour palette",
    ],
    extensions: ["fig", "svg", "sketch", "psd", "ai", "css", "scss"],
  },
  {
    id: "medical",
    name: "Medical and clinical evaluation",
    description:
      "Clinical reasoning and evaluation: cases, symptoms, diagnoses, treatment, rubrics.",
    terms: [
      "patient",
      "patients",
      "clinical",
      "clinician",
      "diagnosis",
      "differential diagnosis",
      "symptom",
      "symptoms",
      "treatment",
      "dosage",
      "dose",
      "medication",
      "prescription",
      "contraindication",
      "side effect",
      "adverse",
      "vitals",
      "blood pressure",
      "heart rate",
      "lab results",
      "biopsy",
      "oncology",
      "cardiology",
      "radiology",
      "mri",
      "ct scan",
      "x-ray",
      "icd-10",
      "triage",
      "case notes",
      "chart review",
      "clinical trial",
      "cohort",
      "guideline",
      "rubric",
      "grader",
      "evaluation rubric",
      "physician",
      "nurse",
      "hospital",
      "discharge",
      "prognosis",
      "comorbidity",
      "pathology",
      "mg/dl",
      "mmol",
    ],
    strong: [
      "differential diagnosis",
      "contraindication",
      "icd-10",
      "clinical trial",
      "chart review",
      "case notes",
      "prognosis",
      "comorbidity",
    ],
    extensions: ["hl7", "dcm"],
  },
  {
    id: "legal",
    name: "Legal and compliance",
    description: "Contracts, policies, regulation and compliance review.",
    terms: [
      "contract",
      "clause",
      "agreement",
      "terms of service",
      "liability",
      "indemnif*",
      "statute",
      "regulation",
      "regulatory",
      "compliance",
      "gdpr",
      "hipaa",
      "ccpa",
      "jurisdiction",
      "counsel",
      "attorney",
      "lawyer",
      "plaintiff",
      "defendant",
      "court",
      "ruling",
      "precedent",
      "non-compete",
      "nda",
      "intellectual property",
      "license agreement",
      "breach",
      "arbitration",
      "due diligence",
      "policy review",
      "privacy policy",
      "legal review",
      "redline",
    ],
    strong: [
      "indemnif*",
      "jurisdiction",
      "plaintiff",
      "defendant",
      "arbitration",
      "non-compete",
      "redline",
    ],
    extensions: [],
  },
  {
    id: "finance",
    name: "Finance and accounting",
    description: "Budgets, forecasts, ledgers, invoices, tax and financial models.",
    terms: [
      "invoice",
      "invoices",
      "ledger",
      "accounts payable",
      "accounts receivable",
      "balance sheet",
      "income statement",
      "cash flow",
      "forecast",
      "budget",
      "revenue",
      "expense",
      "expenses",
      "margin",
      "ebitda",
      "depreciation",
      "amortization",
      "tax",
      "vat",
      "audit",
      "reconcile",
      "reconciliation",
      "journal entry",
      "fiscal",
      "quarter",
      "q1",
      "q2",
      "q3",
      "q4",
      "portfolio",
      "valuation",
      "dcf",
      "irr",
      "npv",
      "payroll",
      "cost of goods",
    ],
    strong: [
      "accounts payable",
      "accounts receivable",
      "balance sheet",
      "income statement",
      "ebitda",
      "reconciliation",
      "journal entry",
    ],
    extensions: ["xlsx", "qbo", "ofx"],
  },
  {
    id: "customer_support",
    name: "Customer support and operations",
    description: "Tickets, refunds, replies to customers, escalations and order operations.",
    terms: [
      "ticket",
      "tickets",
      "customer",
      "customers",
      "refund",
      "refunds",
      "order",
      "orders",
      "shipment",
      "tracking number",
      "escalate",
      "escalation",
      "complaint",
      "sla",
      "reply to the customer",
      "support",
      "helpdesk",
      "zendesk",
      "intercom",
      "chargeback",
      "subscription",
      "cancel the subscription",
      "account locked",
      "password reset",
      "apology",
      "goodwill credit",
      "return label",
      "warranty",
      "inquiry",
      "agent reply",
      "macro",
      "canned response",
      "csat",
    ],
    strong: [
      "goodwill credit",
      "chargeback",
      "return label",
      "canned response",
      "csat",
      "helpdesk",
    ],
    tools: [
      "lookup_ticket",
      "lookup_order",
      "issue_refund",
      "send_reply",
      "update_ticket",
      "escalate_ticket",
    ],
    extensions: [],
  },
  {
    id: "devops",
    name: "DevOps and infrastructure",
    description: "Deploys, containers, cloud resources, monitoring and incidents.",
    terms: [
      "deploy",
      "deployment",
      "kubernetes",
      "k8s",
      "kubectl",
      "helm",
      "docker",
      "container",
      "terraform",
      "ansible",
      "cloudformation",
      "aws",
      "gcp",
      "azure",
      "iam",
      "vpc",
      "subnet",
      "load balancer",
      "dns",
      "tls certificate",
      "nginx",
      "ingress",
      "pod",
      "node pool",
      "autoscal*",
      "incident",
      "on-call",
      "pagerduty",
      "alert",
      "prometheus",
      "grafana",
      "logs",
      "latency",
      "uptime",
      "rollback",
      "canary",
      "blue-green",
      "ci/cd",
      "github actions",
      "runbook",
      "outage",
      "cron job",
    ],
    strong: [
      "kubernetes",
      "kubectl",
      "terraform",
      "load balancer",
      "pagerduty",
      "rollback",
      "runbook",
      "outage",
    ],
    tools: ["Bash"],
    extensions: ["tf", "hcl", "yaml", "yml", "dockerfile"],
  },
  {
    id: "science",
    name: "Science and engineering computation",
    description: "Simulations, numerical methods, lab analysis and scientific computing.",
    terms: [
      "simulation",
      "simulate",
      "numerical",
      "differential equation",
      "ode",
      "pde",
      "matrix",
      "eigenvalue",
      "fourier",
      "fft",
      "monte carlo",
      "finite element",
      "mesh",
      "solver",
      "convergence",
      "tolerance",
      "experiment",
      "measurement",
      "calibration",
      "sensor",
      "spectrum",
      "wavelength",
      "protein",
      "genome",
      "sequence alignment",
      "molecule",
      "chemical",
      "reaction",
      "thermodynamic",
      "velocity",
      "pressure",
      "temperature",
      "physics",
      "chemistry",
      "biology",
      "matlab",
      "numpy",
      "scipy",
      "julia",
      "fortran",
    ],
    strong: [
      "differential equation",
      "eigenvalue",
      "monte carlo",
      "finite element",
      "sequence alignment",
      "fortran",
    ],
    extensions: ["m", "jl", "f90", "f", "nb", "mat"],
  },
  {
    id: "education",
    name: "Education and tutoring",
    description: "Lessons, exercises, quizzes, grading and explanations for learners.",
    terms: [
      "student",
      "students",
      "lesson",
      "lesson plan",
      "curriculum",
      "syllabus",
      "quiz",
      "exercise",
      "homework",
      "assignment",
      "grade",
      "grading",
      "rubric",
      "exam",
      "flashcard",
      "explain like",
      "tutor",
      "tutoring",
      "classroom",
      "teacher",
      "learning objective",
      "worksheet",
      "practice problems",
      "step by step",
      "concept",
      "misconception",
    ],
    strong: [
      "lesson plan",
      "curriculum",
      "syllabus",
      "flashcard",
      "learning objective",
      "worksheet",
    ],
    extensions: [],
  },
  {
    id: "web_tasks",
    name: "Web and browser tasks",
    description: "Navigating sites, filling forms, booking, purchasing and scraping.",
    // Words of the browser, not of building for it: "button", "form" and
    // "submit" are left out because front-end coding says them all day.
    terms: [
      "browser",
      "navigate",
      "click",
      "clicked",
      "fill in",
      "checkout",
      "add to cart",
      "cart",
      "login page",
      "sign in page",
      "captcha",
      "cookie banner",
      "screenshot",
      "web page",
      "website",
      "scrape",
      "scraping",
      "booking",
      "reservation",
      "flight",
      "hotel",
      "selector",
      "xpath",
      "playwright",
      "puppeteer",
    ],
    strong: ["add to cart", "captcha", "cookie banner", "xpath", "playwright", "puppeteer"],
    tools: [
      "navigate",
      "click",
      "type",
      "screenshot",
      "browser_navigate",
      "browser_click",
      "computer",
    ],
    extensions: [],
  },
  {
    id: "productivity",
    name: "Personal productivity",
    description: "Email, calendars, scheduling, notes and task management.",
    terms: [
      "email",
      "emails",
      "inbox",
      "calendar",
      "meeting",
      "schedule",
      "reschedule",
      "invite",
      "reminder",
      "to-do",
      "todo list",
      "task list",
      "notes",
      "agenda",
      "follow-up",
      "rsvp",
      "time zone",
      "availability",
      "slack message",
      "notion",
      "trello",
      "asana",
      "contacts",
      "trip",
      "itinerary",
      "appointment",
    ],
    strong: ["reschedule", "rsvp", "itinerary", "agenda", "inbox"],
    tools: ["send_email", "create_event", "list_events", "search_email", "create_task"],
    extensions: ["ics", "eml"],
  },
];

export const DOMAIN_BY_ID: Record<string, DomainDef> = Object.fromEntries(
  DOMAINS.map((d) => [d.id, d]),
);

export function domainName(id: string): string {
  return DOMAIN_BY_ID[id]?.name ?? (id === "unknown" ? "Unknown domain" : id.replace(/_/g, " "));
}

export interface DomainScore {
  domain: DomainId;
  /** Share of all domain evidence, 0..1. The shares sum to 1. */
  share: number;
}

export interface DomainDetection {
  primary: DomainId;
  /** How sure the detector is of the primary domain, 0..1. */
  confidence: number;
  /** Top domains by share (at most three, all with share > 0). */
  distribution: DomainScore[];
  /** Events that contributed most to the primary domain. */
  evidence: number[];
}

/** Weights by where the text came from: the user's task statement counts most. */
const SOURCE_WEIGHT = { user: 3, assistant: 1, input: 1, output: 0.35 };
const OUTPUT_CHARS = 2_000;
const TOOL_WEIGHT = 0.6;
const EXT_WEIGHT = 0.8;
/** Below this much evidence the primary domain is "unknown". */
const MIN_EVIDENCE = 2.5;

/** A term, compiled: its tokens and the weight of a hit. */
interface Term {
  domain: number;
  index: number;
  weight: number;
  tokens: string[];
  /** The last token matches as a prefix (terms written "serializ*"). */
  prefix: boolean;
}

interface Compiled {
  def: DomainDef;
  terms: Term[];
  tools: Set<string>;
  extensions: Set<string>;
}

interface Index {
  domains: Compiled[];
  /** Terms by their first token, longest phrase first. */
  byToken: Map<string, Term[]>;
  /** Terms whose first token is a prefix. */
  prefixed: Term[];
}

let index: Index | undefined;

/**
 * Words and numbers, keeping "+" and "#" inside a word for c++ and c#.
 * Hyphens, slashes and dots separate, so "x-ray" and "ci/cd" are two-token
 * phrases and "foo.bar" is two tokens.
 */
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}+#]*/gu;

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN) ?? [];
}

function compile(): Index {
  if (index) return index;
  const byToken = new Map<string, Term[]>();
  const prefixed: Term[] = [];
  const domains = DOMAINS.map((def, domain) => {
    const strong = new Set(def.strong ?? []);
    const terms = def.terms.map((t, i): Term => {
      const prefix = t.endsWith("*");
      const tokens = tokenize(prefix ? t.slice(0, -1) : t);
      if (!tokens.length) throw new Error(`Domain term has no tokens: ${t}`);
      return { domain, index: i, weight: strong.has(t) ? 2 : 1, tokens, prefix };
    });
    for (const term of terms) {
      if (term.prefix && term.tokens.length === 1) prefixed.push(term);
      else {
        const first = term.tokens[0]!;
        byToken.set(first, [...(byToken.get(first) ?? []), term]);
      }
    }
    return {
      def,
      terms,
      tools: new Set((def.tools ?? []).map((t) => t.toLowerCase())),
      extensions: new Set(def.extensions ?? []),
    };
  });
  for (const list of byToken.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
  index = { domains, byToken, prefixed };
  return index;
}

/** Call `hit` for every term occurrence in `text`. */
function matchTerms(text: string, hit: (term: Term) => void): void {
  const { byToken, prefixed } = compile();
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const candidates = byToken.get(tok);
    if (candidates) {
      for (const term of candidates) {
        const n = term.tokens.length;
        if (i + n > tokens.length) continue;
        let ok = true;
        for (let k = 1; k < n && ok; k++) {
          const want = term.tokens[k]!;
          const got = tokens[i + k]!;
          ok = term.prefix && k === n - 1 ? got.startsWith(want) : got === want;
        }
        if (ok) hit(term);
      }
    }
    for (const term of prefixed) if (tok.startsWith(term.tokens[0]!)) hit(term);
  }
}

function strings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
}

function pathsOf(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const i = input as Record<string, unknown>;
  return ["file_path", "path", "notebook_path", "filePath"]
    .map((k) => i[k])
    .filter((v): v is string => typeof v === "string");
}

/** Weighted hits of one term across the trace, and where they came from. */
interface TermHits {
  hits: number;
  byEvent: Map<number, number>;
}

/**
 * Detect the domain of a trace from its content and structure. Pure and
 * browser-safe. Returns a primary domain with a confidence and the share
 * of evidence per domain, so a session can be "70% coding, 30% medical".
 *
 * Structural evidence (tools used, file types touched) counts per call.
 * Term evidence is pooled across the whole trace with diminishing returns
 * per term, so the subject of a session ("the signup form", "the orders
 * table") repeated in every message can't carry a domain by itself.
 */
export function detectDomains(trace: Trace): DomainDetection {
  const cs = compile().domains;
  const totals = new Map<DomainId, number>(cs.map((c) => [c.def.id, 0]));
  const perEvent = new Map<DomainId, Map<number, number>>(cs.map((c) => [c.def.id, new Map()]));
  const add = (id: DomainId, seq: number, v: number) => {
    if (v <= 0) return;
    totals.set(id, (totals.get(id) ?? 0) + v);
    const m = perEvent.get(id)!;
    m.set(seq, (m.get(seq) ?? 0) + v);
  };
  const termHits: TermHits[][] = cs.map((c) =>
    c.terms.map(() => ({ hits: 0, byEvent: new Map() })),
  );
  const texts: { seq: number; text: string; weight: number }[] = [];
  if (trace.title) texts.push({ seq: -1, text: trace.title, weight: SOURCE_WEIGHT.user });
  for (const e of trace.events as TraceEvent[]) {
    switch (e.type) {
      case "user_message":
        texts.push({ seq: e.seq, text: e.text, weight: SOURCE_WEIGHT.user });
        break;
      case "assistant_message":
        texts.push({ seq: e.seq, text: e.text, weight: SOURCE_WEIGHT.assistant });
        break;
      case "tool_call": {
        const parts: string[] = [];
        strings(e.input, parts);
        texts.push({ seq: e.seq, text: parts.join("\n"), weight: SOURCE_WEIGHT.input });
        const tool = e.tool.toLowerCase();
        for (const c of cs) if (c.tools.has(tool)) add(c.def.id, e.seq, TOOL_WEIGHT);
        for (const p of pathsOf(e.input)) {
          const ext = p.split(".").pop()?.toLowerCase();
          const base = p.split("/").pop()?.toLowerCase();
          for (const c of cs) {
            if ((ext && c.extensions.has(ext)) || (base && c.extensions.has(base)))
              add(c.def.id, e.seq, EXT_WEIGHT);
          }
        }
        break;
      }
      case "tool_result":
        texts.push({
          seq: e.seq,
          text: e.output.slice(0, OUTPUT_CHARS),
          weight: SOURCE_WEIGHT.output,
        });
        break;
      case "system":
        break;
    }
  }
  for (const t of texts) {
    if (!t.text) continue;
    matchTerms(t.text, (term) => {
      const h = termHits[term.domain]![term.index]!;
      h.hits += t.weight;
      h.byEvent.set(t.seq, (h.byEvent.get(t.seq) ?? 0) + t.weight);
    });
  }
  cs.forEach((c, ci) => {
    c.terms.forEach((term, ti) => {
      const h = termHits[ci]![ti]!;
      if (!h.hits) return;
      const score = term.weight * Math.log2(1 + h.hits);
      // Credit the events in proportion to the hits they contributed.
      for (const [seq, v] of h.byEvent) add(c.def.id, seq, (score * v) / h.hits);
    });
  });

  const ranked = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  if (!ranked.length || total < MIN_EVIDENCE) {
    return { primary: "unknown", confidence: 0.2, distribution: [], evidence: [] };
  }
  const [top, topScore] = ranked[0]!;
  const second = ranked[1]?.[1] ?? 0;
  // Sure when the leader is well clear of the runner-up and there is enough evidence.
  const margin = 1 - second / topScore;
  const support = Math.min(1, total / 12);
  const confidence = Math.round(100 * Math.min(0.97, 0.35 + 0.45 * margin + 0.2 * support)) / 100;
  const distribution = ranked
    .slice(0, 3)
    .map(([domain, v]) => ({ domain, share: Math.round((100 * v) / total) / 100 }));
  const evidence = [...perEvent.get(top)!.entries()]
    .filter(([seq]) => seq >= 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([seq]) => seq)
    .sort((a, b) => a - b);
  return { primary: top, confidence, distribution, evidence };
}
