import { TRACE_SCHEMA_VERSION, type Trace, type TraceEvent } from "@tm/schema";
import {
  GENERIC_TITLES,
  MODELS,
  PACK_BY_DOMAIN,
  PACKS,
  PATTERNS,
  STACKS,
  packOf,
  type CallShape,
  type DomainPack,
  type Pattern,
  type Stack,
  type SynthDomain,
} from "./stacks";

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

/** The domain a spec's stack belongs to. */
export function domainOf(spec: Pick<SynthSpec, "stack">): SynthDomain {
  return packOf(spec.stack).domain;
}

/** A random pattern the pack allows (only coding packs can tamper with tests). */
function randomPattern(rng: Rng, pack: DomainPack): Pattern {
  const allowed = pack.tampering
    ? PATTERNS
    : PATTERNS.filter((p) => p.pattern !== "test_tampering");
  return rng.weighted(allowed).pattern;
}

export function randomSpec(rng: Rng): SynthSpec {
  const pack = rng.weighted(PACKS);
  const stack = rng.weighted(pack.stacks);
  const pattern = randomPattern(rng, pack);
  // Skewed towards recent sessions, with a long tail back four months.
  const ageDays = Math.floor(120 * rng.next() ** 2);
  return {
    stack,
    pattern,
    recovered: pattern !== "clean" && rng.chance(0.5),
    model: rng.weighted(MODELS).id,
    ageDays,
    turns: Math.round(8 + 110 * rng.next() ** 2.5),
  };
}

type Vars = Record<string, string | number>;

/** Replace `{name}` placeholders from `vars`; unknown ones (JSON, dbt refs) stay. */
export function fill(template: string, vars: Vars): string {
  return template.replace(/\{([a-z0-9]+)\}/gi, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

function fillInput(input: CallShape["input"], vars: Vars): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, typeof v === "string" ? fill(v, vars) : v]),
  );
}

/**
 * Generate one synthetic session that produces the intended labels when run
 * through the real enrich pipeline (a test checks this). Content is plainly
 * invented; provenance.source is always "synthetic".
 */
export function generateTrace(
  rng: Rng,
  spec: SynthSpec,
  opts: { now: Date; index: number },
): Trace {
  const { stack, pattern } = spec;
  const pack = packOf(stack);
  if (pattern === "test_tampering" && !pack.tampering) {
    throw new Error(`The ${pack.domain} pack has no tests to tamper with`);
  }
  const noun = rng.pick(stack.nouns);
  const titles = pack.titles?.[pattern] ?? GENERIC_TITLES[pattern];
  const title = rng
    .pick(titles)
    .replace("{noun}", noun)
    .replace(/^./, (c) => c.toUpperCase());
  const slug = noun.replace(/[^a-z]+/gi, "_").toLowerCase();
  const dir = pack.domain === "software_engineering" ? "src" : pack.domain.replace(/_/g, "-");
  const base: Vars = {
    noun,
    slug,
    word: slug.split("_")[0]!,
    dir,
    ext: stack.ext,
    file: `${dir}/${slug}.${stack.ext}`,
    mention: stack.mentions[0]!,
    mention2: stack.mentions[1] ?? stack.mentions[0]!,
    testCmd: stack.testCmd ?? "",
    language: stack.language ?? "",
    title,
    index: opts.index,
    skim: "util",
  };
  // Each call gets its own random number, used wherever `{n}` appears in it.
  const vars = (extra: Vars = {}): Vars => ({ ...base, n: rng.int(8, 60), step: 0, ...extra });

  const end = new Date(opts.now.getTime() - spec.ageDays * 86_400_000 - rng.int(0, 600) * 60_000);
  const events: TraceEvent[] = [];
  // Timestamps are filled in at the end, counting back from `end`, so a long
  // session never runs past `end` (or `now`).
  const push = (e: Record<string, unknown>) =>
    events.push({ ...e, seq: events.length } as TraceEvent);
  let callN = 0;
  const call = (
    tool: string,
    input: Record<string, unknown>,
    output: string,
    isError = false,
    rejected = false,
  ) => {
    const callId = `toolu_${opts.index}_${callN++}`;
    push({ type: "tool_call", callId, tool, input });
    push({
      type: "tool_result",
      callId,
      output,
      isError: isError || rejected,
      ...(rejected ? { rejected: true } : {}),
    });
  };
  /** A call from a pack shape, with an output override for failures. */
  const shaped = (
    shape: CallShape,
    o: { output?: string; isError?: boolean; rejected?: boolean; vars?: Vars } = {},
  ) => {
    const v = vars(o.vars);
    call(
      shape.tool,
      fillInput(shape.input, v),
      fill(o.output ?? shape.output, v),
      o.isError ?? false,
      o.rejected ?? false,
    );
  };
  const nonResults = () => events.filter((e) => e.type !== "tool_result").length;

  push({
    type: "user_message",
    text: `Synthetic session #${opts.index}: ${fill(rng.pick(pack.briefs), vars({ title: title.toLowerCase() }))}`,
  });
  push({ type: "assistant_message", text: `I'll start by looking at the ${noun}.` });
  shaped(pack.read);
  shaped(pack.search);

  switch (pattern) {
    case "tool_error":
      shaped(pack.check, { output: pack.check.error, isError: true });
      break;
    case "retry_loop": {
      const n = rng.int(3, 6);
      for (let i = 0; i < n; i++) shaped(pack.check, { output: pack.check.error, isError: true });
      break;
    }
    case "user_correction":
      shaped(pack.act);
      push({ type: "user_message", text: fill(rng.pick(pack.corrections), vars()) });
      break;
    case "tool_rejected":
      shaped(pack.risky, { isError: true, rejected: true });
      break;
    case "user_interrupt":
      shaped(pack.act);
      push({ type: "user_message", text: "[Request interrupted by user]", interrupted: true });
      break;
    case "test_tampering": {
      // Coding only: a failing test is deleted instead of the code being fixed.
      shaped(pack.check, { output: "1 failed", isError: true });
      push({
        type: "assistant_message",
        text: "This test looks flaky; I'll remove the failing assertion.",
      });
      call(
        "Edit",
        {
          file_path: `tests/${slug}_test.${stack.ext}`,
          old_string: "expect(result).toBe(expected)\nassert ok",
          new_string: "",
        },
        "updated",
      );
      push({ type: "user_message", text: "No, don't delete the test. Fix the code instead." });
      break;
    }
    case "clean":
      break;
  }

  // Filler work so session length varies; keeps the stack and domain detectable.
  while (nonResults() < spec.turns) {
    if (rng.chance(0.5))
      push({
        type: "assistant_message",
        text: fill(rng.pick(pack.notes), vars({ step: events.length })),
      });
    else shaped(pack.skims, { vars: { n: rng.int(1, 9) } });
  }

  const success = pattern === "clean" || spec.recovered;
  shaped(pack.act);
  shaped(pack.check, success ? {} : { output: pack.check.fail, isError: true });
  push({
    type: "assistant_message",
    text: success
      ? `Done: the ${noun} is finished and the check passes.`
      : `I couldn't get the ${noun} to pass the check.`,
  });

  // Uneven gaps, like a recorded session: tool results come back in seconds,
  // people and the model take longer. A separate generator per session, so
  // timing never shifts the content of the sessions generated after it.
  const clock = createRng(opts.index * 7919 + 17);
  const gaps = events.map((e) =>
    e.type === "tool_result" ? clock.int(1, 20) * 1000 : clock.int(8, 95) * 1000,
  );
  let t = end.getTime();
  for (let i = events.length - 1; i >= 0; i--) {
    events[i]!.ts = new Date(t).toISOString();
    t -= gaps[i]!;
  }

  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    id: `syn_${opts.index}`,
    title,
    startedAt: events[0]!.ts!,
    endedAt: events.at(-1)!.ts!,
    provenance: {
      source: "synthetic",
      harness: { name: pack.harness, version: "synthetic" },
      model: { id: spec.model, provider: "anthropic" },
      repo: {
        languages: stack.language ? [stack.language] : [],
        frameworks: stack.framework ? [stack.framework] : [],
      },
      capturedAt: events.at(-1)!.ts!,
    },
    events,
  };
}

