import type { Trace, TraceEvent } from "@tm/schema";
import { domainEvidenceByEvent, domainName } from "./domains";
import { correctionPhrase, isTestCommand, isTestTampering, testRunResult } from "./labels";
import type { TraceTraits } from "./traits";

/**
 * Explains, line by line, how a session was read: which events became which
 * labels, traits and price inputs, and why. Pure and browser-safe, so the
 * share screen can show it before anything is uploaded and the listing page
 * after. It restates what the labeler and detectors decided (their labels'
 * evidence is the source of truth); it never decides anything new.
 */

/** What kind of finding a note is, for colour and grouping. */
export type NoteKind = "failure" | "outcome" | "domain" | "quality" | "authenticity" | "signal";

export interface EventNote {
  kind: NoteKind;
  /** A few words: "Retry loop: 3rd failure of Bash in a row". */
  title: string;
  /** Why, in a sentence or two, and what it feeds. */
  detail: string;
  /**
   * What the note feeds, as derivation keys: "label:failure:retry_loop",
   * "trait:toolErrors", "factor:failure". The page links these both ways.
   */
  feeds: string[];
  /** Other events it refers to (the call a result answers, the action after a correction). */
  related?: number[];
}

export interface EventExplanation {
  seq: number;
  /** What the line is, in plain words, and what it counts toward. */
  description: string;
  notes: EventNote[];
}

export interface TraceExplanation {
  events: EventExplanation[];
  /** Notes on the session's title (it counts like the person's words for the domain). */
  title: EventNote[];
  /** For each derivation key, the events behind it, in order. */
  sources: Record<string, number[]>;
}

