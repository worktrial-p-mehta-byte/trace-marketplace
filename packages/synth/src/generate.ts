import { TRACE_SCHEMA_VERSION, type Trace, type TraceEvent } from "@tm/schema";
import { MODELS, PATTERN_TITLES, PATTERNS, STACKS, type Pattern, type Stack } from "./stacks";

/** Small, fast, seedable PRNG (mulberry32), so generated catalogs are repeatable. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    weighted: <T extends { weight: number }>(xs: readonly T[]) => {
      const total = xs.reduce((s, x) => s + x.weight, 0);
      let r = next() * total;
      for (const x of xs) if ((r -= x.weight) <= 0) return x;
      return xs.at(-1)!;
    },
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof createRng>;

export interface SynthSpec {
  stack: Stack;
  pattern: Pattern;
  recovered: boolean;
  model: string;
  /** Days before `now` that the session ended. */
  ageDays: number;
  /** Approximate conversational length. */
  turns: number;
}

export function randomSpec(rng: Rng): SynthSpec {
  const pattern = rng.weighted(PATTERNS).pattern;
  // Skewed towards recent sessions, with a long tail back four months.
  const ageDays = Math.floor(120 * rng.next() ** 2);
  return {
    stack: rng.weighted(STACKS),
    pattern,
    recovered: pattern !== "clean" && rng.chance(0.5),
    model: rng.weighted(MODELS).id,
    ageDays,
    turns: Math.round(8 + 110 * rng.next() ** 2.5),
  };
}

/**
 * Generate one synthetic session that produces the intended labels when run
 * through the real enrich pipeline (a test checks this). Content is plainly
 * invented; provenance.source is always "synthetic".
 */
export function generateTrace(rng: Rng, spec: SynthSpec, opts: { now: Date; index: number }): Trace {
  const { stack, pattern } = spec;
  const noun = rng.pick(stack.nouns);
  const title = rng
    .pick(PATTERN_TITLES[pattern])
    .replace("{noun}", noun)
    .replace(/^./, (c) => c.toUpperCase());
  const end = new Date(opts.now.getTime() - spec.ageDays * 86_400_000 - rng.int(0, 600) * 60_000);
  const events: TraceEvent[] = [];
  let minute = 0;
  const ts = () => new Date(end.getTime() - 3_600_000 + minute++ * 45_000).toISOString();
  const push = (e: Record<string, unknown>) =>
    events.push({ ...e, seq: events.length, ts: ts() } as TraceEvent);
  let callN = 0;
  const call = (tool: string, input: Record<string, unknown>, output: string, isError = false, rejected = false) => {
    const callId = `toolu_${opts.index}_${callN++}`;
    push({ type: "tool_call", callId, tool, input });
    push({ type: "tool_result", callId, output, isError: isError || rejected, ...(rejected ? { rejected: true } : {}) });
  };
  const file = `src/${noun.replace(/[^a-z]+/gi, "_").toLowerCase()}.${stack.ext}`;
  const testFile = `tests/${noun.replace(/[^a-z]+/gi, "_").toLowerCase()}_test.${stack.ext}`;
  const ok = stack.testCmd.includes("terraform") ? "Plan: 2 to add, 0 to change" : `Tests: ${rng.int(8, 60)} passed`;

  push({ type: "user_message", text: `Synthetic session #${opts.index}: ${title.toLowerCase()} in our ${stack.language} code.` });
  push({ type: "assistant_message", text: `I'll start by reading the ${noun}.` });
  call("Read", { file_path: file }, `${stack.mentions[0]}\n// ${noun} implementation`);
  call("Grep", { pattern: noun.split(" ")[0], path: "src" }, `${stack.mentions[1] ?? stack.mentions[0]}\n${file}`);

  switch (pattern) {
    case "tool_error":
      call("Bash", { command: stack.testCmd }, "FAIL: 2 failed, error in setup", true);
      break;
    case "retry_loop":
      for (let i = 0; i < rng.int(3, 6); i++) call("Bash", { command: stack.testCmd }, "error: test failed again", true);
      break;
    case "user_correction":
      call("Edit", { file_path: file, old_string: "old", new_string: "new" }, "updated");
      push({ type: "user_message", text: rng.pick(["No, that's not what I asked for. Keep the existing behaviour.", "That's wrong, don't change the public API.", "Wait, revert that and only touch the parser."]) });
      break;
    case "tool_rejected":
      call("Bash", { command: "git push --force" }, "The user doesn't want to proceed with this tool use.", true, true);
      break;
    case "user_interrupt":
      call("Edit", { file_path: file, old_string: "a", new_string: "b" }, "updated");
      push({ type: "user_message", text: "[Request interrupted by user]", interrupted: true });
      break;
    case "test_tampering":
      call("Bash", { command: stack.testCmd }, "1 failed", true);
      push({ type: "assistant_message", text: "This test looks flaky; I'll remove the failing assertion." });
      call("Edit", { file_path: testFile, old_string: "expect(result).toBe(expected)\nassert ok", new_string: "" }, "updated");
      push({ type: "user_message", text: "No, don't delete the test. Fix the code instead." });
      break;
    case "clean":
      break;
  }

  // Filler work so session length varies; keeps the stack detectable.
  while (events.filter((e) => e.type !== "tool_result").length < spec.turns) {
    if (rng.chance(0.5)) push({ type: "assistant_message", text: `Checking how the ${noun} handles step ${events.length}.` });
    else call("Read", { file_path: `src/util_${rng.int(1, 9)}.${stack.ext}` }, `// helper ${events.length}`);
  }

  const success = pattern === "clean" || spec.recovered;
  call("Edit", { file_path: file, old_string: "x", new_string: "y" }, "updated");
  call("Bash", { command: stack.testCmd }, success ? ok : "3 failed", !success);
  push({ type: "assistant_message", text: success ? `Done: the ${noun} change is in and the checks pass.` : `I couldn't get the ${noun} working.` });

  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    id: `syn_${opts.index}`,
    title,
    startedAt: events[0]!.ts!,
    endedAt: events.at(-1)!.ts!,
    provenance: {
      source: "synthetic",
      harness: { name: "claude-code", version: "synthetic" },
      model: { id: spec.model, provider: "anthropic" },
      repo: { languages: [stack.language], frameworks: stack.framework ? [stack.framework] : [] },
      capturedAt: events.at(-1)!.ts!,
    },
    events,
  };
}

/** A whole catalog of synthetic sessions, deterministic for a given seed. */
export function generateCatalog(seed: number, count: number, now: Date): Trace[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, i) => generateTrace(rng, randomSpec(rng), { now, index: i }));
}

/** Sessions for one stack and failure pattern (the simulator's "flood" action). */
export function generateFlood(
  seed: number,
  count: number,
  now: Date,
  want: { language: string; framework?: string; pattern: Pattern },
): Trace[] {
  const rng = createRng(seed);
  const stack =
    STACKS.find((s) => s.language === want.language && (!want.framework || s.framework === want.framework)) ??
    STACKS.find((s) => s.language === want.language);
  if (!stack) throw new Error(`Unknown language for flood: ${want.language}`);
  return Array.from({ length: count }, (_, i) =>
    generateTrace(rng, { ...randomSpec(rng), stack, pattern: want.pattern, ageDays: rng.int(0, 7) }, {
      now,
      index: seed * 1000 + i,
    }),
  );
}
