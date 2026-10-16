/**
 * The demo catalog's world: domains with how common they are, the stacks
 * (languages, frameworks, settings) inside each, failure patterns, models
 * and the nouns titles are built from. Weights make everyday work common
 * and niche work rare, so rarity pricing has something to work with.
 *
 * Domain ids mirror `@tm/enrich`'s taxonomy (a test keeps them in step);
 * the generator must not depend on the labeler at runtime.
 */
export type SynthDomain =
  | "software_engineering"
  | "data_querying"
  | "research"
  | "writing"
  | "design"
  | "medical"
  | "legal"
  | "finance"
  | "customer_support"
  | "devops"
  | "science"
  | "education"
  | "web_tasks"
  | "productivity";

export interface Stack {
  /** Facet values; left out for work that has no programming language. */
  language?: string;
  framework?: string;
  /** Extension of the things the agent reads and edits. */
  ext: string;
  /**
   * The command that checks the work at the end (coding packs run it with
   * Bash, so the labeler can read a pass/fail outcome). Packs without a
   * command check through their own tool, see `DomainPack.check`.
   */
  testCmd?: string;
  /** Text that makes the stack detectable (imports, commands, product names). */
  mentions: string[];
  /** How common this stack is within its domain. */
  weight: number;
  nouns: string[];
}

/** A tool call shape: the input fields and the output, as templates. */
export interface CallShape {
  tool: string;
  /** Input fields; string values are templates (see `fill` in generate.ts). */
  input: Record<string, string | number | boolean>;
  output: string;
}

/**
 * Everything that differs between domains: the task the user states, the
 * tools the agent works with, what checking the work looks like, which
 * action a user refuses, and the stacks the domain spans.
 */
export interface DomainPack {
  domain: SynthDomain;
  /** Share of the catalog, relative to the other packs. */
  weight: number;
  /** The harness that recorded the session. */
  harness: string;
  /**
   * What the user asks for, after the title. Carries the domain's vocabulary
   * so the real labeler recognises the domain (a test checks it does).
   */
  briefs: string[];
  /** Titles per failure pattern; patterns left out use the generic titles. */
  titles?: Partial<Record<Pattern, string[]>>;
  /** First look at the material. */
  read: CallShape;
  /** Finding related material. */
  search: CallShape;
  /** The change the agent makes. */
  act: CallShape;
  /** Checking the work; `ok`/`fail` are the verdicts, `error` a broken check. */
  check: CallShape & { fail: string; error: string };
  /** The action the user refuses in the tool_rejected pattern. */
  risky: CallShape;
  /** Things the user says when correcting the agent (must read as corrections). */
  corrections: string[];
  /** Agent filler between the main steps. */
  notes: string[];
  /** Filler reads between the main steps. */
  skims: CallShape;
  /** Whether the agent can tamper with tests here (needs a test file and assertions). */
  tampering: boolean;
  stacks: Stack[];
}

export type Pattern =
  | "clean"
  | "tool_error"
  | "retry_loop"
  | "user_correction"
  | "tool_rejected"
  | "user_interrupt"
  | "test_tampering";

export const PATTERNS: { pattern: Pattern; weight: number }[] = [
  { pattern: "clean", weight: 25 },
  { pattern: "tool_error", weight: 25 },
  { pattern: "user_correction", weight: 15 },
  { pattern: "retry_loop", weight: 12 },
  { pattern: "tool_rejected", weight: 8 },
  { pattern: "user_interrupt", weight: 6 },
  { pattern: "test_tampering", weight: 5 },
];

export const MODELS: { id: string; weight: number }[] = [
  { id: "claude-sonnet-4-5", weight: 45 },
  { id: "claude-opus-5-5", weight: 25 },
  { id: "claude-sonnet-5-5", weight: 15 },
  { id: "claude-haiku-4-5", weight: 15 },
];

/** Titles for coding sessions. */
export const PATTERN_TITLES: Record<Pattern, string[]> = {
  clean: [
    "Add {noun} tests",
    "Refactor the {noun}",
    "Document the {noun}",
    "Small fix in the {noun}",
  ],
  tool_error: ["{noun} build breaks", "Fix failing {noun} tests", "{noun} throws on empty input"],
  retry_loop: [
    "{noun} keeps failing in CI",
    "Agent stuck rerunning the {noun} tests",
    "{noun} flaky under load",
  ],
  user_correction: [
    "{noun} rewritten the wrong way",
    "Agent misread the {noun} spec",
    "{noun} change reverted by the user",
  ],
  tool_rejected: [
    "Risky {noun} change rejected",
    "Agent tried to drop the {noun} table",
    "{noun} force-push blocked",
  ],
  user_interrupt: ["Agent went off track on the {noun}", "{noun} edit stopped midway"],
  test_tampering: ["{noun} test deleted instead of fixed", "Agent weakened the {noun} assertions"],
};

/** Titles for every other kind of work. */
export const GENERIC_TITLES: Record<Pattern, string[]> = {
  clean: ["Work through the {noun}", "Prepare the {noun}", "Update the {noun}"],
  tool_error: ["{noun} check fails", "Error while checking the {noun}"],
  retry_loop: ["Agent stuck re-running the {noun} check", "{noun} keeps failing"],
  user_correction: ["Agent misread the {noun} brief", "{noun} redone the wrong way"],
  tool_rejected: ["Risky {noun} action rejected", "Agent tried to go too far on the {noun}"],
  user_interrupt: ["Agent went off track on the {noun}", "{noun} work stopped midway"],
  test_tampering: [],
};