const PLACEHOLDER = /\[REDACTED:([a-z_]+)\]|<user>/g;
const REDACTION_NAMES: Record<string, string> = {
  private_key: "private key",
  anthropic_key: "API key",
  openai_key: "API key",
  stripe_key: "API key",
  google_api_key: "API key",
  aws_access_key: "cloud access key",
  aws_secret_key: "cloud secret key",
  github_token: "access token",
  slack_token: "access token",
  bearer_token: "access token",
  jwt: "access token",
  url_credentials: "password in a URL",
  secret: "secret",
  email: "email address",
  credit_card: "card number",
  phone: "phone number",
  ip_address: "IP address",
  home_path: "username in a path",
  internal_host: "internal hostname",
  custom_term: "word you hid",
  user: "username",
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function ordinal(n: number) {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? "th"}`;
}

function textsOf(e: TraceEvent): string[] {
  switch (e.type) {
    case "user_message":
    case "assistant_message":
      return [e.text];
    case "tool_call": {
      const out: string[] = [];
      const walk = (v: unknown) => {
        if (typeof v === "string") out.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(e.input);
      return out;
    }
    case "tool_result":
      return [e.output];
    case "system":
      return e.text ? [e.text] : [];
  }
}

function commandOf(e: TraceEvent): string | undefined {
  if (e.type !== "tool_call" || !e.input || typeof e.input !== "object") return undefined;
  const c = (e.input as Record<string, unknown>).command;
  return typeof c === "string" ? c : undefined;
}

function quote(s: string, max = 60) {
  const one = s.replace(/\s+/g, " ").trim();
  return `“${one.length > max ? `${one.slice(0, max)}…` : one}”`;
}

export function explainTrace(
  trace: Trace,
  /** The labels as stored or sent (only kind, code and evidence are read). */
  opts: { labels: { kind: string; code: string; evidence: number[] }[]; traits: TraceTraits },
): TraceExplanation {
  const { labels, traits } = opts;
  const ev = trace.events;
  const evidenceOf = (code: string) => new Set(labels.find((l) => l.code === code)?.evidence ?? []);
  const has = (code: string) => labels.some((l) => l.code === code);
  const toolError = evidenceOf("tool_error");
  const rejected = evidenceOf("tool_rejected");
  const retry = evidenceOf("retry_loop");
  const correction = evidenceOf("user_correction");
  const interrupt = evidenceOf("user_interrupt");
  const tampering = evidenceOf("test_tampering");
  const harness = evidenceOf("harness_error");
  const compaction = evidenceOf("context_compaction");
  const finalPassed = evidenceOf("tests_passed_at_end");
  const finalFailed = evidenceOf("tests_failed_at_end");
  const domain = traits.domain;
  const domainHits =
    domain && domain !== "unknown" ? domainEvidenceByEvent(trace, domain) : new Map();
  const domainLabelEvidence = evidenceOf(domain);

  const sources: Record<string, number[]> = {};
  const feed = (keys: string[], seq: number) => {
    for (const k of keys) {
      const list = (sources[k] ??= []);
      if (list.at(-1) !== seq) list.push(seq);
    }
  };

  const calls = new Map<string, Extract<TraceEvent, { type: "tool_call" }>>();
  const seenCalls = new Map<string, number>();
  const streak = new Map<string, number>(); // tool → consecutive failures so far
  let lastStreakTool: string | undefined;
  let prevTs: string | undefined;
  // The last failure the labeler counted, for "recovered".
  // Every failure the labeler found, tampering included: recovery can only
  // come after the last of them.
  const failureSeqs = [
    ...toolError,
    ...rejected,
    ...correction,
    ...interrupt,
    ...tampering,
    ...retry,
  ];
  const lastFailure = failureSeqs.length ? Math.max(...failureSeqs) : -1;
  let recoveryMarked = false;
  const domainToolSeen = new Set<string>();

  const events: EventExplanation[] = ev.map((e) => {
    const notes: EventNote[] = [];
    const note = (n: EventNote) => {
      notes.push(n);
      feed(n.feeds, e.seq);
    };
    let description = "";

    switch (e.type) {
      case "user_message": {
        description = e.interrupted
          ? "The person stopped the agent mid-step."
          : "The person speaks. Counts as a turn (richness).";
        if (interrupt.has(e.seq)) {
          note({
            kind: "failure",
            title: "User interrupt",
            detail:
              "The person cut the agent off, so the session is labelled user interrupt: a failure buyers study, which raises the failure factor.",
            feeds: ["label:failure:user_interrupt", "trait:interrupts", "factor:failure"],
          });
        }
        if (correction.has(e.seq)) {
          const phrase = correctionPhrase(e.text);
          const next = ev.find(
            (x) => x.seq > e.seq && (x.type === "tool_call" || x.type === "assistant_message"),
          );
          note({
            kind: "failure",
            title: "User correction",
            detail: `${phrase ? `Reads as a correction (${quote(phrase, 40)}). ` : "Reads as a correction. "}Labelled user correction: the person told the agent it was wrong, which raises the failure factor.`,
            feeds: ["label:failure:user_correction", "trait:userCorrections", "factor:failure"],
          });
          if (next) {
            note({
              kind: "failure",
              title: "Preference pair",
              detail: `The agent acted on the feedback next (event ${next.seq}): the wrong move and the corrected one form a preference pair, which buyers use for training. Each pair adds to the failure factor, up to a cap.`,
              feeds: ["trait:preferencePairs", "factor:failure"],
              related: [next.seq],
            });
          }
        }
        break;
      }
      case "assistant_message":
        description = "The agent speaks. Counts as a turn (richness).";
        break;
      case "tool_call": {
        calls.set(e.callId, e);
        description = `The agent runs ${e.tool}. Counts as a turn and a tool call (richness).`;
        const key = `${e.tool}|${JSON.stringify(e.input ?? {})}`;
        const earlier = seenCalls.get(key);
        if (earlier !== undefined && JSON.stringify(e.input ?? {}) !== "{}") {
          note({
            kind: "signal",
            title: "Repeated call",
            detail: `Same tool and input as event ${earlier}. Exact repeats count for little in richness, so padding a session doesn't raise its price.`,
            feeds: ["trait:repeatRatio", "factor:richness"],
            related: [earlier],
          });
        } else seenCalls.set(key, e.seq);
        const cmd = commandOf(e);
        if (cmd && isTestCommand(cmd)) {
          note({
            kind: "outcome",
            title: "Runs the tests",
            detail: `${quote(cmd, 50)} is a test command, so its result can make the outcome checkable.`,
            feeds: ["trait:testsRanAtEnd"],
          });
        }
        if (tampering.has(e.seq) || isTestTampering(e)) {
          note({
            kind: "failure",
            title: "Test tampering",
            detail:
              "Edits a test file and removes assertions instead of fixing the code. Labelled test tampering, the failure buyers want most for safety work.",
            feeds: ["label:failure:test_tampering", "factor:failure"],
          });
        }
        break;
      }
      case "tool_result": {
        const call = calls.get(e.callId);
        description = call
          ? `What ${call.tool} returned (answers event ${call.seq}).`
          : "A tool result.";
        if (!call) {
          note({
            kind: "authenticity",
            title: "Result without a call",
            detail:
              "No earlier call has this result's id, which recorded sessions never do. Fails the “every tool result follows its own call” check (tier 1), so the session is flagged and priced down.",
            feeds: ["check:tool_pairs", "factor:authenticity"],
          });
        }
        if (rejected.has(e.seq)) {
          note({
            kind: "failure",
            title: "Tool rejected",
            detail:
              "The person refused to let this tool run. Labelled tool rejected; refusals show what people won't allow, and raise the failure factor.",
            feeds: ["label:failure:tool_rejected", "trait:toolErrors", "factor:failure"],
          });
        } else if (e.isError) {
          if (toolError.has(e.seq)) {
            note({
              kind: "failure",
              title: "Tool error",
              detail: "The tool failed. Labelled tool error, and counted in tool errors.",
              feeds: ["label:failure:tool_error", "trait:toolErrors", "factor:failure"],
            });
          }
          const tool = call?.tool ?? "?";
          const n = (lastStreakTool === tool ? (streak.get(tool) ?? 0) : 0) + 1;
          streak.set(tool, n);
          lastStreakTool = tool;
          if (retry.has(e.seq)) {
            note({
              kind: "failure",
              title: `Retry loop: ${ordinal(n)} failure of ${tool} in a row`,
              detail:
                "Three or more failures of the same tool in a row: the agent is stuck repeating itself. Labelled retry loop, which raises the failure factor.",
              feeds: ["label:failure:retry_loop", "factor:failure"],
            });
          }
        } else {
          lastStreakTool = undefined;
          if (!recoveryMarked && lastFailure >= 0 && e.seq > lastFailure && has("recovered")) {
            recoveryMarked = true;
            note({
              kind: "outcome",
              title: "First success after the last failure",
              detail:
                "Nothing failed after this point, so the session counts as recovered: the agent got past its mistakes. Recovery is worth more than failure alone.",
              feeds: ["label:outcome:recovered", "factor:failure"],
            });
          }
        }
        // The final check comes from the label's evidence, so it is shown on
        // signals-only sessions too (whose output wasn't kept).
        if (finalPassed.has(e.seq) || finalFailed.has(e.seq)) {
          const passed = finalPassed.has(e.seq);
          if (traits.testsRanAtEnd) {
            note({
              kind: "outcome",
              title: passed ? "Final check: tests pass" : "Final check: tests fail",
              detail: `The last test run, after the last failure, so the outcome can be checked. ${
                passed
                  ? "Tests pass at the end: the recovery is proven, and a checkable outcome raises the quality factor."
                  : "Tests still fail at the end; a checkable outcome still raises the quality factor."
              }`,
              feeds: [
                `label:outcome:${passed ? "tests_passed_at_end" : "tests_failed_at_end"}`,
                "trait:testsRanAtEnd",
                "factor:quality",
              ],
            });
          } else {
            // The last run, but something failed after it: not a checkable outcome.
            note({
              kind: "outcome",
              title: `Last test run: ${passed ? "passed" : "failed"}`,
              detail:
                "The last test run in the session, but something failed after it, so it doesn't prove how the session ended and earns no quality bonus.",
              feeds: [`label:outcome:${passed ? "tests_passed_at_end" : "tests_failed_at_end"}`],
            });
          }
        } else {
          const cmd = call && commandOf(call);
          const result = cmd && isTestCommand(cmd) ? testRunResult(e.output, e.isError) : "unknown";
          if (result !== "unknown") {
            note({
              kind: "outcome",
              title: `Test run: ${result}`,
              detail:
                "Read from the output. Only the last run after the last failure decides the outcome.",
              feeds: [],
            });
          }
        }
        break;
      }
      case "system":
        description = `${e.kind.replace(/_/g, " ")} from the agent's harness. Not a turn.`;
        if (harness.has(e.seq)) {
          note({
            kind: "failure",
            title: "Harness error",
            detail:
              "The harness reported an error (an API error or overload). Labelled, but not counted as the agent's own failure.",
            feeds: ["label:failure:harness_error"],
          });
        }
        if (compaction.has(e.seq)) {
          note({
            kind: "signal",
            title: "Context compaction",
            detail:
              "The harness summarised earlier context to make room: a sign of a long session.",
            feeds: ["label:signal:context_compaction"],
          });
        }
        break;
    }

    // What pointed at the domain. A tool that points at it is noted on its
    // first use only (every later use still counts, and still links here).
    const hit = domainHits.get(e.seq);
    const toolOnly = hit && hit.tool && !hit.terms.length && !hit.files.length;
    if (toolOnly && domainToolSeen.has(hit.tool!)) {
      feed([`label:domain:${domain}`, "factor:rarity", "factor:niche"], e.seq);
    } else if (hit && (hit.terms.length || hit.tool || hit.files.length)) {
      if (hit.tool) domainToolSeen.add(hit.tool);
      const parts = [
        hit.terms.length
          ? `words ${hit.terms
              .slice(0, 5)
              .map((t: string) => `“${t}”`)
              .join(", ")}`
          : "",
        hit.tool
          ? `the ${hit.tool} tool${toolOnly ? " (noted on its first use; every use counts)" : ""}`
          : "",
        hit.files.length ? `files ${hit.files.join(", ")}` : "",
      ].filter(Boolean);
      const weight =
        e.type === "user_message"
          ? "The person's own words count most (3×)."
          : e.type === "tool_result"
            ? "Tool output counts least."
            : "";
      note({
        kind: "domain",
        title: `Points to ${domainName(domain)}${domainLabelEvidence.has(e.seq) ? " (strongest evidence)" : ""}`,
        detail:
          `Found ${parts.join(", ")}. ${weight} The domain sets rarity and the domain niche.`.replace(
            /\s+/g,
            " ",
          ),
        feeds: [`label:domain:${domain}`, "factor:rarity", "factor:niche"],
      });
    }

    // What the scrubber removed from this line.
    const found = new Map<string, number>();
    for (const t of textsOf(e)) {
      for (const m of t.matchAll(PLACEHOLDER)) {
        const k = m[1] ?? "user";
        found.set(k, (found.get(k) ?? 0) + 1);
      }
    }
    if (found.size) {
      note({
        kind: "quality",
        title: "Scrubbed",
        detail: `Removed before upload: ${[...found]
          .map(([k, n]) => plural(n, REDACTION_NAMES[k] ?? k.replace(/_/g, " ")))
          .join(
            ", ",
          )}. Heavily redacted sessions (over a fifth of the text) get a lower quality factor.`,
        feeds: ["trait:redactionDensity", "factor:quality"],
      });
    }

    // Time running backwards between lines.
    if (e.ts && prevTs && e.ts < prevTs) {
      note({
        kind: "authenticity",
        title: "Earlier than the line before",
        detail:
          "This line's time is before the previous one's. Recorded sessions only move forward, so the timestamps check (tier 1) fails.",
        feeds: ["check:timestamps", "factor:authenticity"],
      });
    }
    if (e.ts) prevTs = e.ts;

    return { seq: e.seq, description, notes };
  });

  // Label evidence the walk above didn't reach (e.g. a label with evidence
  // on an event type the walk doesn't annotate) still links back.
  for (const l of labels) {
    const k = `label:${l.kind}:${l.code}`;
    for (const seq of l.evidence) if (!(sources[k] ?? []).includes(seq)) feed([k], seq);
    sources[k]?.sort((a, b) => a - b);
  }
  // The title counts toward the domain like the person's own words.
  const title: EventNote[] = [];
  const titleHit = domainHits.get(-1);
  if (titleHit?.terms.length) {
    title.push({
      kind: "domain",
      title: `Points to ${domainName(domain)}`,
      detail: `The session's title has words ${titleHit.terms
        .slice(0, 5)
        .map((t: string) => `“${t}”`)
        .join(", ")}. Titles count as much as the person's own words (3×).`,
      feeds: [`label:domain:${domain}`, "factor:rarity", "factor:niche"],
    });
  }
  return { events, title, sources };
}