/** A whole catalog of synthetic sessions with the specs they came from. */
export function generateCatalogWithSpecs(
  seed: number,
  count: number,
  now: Date,
): { trace: Trace; spec: SynthSpec }[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, i) => {
    const spec = randomSpec(rng);
    return { spec, trace: generateTrace(rng, spec, { now, index: i }) };
  });
}

/** A whole catalog of synthetic sessions, deterministic for a given seed. */
export function generateCatalog(seed: number, count: number, now: Date): Trace[] {
  return generateCatalogWithSpecs(seed, count, now).map((x) => x.trace);
}

export interface FloodWant {
  /** Restrict to one domain; with no language, every stack of the domain is used. */
  domain?: string;
  language?: string;
  framework?: string;
  pattern: Pattern;
}

/**
 * The stacks a flood draws from, narrowest match first. Only stacks whose
 * pack can produce the pattern are kept (test tampering needs code and
 * tests), so a flood never adds sessions of a different kind than asked.
 */
export function floodStacks(want: Omit<FloodWant, "pattern"> & { pattern?: Pattern }): Stack[] {
  let pool = STACKS;
  if (want.domain) {
    const pack = PACK_BY_DOMAIN[want.domain];
    if (!pack) throw new Error(`Unknown domain for flood: ${want.domain}`);
    pool = pack.stacks;
  }
  if (want.language) {
    const exact = pool.filter(
      (s) => s.language === want.language && (!want.framework || s.framework === want.framework),
    );
    pool = exact.length ? exact : pool.filter((s) => s.language === want.language);
  } else if (want.framework) {
    pool = pool.filter((s) => s.framework === want.framework);
  }
  if (!pool.length) {
    throw new Error(
      `No stack for flood: ${[want.domain, want.language, want.framework].filter(Boolean).join(" ")}`,
    );
  }
  if (want.pattern === "test_tampering") {
    pool = pool.filter((s) => packOf(s).tampering);
    if (!pool.length) throw new Error("Test tampering only happens in coding sessions.");
  }
  return pool;
}

/** Sessions for one domain or stack and failure pattern (the simulator's "flood" action). */
export function generateFlood(seed: number, count: number, now: Date, want: FloodWant): Trace[] {
  const rng = createRng(seed);
  const pool = floodStacks(want);
  return Array.from({ length: count }, (_, i) => {
    const stack = rng.weighted(pool);
    return generateTrace(
      rng,
      { ...randomSpec(rng), stack, pattern: want.pattern, ageDays: rng.int(0, 7) },
      { now, index: seed * 1000 + i },
    );
  });
}
