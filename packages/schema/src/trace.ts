import { z } from "zod";

/**
 * Canonical trace schema, version 1.
 *
 * Every harness adapter converts its native log format into this shape.
 * A Trace stored on the platform has always been scrubbed and approved
 * by its seller. Derived data (labels, prices) lives elsewhere.
 */
export const TRACE_SCHEMA_VERSION = 1 as const;

/** Where the trace came from. Shown in the catalog so buyers know what they are looking at. */
export const TraceSource = z.enum(["real", "staged", "synthetic"]);
export type TraceSource = z.infer<typeof TraceSource>;

export const Provenance = z.object({
  source: TraceSource,
  harness: z.object({
    name: z.string().min(1), // e.g. "claude-code"
    version: z.string().optional(),
  }),
  model: z.object({
    id: z.string().min(1), // e.g. "claude-opus-5-5"
    provider: z.string().optional(),
  }),
  repo: z
    .object({
      /** SPDX license id detected in the repo, if any. */
      license: z.string().optional(),
      /** True when the repo has a public remote (used to suggest the OSS tier). */
      isPublic: z.boolean().optional(),
      languages: z.array(z.string()).default([]),
      frameworks: z.array(z.string()).default([]),
      commit: z.string().optional(),
    })
    .default({ languages: [], frameworks: [] }),
  capturedAt: z.string().datetime(),
});
export type Provenance = z.infer<typeof Provenance>;

const EventBase = z.object({
  /** Position in the session, starting at 0. */
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime().optional(),
});

export const UserMessageEvent = EventBase.extend({
  type: z.literal("user_message"),
  text: z.string(),
  /** True when the user interrupted the agent mid-action. */
  interrupted: z.boolean().optional(),
});

export const AssistantMessageEvent = EventBase.extend({
  type: z.literal("assistant_message"),
  text: z.string(),
});

export const ToolCallEvent = EventBase.extend({
  type: z.literal("tool_call"),
  callId: z.string(),
  tool: z.string(),
  input: z.unknown(),
});

export const ToolResultEvent = EventBase.extend({
  type: z.literal("tool_result"),
  callId: z.string(),
  output: z.string(),
  isError: z.boolean().default(false),
});

export const SystemEvent = EventBase.extend({
  type: z.literal("system"),
  kind: z.string(), // e.g. "compaction", "session_start"
  text: z.string().optional(),
});

export const TraceEvent = z.discriminatedUnion("type", [
  UserMessageEvent,
  AssistantMessageEvent,
  ToolCallEvent,
  ToolResultEvent,
  SystemEvent,
]);
export type TraceEvent = z.infer<typeof TraceEvent>;

/** Token usage across the session, when the harness records it. */
export const TraceMetrics = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  /** Number of distinct model responses. */
  modelResponses: z.number().int().nonnegative().optional(),
});
export type TraceMetrics = z.infer<typeof TraceMetrics>;

export const Trace = z.object({
  schemaVersion: z.literal(TRACE_SCHEMA_VERSION),
  /** Stable id derived from the harness session id (hashed, never the raw id). */
  id: z.string().min(1),
  title: z.string().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  provenance: Provenance,
  metrics: TraceMetrics.optional(),
  events: z.array(TraceEvent).min(1),
});
export type Trace = z.infer<typeof Trace>;