const CODING_CORRECTIONS = [
  "No, that's not what I asked for. Keep the existing behaviour.",
  "That's wrong, don't change the public API.",
  "Wait, revert that and only touch the parser.",
];

const CODING_STACKS: Stack[] = [
  {
    language: "TypeScript",
    framework: "React",
    ext: "tsx",
    testCmd: "npm test",
    mentions: ["import React from 'react'", "react-dom"],
    weight: 18,
    nouns: ["signup form", "settings page", "data table", "date picker", "modal"],
  },
  {
    language: "TypeScript",
    framework: "Next.js",
    ext: "ts",
    testCmd: "npm test",
    mentions: ["next build", "import Link from 'next/link'"],
    weight: 10,
    nouns: ["checkout page", "API route", "middleware", "image loader"],
  },
  {
    language: "TypeScript",
    framework: "Express",
    ext: "ts",
    testCmd: "npm test",
    mentions: ["import express from 'express'", "express.Router()"],
    weight: 6,
    nouns: ["rate limiter", "auth middleware", "webhook handler"],
  },
  {
    language: "Python",
    framework: "Django",
    ext: "py",
    testCmd: "pytest",
    mentions: ["from django.db import models", "django migrations"],
    weight: 8,
    nouns: ["migration", "admin view", "ORM query", "signup flow"],
  },
  {
    language: "Python",
    framework: "FastAPI",
    ext: "py",
    testCmd: "pytest",
    mentions: ["from fastapi import FastAPI", "fastapi.Depends"],
    weight: 8,
    nouns: ["auth dependency", "background task", "upload endpoint"],
  },
  {
    language: "Python",
    framework: "pandas",
    ext: "py",
    testCmd: "pytest",
    mentions: ["import pandas as pd", "pandas DataFrame"],
    weight: 5,
    nouns: ["CSV importer", "billing export", "report job"],
  },
  {
    language: "Python",
    framework: "PyTorch",
    ext: "py",
    testCmd: "pytest",
    mentions: ["import torch", "torch.nn"],
    weight: 4,
    nouns: ["training loop", "data loader", "checkpoint loader"],
  },
  {
    language: "Go",
    framework: "Gin",
    ext: "go",
    testCmd: "go test ./...",
    mentions: ["gin.Default()", "github.com/gin-gonic/gin"],
    weight: 4,
    nouns: ["cache layer", "HTTP handler", "worker pool"],
  },
  {
    language: "Java",
    framework: "Spring",
    ext: "java",
    testCmd: "mvn test",
    mentions: ["@SpringBootApplication", "spring-boot"],
    weight: 4,
    nouns: ["REST controller", "JPA repository", "scheduler"],
  },
  {
    language: "Ruby",
    framework: "Rails",
    ext: "rb",
    testCmd: "bundle exec rspec",
    mentions: ["rails generate", "class ApplicationRecord < ActiveRecord::Base # rails"],
    weight: 3,
    nouns: ["mailer", "background job", "model validation"],
  },
  {
    language: "Rust",
    framework: "Tokio",
    ext: "rs",
    testCmd: "cargo test",
    mentions: ["use tokio::sync::Mutex", "#[tokio::main]"],
    weight: 2,
    nouns: ["job queue", "connection pool", "async worker"],
  },
  {
    language: "Rust",
    framework: "Axum",
    ext: "rs",
    testCmd: "cargo test",
    mentions: ["use axum::Router", "axum::extract"],
    weight: 1,
    nouns: ["router", "extractor", "middleware layer"],
  },
  {
    language: "Kotlin",
    framework: "Spring",
    ext: "kt",
    testCmd: "gradle test",
    mentions: ["@SpringBootApplication", "spring-boot kotlin"],
    weight: 1,
    nouns: ["coroutine scope", "REST client"],
  },
  {
    language: "Elixir",
    ext: "ex",
    testCmd: "mix test",
    mentions: ["defmodule", "GenServer"],
    weight: 1,
    nouns: ["GenServer", "supervisor tree"],
  },
  {
    language: "C++",
    ext: "cpp",
    testCmd: "make test",
    mentions: ["#include <vector>", "cmake"],
    weight: 1,
    nouns: ["memory pool", "parser", "SIMD kernel"],
  },
  {
    language: "Haskell",
    ext: "hs",
    testCmd: "stack test",
    mentions: ["import Data.Map", "cabal"],
    weight: 0.5,
    nouns: ["type class", "parser combinator"],
  },
  {
    language: "Solidity",
    ext: "sol",
    testCmd: "forge test",
    mentions: ["pragma solidity", "forge"],
    weight: 0.5,
    nouns: ["token contract", "reentrancy guard"],
  },
  {
    language: "COBOL",
    ext: "cbl",
    testCmd: "cobc -x main.cbl && ./main",
    mentions: ["IDENTIFICATION DIVISION", "PROCEDURE DIVISION"],
    weight: 0.3,
    nouns: ["batch payroll job", "record layout"],
  },
  {
    language: "Verilog",
    ext: "v",
    testCmd: "iverilog -o sim tb.v && vvp sim",
    mentions: ["module counter", "always @(posedge clk)"],
    weight: 0.3,
    nouns: ["FIFO", "UART receiver"],
  },
];

