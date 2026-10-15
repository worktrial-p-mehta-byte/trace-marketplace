import type { Trace } from "@tm/schema";

const EXTENSIONS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  ipynb: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  fs: "F#",
  swift: "Swift",
  m: "Objective-C",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  ml: "OCaml",
  clj: "Clojure",
  dart: "Dart",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  zig: "Zig",
  nim: "Nim",
  sol: "Solidity",
  v: "Verilog",
  sv: "SystemVerilog",
  vhd: "VHDL",
  vhdl: "VHDL",
  cob: "COBOL",
  cbl: "COBOL",
  f90: "Fortran",
  f: "Fortran",
  tf: "Terraform",
  hcl: "Terraform",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
};

/** Build-tool commands that reveal the language even without file paths. */
const COMMAND_HINTS: [RegExp, string][] = [
  [/\bcargo\s+(?:test|build|run|check|clippy)\b/, "Rust"],
  [/\bgo\s+(?:test|build|run|mod)\b/, "Go"],
  [/\b(?:pytest|python3?|pip3?|poetry|uv)\b/, "Python"],
  [/\b(?:tsc|ts-node|tsx|vitest)\b/, "TypeScript"],
  [/\b(?:mvn|gradle)\b/, "Java"],
  [/\b(?:bundle|rake|rspec)\b/, "Ruby"],
  [/\bterraform\s+\w+/, "Terraform"],
  [/\bdotnet\s+\w+/, "C#"],
  [/\bmix\s+\w+/, "Elixir"],
];

/** Framework and library names worth faceting on, matched as whole words. */
const FRAMEWORKS: [RegExp, string][] = [
  [/\bnext(?:\.js|js)?\b(?=[\s/'"@.]|$)|\bnext\s+(?:dev|build|start)\b/i, "Next.js"],
  [/\breact(?:-dom)?\b/i, "React"],
  [/\bvue\b/i, "Vue"],
  [/\bsvelte(?:kit)?\b/i, "Svelte"],
  [/\b@?angular\b/i, "Angular"],
  [/\bexpress\b/i, "Express"],
  [/\bnestjs\b|@nestjs\//i, "NestJS"],
  [/\bdjango\b/i, "Django"],
  [/\bflask\b/i, "Flask"],
  [/\bfastapi\b/i, "FastAPI"],
  [/\brails\b/i, "Rails"],
  [/\bspring(?:boot|-boot)?\b/i, "Spring"],
  [/\btokio\b/i, "Tokio"],
  [/\bactix\b/i, "Actix"],
  [/\baxum\b/i, "Axum"],
  [/\bgin-gonic\b|\bgin\.Default\b/i, "Gin"],
  [/\blaravel\b/i, "Laravel"],
  [/\b(?:pytorch|torch)\b/i, "PyTorch"],
  [/\btensorflow\b/i, "TensorFlow"],
  [/\bjax\b/i, "JAX"],
  [/\bpandas\b/i, "pandas"],
  [/\bkubernetes\b|\bkubectl\b/i, "Kubernetes"],
  [/\bprisma\b/i, "Prisma"],
  [/\bdrizzle\b/i, "Drizzle"],
];

const PATH_KEYS = ["file_path", "path", "notebook_path", "filePath"];

function* toolInputs(trace: Trace): Generator<{ tool: string; input: Record<string, unknown> }> {
  for (const e of trace.events) {
    if (e.type === "tool_call" && e.input && typeof e.input === "object") {
      yield { tool: e.tool, input: e.input as Record<string, unknown> };
    }
  }
}

function topKey(counts: Map<string, number>, min = 1): string | undefined {
  let best: string | undefined;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return n >= min ? best : undefined;
}

export function filePathsOf(trace: Trace): string[] {
  const paths: string[] = [];
  for (const { input } of toolInputs(trace)) {
    for (const k of PATH_KEYS) {
      const v = input[k];
      if (typeof v === "string") paths.push(v);
    }
  }
  return paths;
}

export function commandsOf(trace: Trace): string[] {
  const cmds: string[] = [];
  for (const { input } of toolInputs(trace)) {
    if (typeof input.command === "string") cmds.push(input.command);
  }
  return cmds;
}

/** Most-used language, from file extensions in tool calls, then build commands. */
export function detectLanguage(trace: Trace): string | undefined {
  // Files the agent touched are the strongest signal; build commands only
  // break ties or fill in when no files were touched. Repeats don't count
  // twice, so re-running `gradle test` five times can't outvote .kt edits.
  const fromFiles = new Map<string, number>();
  for (const p of new Set(filePathsOf(trace))) {
    const ext = p.split(".").pop()?.toLowerCase();
    const lang = ext && ext !== p.toLowerCase() ? EXTENSIONS[ext] : undefined;
    if (lang) fromFiles.set(lang, (fromFiles.get(lang) ?? 0) + 1);
  }
  const fromCommands = new Map<string, number>();
  for (const c of new Set(commandsOf(trace))) {
    for (const [re, lang] of COMMAND_HINTS) {
      if (re.test(c)) fromCommands.set(lang, (fromCommands.get(lang) ?? 0) + 1);
    }
  }
  if (!fromFiles.size) return topKey(fromCommands);
  for (const [lang, n] of fromCommands) {
    if (fromFiles.has(lang)) fromFiles.set(lang, fromFiles.get(lang)! + n * 0.1); // tie-break only
  }
  return topKey(fromFiles);
}

/** Most-mentioned framework across tool inputs and outputs (needs 2+ mentions). */
export function detectFramework(trace: Trace): string | undefined {
  const counts = new Map<string, number>();
  const texts: string[] = [];
  for (const e of trace.events) {
    if (e.type === "tool_call") texts.push(JSON.stringify(e.input));
    else if (e.type === "tool_result") texts.push(e.output.slice(0, 5000));
  }
  for (const t of texts) {
    for (const [re, name] of FRAMEWORKS) {
      if (re.test(t)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  // React is implied by Next.js; prefer the more specific name.
  if (counts.has("Next.js")) counts.delete("React");
  return topKey(counts, 2);
}