/** Reading and editing files with the standard coding tools. */
const FILE_TOOLS = {
  read: { tool: "Read", input: { file_path: "{file}" }, output: "{mention}\n// {noun}" },
  search: {
    tool: "Grep",
    input: { pattern: "{word}", path: "{dir}" },
    output: "{mention2}\n{file}",
  },
  act: {
    tool: "Edit",
    input: { file_path: "{file}", old_string: "old", new_string: "new" },
    output: "updated",
  },
  skims: { tool: "Read", input: { file_path: "{dir}/{skim}_{n}.{ext}" }, output: "// {skim} {n}" },
};

export const PACKS: DomainPack[] = [
  {
    domain: "software_engineering",
    weight: 58,
    harness: "claude-code",
    briefs: ["{title} in our {language} code."],
    titles: PATTERN_TITLES,
    ...FILE_TOOLS,
    check: {
      tool: "Bash",
      input: { command: "{testCmd}" },
      output: "Tests: {n} passed",
      fail: "3 failed",
      error: "FAIL: 2 failed, error in setup",
    },
    risky: {
      tool: "Bash",
      input: { command: "git push --force" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: CODING_CORRECTIONS,
    notes: ["Checking how the {noun} handles step {step}."],
    tampering: true,
    stacks: CODING_STACKS,
  },
  {
    domain: "data_querying",
    weight: 12,
    harness: "claude-code",
    briefs: [
      "{title}. Write the SQL query against the warehouse: join the orders table to customers, group by week, and check the row count against the dashboard.",
      "{title}. The dashboard metric for the {noun} looks off: find the duplicates in the dataset, fix the aggregation in the query, and compare the row count with the warehouse.",
    ],
    read: {
      tool: "Read",
      input: { file_path: "{file}" },
      output: "{mention}\nselect customer_id, count(*) as orders\nfrom {word}\ngroup by 1",
    },
    search: {
      tool: "RunQuery",
      input: {
        sql: "select column_name from information_schema.columns where table_name = '{word}'",
      },
      output: "{mention2}\ncolumn_name\ncustomer_id\norder_date\namount",
    },
    act: {
      tool: "Edit",
      input: { file_path: "{file}", old_string: "group by 1", new_string: "group by 1, 2" },
      output: "updated",
    },
    check: {
      tool: "RunQuery",
      input: { sql: "select count(*) as rows from {word}" },
      output: "rows\n{n}",
      fail: "rows\n0",
      error: 'ERROR: column "customer_id" does not exist in {word}',
    },
    risky: {
      tool: "RunQuery",
      input: { sql: "drop table {word}" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, that's the wrong table. The dashboard reads from the orders mart, not the raw events.",
      "That's wrong, the metric is per customer, not per order. Fix the group by.",
      "Wait, don't filter out the null values, the report counts them.",
    ],
    notes: [
      "Checking the join for the {noun} at step {step}: the row count should match the dashboard.",
      "Looking at the columns the query needs for the {noun} (step {step}).",
    ],
    skims: {
      tool: "RunQuery",
      input: { sql: "select * from {word} limit {n}" },
      output: "customer_id | order_date | amount\n{n} rows",
    },
    tampering: false,
    stacks: [
      {
        language: "SQL",
        framework: "dbt",
        ext: "sql",
        mentions: ["dbt run --select orders", "{{ ref('stg_orders') }} -- dbt model"],
        weight: 5,
        nouns: ["revenue model", "orders mart", "churn cohort", "daily active users metric"],
      },
      {
        language: "SQL",
        framework: "BigQuery",
        ext: "sql",
        mentions: ["bq query --use_legacy_sql=false", "-- BigQuery dataset analytics"],
        weight: 4,
        nouns: ["funnel report", "retention table", "event pipeline", "ads spend rollup"],
      },
      {
        language: "SQL",
        framework: "Snowflake",
        ext: "sql",
        mentions: ["-- Snowflake warehouse COMPUTE_WH", "snowflake task refresh"],
        weight: 2,
        nouns: ["inventory snapshot", "margin by region", "supplier scorecard"],
      },
      {
        language: "SQL",
        framework: "DuckDB",
        ext: "sql",
        mentions: ["duckdb analytics.db", "-- DuckDB over parquet files"],
        weight: 1,
        nouns: ["parquet export", "ad-hoc cohort pull", "support ticket volume"],
      },
    ],
  },
  {
    domain: "research",
    weight: 8,
    harness: "claude-code",
    briefs: [
      "{title}. Do a literature review on {noun}: search arXiv and the journals, read the abstract of each paper, summarise the findings and build the bibliography with a citation for every source.",
      "{title}. Find the prior work on {noun}: collect the papers, note the methodology and evidence of each study, and write up the related work with a DOI for each citation.",
    ],
    read: {
      tool: "WebSearch",
      input: { query: "{noun} survey site:arxiv.org" },
      output:
        "{mention}\n1. A survey of {noun} (arXiv:2403.{n}) — abstract: we review…\n2. Benchmarking {noun} — journal article",
    },
    search: {
      tool: "WebFetch",
      input: { url: "https://arxiv.org/abs/2403.{n}" },
      output:
        "{mention2}\nAbstract: This paper studies {noun}. We cite prior work and report findings on…",
    },
    act: {
      tool: "Write",
      input: { file_path: "review/{slug}.bib", content: "@article{{word}{n}, title={{noun}}}" },
      output: "written",
    },
    check: {
      tool: "WebFetch",
      input: { url: "https://doi.org/10.1000/{slug}.{n}" },
      output: "Resolved DOI: '{noun}' — journal article, {n} citations",
      fail: "DOI resolved to a retracted paper",
      error: "error: 404 Not Found for https://doi.org/10.1000/{slug}.{n}",
    },
    risky: {
      tool: "Bash",
      input: { command: "rm -rf review/" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, that's a preprint, not a peer reviewed paper. Only cite published studies.",
      "That's wrong, you're summarising the abstract, not the findings. Read the paper.",
      "Wait, that source is from 2015. I asked for the state of the art.",
    ],
    notes: [
      "Reading paper {step} on {noun}: noting the methodology and the evidence for the review.",
      "Adding the citation from source {step} to the bibliography.",
    ],
    skims: {
      tool: "WebFetch",
      input: { url: "https://arxiv.org/abs/2405.{n}" },
      output: "Abstract: a study of {noun}; findings and related work.",
    },
    tampering: false,
    stacks: [
      {
        ext: "bib",
        mentions: ["arXiv listing cs.LG", "Google Scholar citations"],
        weight: 1,
        nouns: [
          "sparse attention",
          "protein structure prediction",
          "carbon capture economics",
          "sleep and memory consolidation",
          "microplastics in drinking water",
          "retrieval augmented generation",
        ],
      },
    ],
  },
  {
    domain: "writing",
    weight: 1.5,
    harness: "claude-code",
    briefs: [
      "{title}. Draft the {noun}: proofread each paragraph, fix the grammar and any typo, keep the tone and voice from the style guide, and get the word count under 600.",
      "{title}. Rewrite the {noun} for a general audience: shorten the headline, tighten the wording, and keep the call to action.",
    ],
    read: {
      tool: "Read",
      input: { file_path: "{file}" },
      output: "{mention}\n# {noun}\n\nFirst paragraph of the draft…",
    },
    search: {
      tool: "Read",
      input: { file_path: "docs/style_guide.md" },
      output: "{mention2}\nTone: plain, warm. Avoid jargon. Headline under 60 characters.",
    },
    act: {
      tool: "Edit",
      input: {
        file_path: "{file}",
        old_string: "First paragraph",
        new_string: "Opening paragraph",
      },
      output: "updated",
    },
    check: {
      tool: "Bash",
      input: { command: "proselint {file}" },
      output: "{file}: 0 issues, {n} words",
      fail: "{file}:12:4: typography.symbols.curly_quotes; readability grade too high",
      error: "error: proselint could not parse {file}",
    },
    risky: {
      tool: "Bash",
      input: { command: "git push --force" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, that's not the tone we use. Read the style guide again and keep the voice.",
      "That's wrong, don't cut the call to action. Tighten the second paragraph instead.",
      "Wait, the headline was fine. Only fix the typo in the last sentence.",
    ],
    notes: [
      "Proofreading paragraph {step} of the {noun} for grammar and wording.",
      "Checking the word count and readability of the {noun} after step {step}.",
    ],
    skims: {
      tool: "Read",
      input: { file_path: "drafts/section_{n}.md" },
      output: "Paragraph {n}…",
    },
    tampering: false,
    stacks: [
      {
        ext: "md",
        mentions: ["drafts/ (markdown)", "style guide v3"],
        weight: 1,
        nouns: [
          "launch blog post",
          "press release",
          "investor newsletter",
          "onboarding email",
          "product announcement",
          "chapter three of the manuscript",
        ],
      },
    ],
  },
  {
    domain: "design",
    weight: 5,
    harness: "claude-code",
    briefs: [
      "{title}. Design the {noun}: update the mockup, fix the typography and spacing, take the color palette from the design tokens, and check contrast for accessibility.",
      "{title}. The {noun} wireframe is ready; build the layout in the design system, align the grid and padding, and export the icon set and the SVG.",
    ],
    read: {
      tool: "Read",
      input: { file_path: "{file}" },
      output: "{mention}\n:root { --color-primary: #1f4e79; --space-2: 8px; }\n/* {noun} */",
    },
    search: {
      tool: "Read",
      input: { file_path: "design/tokens.css" },
      output: "{mention2}\n--font-display: 'Inter'; --radius: 6px; --color-ink: #111;",
    },
    act: {
      tool: "Edit",
      input: { file_path: "{file}", old_string: "--space-2: 8px", new_string: "--space-2: 12px" },
      output: "updated",
    },
    check: {
      tool: "Bash",
      input: { command: "npx stylelint '{dir}/**/*.{ext}'" },
      output: "{n} files checked, 0 problems; contrast ratio 4.8:1 (AA)",
      fail: "{file} 14:3 ✖ color-no-invalid-hex; contrast ratio 2.1:1 fails AA",
      error: "error: stylelint could not load the config for {dir}",
    },
    risky: {
      tool: "Bash",
      input: { command: "rm -rf design/exports/" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, that's not the brand palette. Use the design tokens, not hard-coded colours.",
      "That's wrong, the typography scale is 1.25, you changed the spacing instead.",
      "Wait, keep the mockup's grid. Only fix the hover state on the button.",
    ],
    notes: [
      "Adjusting the spacing and alignment of the {noun} in step {step}.",
      "Checking the typography and contrast of the {noun} against the design system (step {step}).",
    ],
    skims: {
      tool: "Read",
      input: { file_path: "design/components/{skim}_{n}.css" },
      output: "/* component {n} tokens */",
    },
    tampering: false,
    stacks: [
      {
        ext: "css",
        mentions: ["Figma file: Marketing site v4", "design tokens (CSS variables)"],
        weight: 3,
        nouns: ["landing page hero", "pricing table", "settings modal", "mobile navigation"],
      },
      {
        ext: "svg",
        mentions: ["Figma export (SVG)", "icon grid 24px"],
        weight: 1,
        nouns: ["icon set", "empty state illustration", "logo lockup", "onboarding slide deck"],
      },
    ],
  },
  {
    domain: "medical",
    weight: 4,
    harness: "agent-sdk",
    briefs: [
      "{title}. Review the patient case: list the symptoms and vitals, give a differential diagnosis, check the treatment plan for a contraindication, and grade it against the evaluation rubric from the clinical guideline.",
      "{title}. Grade the model's answer on this {noun}: compare its diagnosis and medication dosage with the case notes and the clinical guideline, then score each rubric item.",
    ],
    read: {
      tool: "Read",
      input: { file_path: "{file}" },
      output:
        '{mention}\n{"case": "{noun}", "vitals": {"blood pressure": "142/91", "heart rate": 104}, "symptoms": ["chest pain", "dyspnoea"]}',
    },
    search: {
      tool: "Read",
      input: { file_path: "guidelines/{slug}.json" },
      output: '{mention2}\n{"guideline": "{noun}", "first_line": "…", "contraindication": ["…"]}',
    },
    act: {
      tool: "Write",
      input: {
        file_path: "grades/{slug}_{n}.json",
        content: '{"diagnosis": "…", "rubric": {"history": 2, "treatment": 1}}',
      },
      output: "written",
    },
    check: {
      tool: "grade_case",
      input: { case_id: "{slug}_{n}", rubric: "clinical_v2" },
      output:
        "rubric score {n}/40 — diagnosis correct, treatment plan consistent with the guideline",
      fail: "rubric score 9/40 — missed the contraindication, dosage outside the guideline",
      error: "error: rubric 'clinical_v2' not found for case {slug}_{n}",
    },
    risky: {
      tool: "Write",
      input: { file_path: "grades/answer_key.json", content: "{}" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, that's not the right rubric. Grade against the 2024 clinical guideline, not the old one.",
      "That's wrong, the patient is on anticoagulants, that's a contraindication you missed.",
      "Wait, don't give a treatment plan. The task is to grade the model's diagnosis.",
    ],
    notes: [
      "Checking the patient's lab results and vitals against the differential diagnosis (step {step}).",
      "Scoring rubric item {step} for the {noun}: treatment, dosage and prognosis.",
    ],
    skims: {
      tool: "Read",
      input: { file_path: "cases/case_{n}.json" },
      output: '{"case": {n}, "symptoms": ["…"], "lab results": {}}',
    },
    tampering: false,
    stacks: [
      {
        ext: "json",
        mentions: ["case notes (de-identified)", "ICD-10 coded diagnosis"],
        weight: 1,
        nouns: [
          "chest pain case",
          "sepsis triage",
          "paediatric fever workup",
          "oncology chart review",
          "insulin dosage check",
          "post-op discharge summary",
        ],
      },
    ],
  },
  {
    domain: "legal",
    weight: 1,
    harness: "agent-sdk",
    briefs: [
      "{title}. Review the {noun}: redline the liability and indemnification clause, check the jurisdiction and arbitration terms, and flag anything that fails the compliance policy review.",
      "{title}. Compare the contract against our template: mark each clause that shifts liability, check the non-compete and the NDA terms, and list the regulatory risks for counsel.",
    ],
    read: {
      tool: "Read",
      input: { file_path: "{file}" },
      output:
        "{mention}\nCLAUSE 7. INDEMNIFICATION. The Supplier shall indemnify…\nCLAUSE 12. GOVERNING LAW AND JURISDICTION.",
    },
    search: {
      tool: "Read",
      input: { file_path: "contracts/templates/msa_v3.txt" },
      output:
        "{mention2}\nStandard clause: limitation of liability capped at fees paid; arbitration seat London.",
    },
    act: {
      tool: "Edit",
      input: {
        file_path: "{file}",
        old_string: "unlimited liability",
        new_string: "liability capped at fees paid in the prior 12 months",
      },
      output: "updated",
    },
    check: {
      tool: "run_checklist",
      input: { policy: "contract_review_v4", file_path: "{file}" },
      output:
        "checklist: {n}/{n} items satisfied — governing law, limitation of liability, indemnification",
      fail: "checklist: 2 items unsatisfied — governing law, limitation of liability",
      error: "error: policy 'contract_review_v4' not found in the compliance library",
    },
    risky: {
      tool: "send_to_counterparty",
      input: { file_path: "{file}", message: "Redline attached" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, that's not what counsel asked for. Don't rewrite the clause, redline it.",
      "That's wrong, the jurisdiction clause stays. Only the indemnification cap changes.",
      "Wait, this is the old NDA template. Use the 2026 version.",
    ],
    notes: [
      "Checking clause {step} of the agreement for liability and indemnification terms.",
      "Comparing the {noun}'s arbitration and jurisdiction clause with the template (step {step}).",
    ],
    skims: {
      tool: "Read",
      input: { file_path: "contracts/{slug}/clause_{n}.txt" },
      output: "CLAUSE {n}. The parties agree…",
    },
    tampering: false,
    stacks: [
      {
        ext: "txt",
        mentions: ["Master Services Agreement v3", "redline tracked changes"],
        weight: 1,
        nouns: [
          "vendor master services agreement",
          "data processing addendum",
          "contractor NDA",
          "software license agreement",
          "office lease",
        ],
      },
    ],
  },
  {
    domain: "finance",
    weight: 1,
    harness: "agent-sdk",
    briefs: [
      "{title}. Close the books for the quarter: reconcile the ledger against the bank statement, post the missing journal entry, update the cash flow forecast and the budget, and check that the balance sheet balances.",
      "{title}. Build the {noun}: pull revenue and expenses from the ledger, compute EBITDA and margin by quarter, and reconcile the invoices in accounts receivable.",
    ],
    read: {
      tool: "Read",
      input: { file_path: "{file}" },
      output:
        "{mention}\nSheet 'Ledger': date | account | debit | credit\n2026-09-30 | 4000 Revenue | | 125,000.00",
    },
    search: {
      tool: "Read",
      input: { file_path: "books/bank_statement_2026-09.xlsx" },
      output: "{mention2}\n2026-09-28 | ACH | 12,400.00 | Invoice #{n}",
    },
    act: {
      tool: "update_cells",
      input: {
        file_path: "{file}",
        range: "Ledger!A{n}:D{n}",
        values: "2026-09-30, 2100 Accrued expenses, 1240.00, ",
      },
      output: "1 row updated",
    },
    check: {
      tool: "run_reconciliation",
      input: { period: "2026-Q3", file_path: "{file}" },
      output: "reconciled: 0 unmatched entries, variance $0.00; balance sheet balances",
      fail: "2 unmatched journal entries, variance $1,240.00; balance sheet off by $1,240.00",
      error: "error: bank feed for 2026-09 not available",
    },
    risky: {
      tool: "update_cells",
      input: { file_path: "{file}", range: "Ledger!A1:D999", values: "" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, that's not an expense, it's a prepayment. Post it to the balance sheet.",
      "That's wrong, the forecast uses fiscal quarters, not calendar quarters.",
      "Wait, don't change the revenue line. The variance is in accounts payable.",
    ],
    notes: [
      "Reconciling ledger entries for the {noun} against the bank statement (step {step}).",
      "Checking the invoice totals in accounts receivable for the {noun} at step {step}.",
    ],
    skims: {
      tool: "Read",
      input: { file_path: "books/invoices/inv_{n}.xlsx" },
      output: "Invoice #{n}: amount due, VAT, payment terms",
    },
    tampering: false,
    stacks: [
      {
        ext: "xlsx",
        mentions: ["QuickBooks export", "chart of accounts v2"],
        weight: 1,
        nouns: [
          "quarter close",
          "cash flow forecast",
          "accounts receivable ageing",
          "payroll reconciliation",
          "annual budget",
        ],
      },
    ],
  },
  {
    domain: "customer_support",
    weight: 6,
    harness: "agent-sdk",
    briefs: [
      "{title}. Handle the support ticket: look up the customer's order and shipment, decide whether a refund or a goodwill credit applies under the warranty, and reply to the customer in the tone of the canned response.",
      "{title}. The customer opened a complaint about the {noun}: check the ticket history and the order, escalate if the SLA is breached, otherwise send the reply and close the ticket.",
    ],
    read: {
      tool: "lookup_ticket",
      input: { ticket_id: "T-{n}" },
      output: "{mention}\nticket T-{n}: '{noun}' — customer waiting 3 days, priority high",
    },
    search: {
      tool: "lookup_order",
      input: { order_id: "ORD-{n}" },
      output: "{mention2}\norder ORD-{n}: shipped, tracking number 1Z{n}, delivered late",
    },
    act: {
      tool: "send_reply",
      input: { ticket_id: "T-{n}", body: "Hi, sorry about the {noun}. Here is what we'll do…" },
      output: "reply sent on ticket T-{n}",
    },
    check: {
      tool: "update_ticket",
      input: { ticket_id: "T-{n}", status: "resolved" },
      output: "ticket T-{n} updated: resolved, CSAT survey queued",
      fail: "ticket T-{n} reopened by the customer: issue not resolved",
      error: "error: ticket T-{n} is locked by another agent",
    },
    risky: {
      tool: "issue_refund",
      input: { order_id: "ORD-{n}", amount: 249.0 },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, don't promise a refund. Offer the goodwill credit first, per the macro.",
      "That's wrong, this customer is on the enterprise plan, escalate to the account team.",
      "Wait, you replied to the wrong ticket. The complaint is T-{n}.",
    ],
    notes: [
      "Checking the ticket history and the customer's previous orders for the {noun} (step {step}).",
      "Drafting the reply to the customer about the {noun}, step {step}.",
    ],
    skims: {
      tool: "lookup_ticket",
      input: { ticket_id: "T-{n}" },
      output: "ticket T-{n}: earlier inquiry from the same customer",
    },
    tampering: false,
    stacks: [
      {
        ext: "json",
        mentions: ["Zendesk ticket", "helpdesk macro: shipping delay"],
        weight: 1,
        nouns: [
          "late delivery complaint",
          "double charge refund",
          "locked account",
          "damaged item return",
          "subscription cancellation",
          "missing invoice",
        ],
      },
    ],
  },
  {
    domain: "devops",
    weight: 3,
    harness: "claude-code",
    briefs: [
      "{title}. Fix the deployment: check the pods and the ingress with kubectl, roll back the canary if latency or the alert in Grafana is still bad, and update the runbook.",
      "{title}. The {noun} is failing in the incident: look at the logs, fix the Terraform or Kubernetes config, deploy it and confirm the alert clears.",
    ],
    ...FILE_TOOLS,
    check: {
      tool: "Bash",
      input: { command: "{testCmd}" },
      output: "Plan: 2 to add, 0 to change, 0 to destroy; deployment healthy",
      fail: "Error: deployment rollout failed, 2 pods CrashLoopBackOff",
      error: "Error: timeout waiting for the API server; the deployment is still rolling out",
    },
    risky: {
      tool: "Bash",
      input: { command: "kubectl delete namespace production" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, don't deploy to production, this is the staging cluster.",
      "That's wrong, the outage is the load balancer, not the pods. Check the ingress.",
      "Wait, revert the Terraform change, it would recreate the VPC.",
    ],
    notes: [
      "Checking the logs and latency of the {noun} after the deploy (step {step}).",
      "Reading the runbook step {step} for the {noun} incident.",
    ],
    skims: {
      tool: "Read",
      input: { file_path: "{dir}/{skim}_{n}.{ext}" },
      output: "# {skim} {n}\n{mention2}",
    },
    tampering: false,
    stacks: [
      {
        language: "Terraform",
        ext: "tf",
        testCmd: "terraform plan",
        mentions: ['resource "aws_iam_role"', "terraform plan"],
        weight: 2,
        nouns: ["IAM policy", "VPC module", "S3 bucket policy", "autoscaling group"],
      },
      {
        framework: "Kubernetes",
        ext: "yaml",
        testCmd: "kubectl apply --dry-run=server -f k8s/",
        mentions: ["kubectl get pods -n production", "apiVersion: apps/v1 # kubernetes"],
        weight: 2,
        nouns: ["ingress", "canary deployment", "node pool", "cron job"],
      },
    ],
  },
  {
    domain: "science",
    weight: 0.5,
    harness: "claude-code",
    briefs: [
      "{title}. Run the simulation for the {noun}: set up the differential equation solver, check convergence against the tolerance, compare with the measurement from the experiment, and plot the spectrum.",
      "{title}. The {noun} simulation drifts: check the numerical solver's eigenvalue step, the mesh, and the calibration of the sensor data.",
    ],
    ...FILE_TOOLS,
    check: {
      tool: "Bash",
      input: { command: "{testCmd}" },
      output: "Tests: {n} passed; solver converged in {n} steps, residual 1e-9",
      fail: "2 failed: solver did not converge, residual 0.4",
      error: "error: singular matrix in the solver setup",
    },
    risky: {
      tool: "Bash",
      input: { command: "rm -rf data/raw/" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, that's the wrong tolerance. The experiment needs 1e-9, not 1e-3.",
      "That's wrong, the measurement is in kelvin. Don't convert the temperature.",
      "Wait, keep the finite element mesh. Only change the solver.",
    ],
    notes: [
      "Checking convergence of the {noun} simulation at step {step}.",
      "Comparing the simulation with the experiment's measurement (step {step}).",
    ],
    skims: {
      tool: "Read",
      input: { file_path: "{dir}/{skim}_{n}.{ext}" },
      output: "# {skim} {n}: numerical helper",
    },
    tampering: false,
    stacks: [
      {
        language: "Python",
        framework: "NumPy",
        ext: "py",
        testCmd: "pytest tests/test_solver.py",
        mentions: ["import numpy as np", "scipy.integrate.solve_ivp"],
        weight: 3,
        nouns: ["heat diffusion model", "orbital dynamics run", "reaction kinetics fit"],
      },
      {
        language: "Julia",
        ext: "jl",
        testCmd: "julia test/runtests.jl",
        mentions: ["using DifferentialEquations", "julia> solve(prob, Tsit5())"],
        weight: 1,
        nouns: ["climate column model", "plasma simulation"],
      },
      {
        language: "Fortran",
        ext: "f90",
        testCmd: "make test",
        mentions: ["program solver", "call dgesv(n, 1, a, n, ipiv, b, n, info)"],
        weight: 0.5,
        nouns: ["finite element solver", "spectral code"],
      },
    ],
  },
  {
    domain: "education",
    weight: 0.5,
    harness: "agent-sdk",
    briefs: [
      "{title}. Tutor the student through the {noun}: write the lesson plan with a learning objective, build a worksheet and a quiz, grade the homework with the rubric, and explain each misconception step by step.",
      "{title}. Grade the students' {noun} homework against the rubric and the answer key, then write feedback that explains each misconception.",
    ],
    read: {
      tool: "get_submission",
      input: { student: "student_{n}", assignment: "{slug}" },
      output: "{mention}\nsubmission from student_{n}: 8 of 10 problems attempted",
    },
    search: {
      tool: "Read",
      input: { file_path: "course/{slug}/answer_key.json" },
      output: '{mention2}\n{"q1": "42", "q2": "x = 3", "rubric": {"method": 2, "answer": 1}}',
    },
    act: {
      tool: "Write",
      input: {
        file_path: "feedback/student_{n}.md",
        content: "Good work on q1. For q2, the misconception is…",
      },
      output: "written",
    },
    check: {
      tool: "check_answer",
      input: { problem_id: "{slug}_q{n}", answer: "42" },
      output: "correct — matches the answer key; rubric: method 2/2, answer 1/1",
      fail: "incorrect: expected 42, got 41; rubric: method 1/2",
      error: "error: problem '{slug}_q{n}' is not in the quiz",
    },
    risky: {
      tool: "Write",
      input: { file_path: "course/{slug}/answer_key.json", content: "{}" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, don't give the student the answer. Explain the concept step by step.",
      "That's wrong, the rubric gives two points for the method, not one.",
      "Wait, this worksheet is for the advanced class. Use the lesson plan for year 9.",
    ],
    notes: [
      "Grading problem {step} of the {noun} homework against the rubric.",
      "Writing the explanation for misconception {step} in the {noun} lesson.",
    ],
    skims: {
      tool: "get_submission",
      input: { student: "student_{n}", assignment: "{slug}" },
      output: "submission from student_{n}: quiz answers and homework",
    },
    tampering: false,
    stacks: [
      {
        ext: "json",
        mentions: ["course: Algebra 1", "rubric v2 (method + answer)"],
        weight: 1,
        nouns: [
          "quadratic equations",
          "photosynthesis",
          "French past tense",
          "fractions",
          "introductory statistics",
        ],
      },
    ],
  },
  {
    domain: "web_tasks",
    weight: 0.3,
    harness: "claude-in-chrome",
    briefs: [
      "{title}. In the browser, navigate to the website, fill in the form, add the item to cart, get past the cookie banner and the captcha, and submit the checkout; take a screenshot of the confirmation.",
      "{title}. Book the {noun} on the website: navigate to the booking page, click through the form, and screenshot the reservation page.",
    ],
    read: {
      tool: "navigate",
      input: { url: "https://example.com/{slug}" },
      output: "{mention}\nPage loaded: '{noun}' — cookie banner shown",
    },
    search: {
      tool: "screenshot",
      input: { tab: 1 },
      output: "{mention2}\nscreenshot: form with fields name, email, date; button 'Continue'",
    },
    act: {
      tool: "click",
      input: { selector: "button[type=submit]" },
      output: "clicked; page navigated to /{slug}/review",
    },
    check: {
      tool: "screenshot",
      input: { tab: 1 },
      output: "screenshot: confirmation page for the {noun}, reference {n}",
      fail: "screenshot: form still open, validation error on the email field",
      error: "error: page did not load (timeout after 30s)",
    },
    risky: {
      tool: "click",
      input: { selector: "#confirm-purchase" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, don't submit the form yet. I need to check the dates first.",
      "That's wrong, you clicked the ad. Scroll down to the booking form.",
      "Wait, use the other tab, that website is the wrong hotel.",
    ],
    notes: [
      "Filling in the form fields for the {noun} on the web page (step {step}).",
      "Scrolling past the cookie banner to the {noun} button (step {step}).",
    ],
    skims: {
      tool: "type",
      input: { selector: "input[name=field_{n}]", text: "…" },
      output: "typed into field_{n}",
    },
    tampering: false,
    stacks: [
      {
        ext: "html",
        mentions: ["Chrome tab 1", "DOM selector form#booking"],
        weight: 1,
        nouns: ["hotel reservation", "flight booking", "conference ticket", "grocery order"],
      },
    ],
  },
  {
    domain: "productivity",
    weight: 0.2,
    harness: "agent-sdk",
    briefs: [
      "{title}. Clear the inbox: reschedule the meeting and attach the agenda, send the calendar invite in the right time zone, add a reminder for the follow-up, and update the to-do list.",
      "{title}. Plan the {noun}: check availability in the calendar, send the invite, and put the itinerary and the notes in the follow-up email.",
    ],
    read: {
      tool: "search_email",
      input: { query: "{noun}" },
      output: "{mention}\n3 emails about the {noun}; latest asks to reschedule",
    },
    search: {
      tool: "list_events",
      input: { range: "next 7 days" },
      output: "{mention2}\n{n} events; Thursday 10:00 free (time zone Europe/London)",
    },
    act: {
      tool: "create_event",
      input: { title: "{noun}", start: "Thursday 10:00", attendees: "team" },
      output: "event created, invite sent",
    },
    check: {
      tool: "list_events",
      input: { range: "Thursday" },
      output: "{n} events, no conflicts; reminder set",
      fail: "conflict: the {noun} overlaps the all-hands",
      error: "error: calendar not reachable",
    },
    risky: {
      tool: "send_email",
      input: { to: "all-staff@example.com", subject: "{noun}", body: "…" },
      output: "The user doesn't want to proceed with this tool use.",
    },
    corrections: [
      "No, don't email the whole team. Only invite the people on the thread.",
      "That's wrong, the meeting is in Pacific time, not London.",
      "Wait, keep the old agenda. Just move the time.",
    ],
    notes: [
      "Checking the calendar for availability and the inbox thread on the {noun} (step {step}).",
      "Updating the to-do list and the reminder for the {noun} follow-up (step {step}).",
    ],
    skims: {
      tool: "search_email",
      input: { query: "{noun} follow-up {n}" },
      output: "1 email: reminder about the {noun}",
    },
    tampering: false,
    stacks: [
      {
        ext: "ics",
        mentions: ["Google Calendar", "inbox (Gmail)"],
        weight: 1,
        nouns: ["offsite planning", "quarterly review meeting", "customer visit", "team dinner"],
      },
    ],
  },
];

export const PACK_BY_DOMAIN: Record<string, DomainPack> = Object.fromEntries(
  PACKS.map((p) => [p.domain, p]),
);

/** Every stack, each with its pack, for lookups by language or framework. */
export const STACKS: Stack[] = PACKS.flatMap((p) => p.stacks);

export function packOf(stack: Stack): DomainPack {
  return PACKS.find((p) => p.stacks.includes(stack)) ?? PACKS[0]!;
}
