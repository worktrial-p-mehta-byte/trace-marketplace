import type { Trace } from "@tm/schema";

/**
 * Converts one harness's native session log into canonical traces.
 * Adding a harness (Codex, Cursor, Aider) means adding one adapter;
 * nothing downstream changes. The Claude Code adapter arrives in M1.
 */
export interface TraceAdapter {
  /** Stable name stored in provenance.harness.name, e.g. "claude-code". */
  readonly name: string;
  /** Cheap check: does this file look like this harness's format? */
  detect(fileName: string, firstLine: string): boolean;
  /** Parse a whole session file. Returns an empty list for unusable files. */
  parse(fileName: string, contents: string): Trace[];
}

const registry: TraceAdapter[] = [];

export function registerAdapter(adapter: TraceAdapter): void {
  if (registry.some((a) => a.name === adapter.name)) {
    throw new Error(`Adapter "${adapter.name}" is already registered`);
  }
  registry.push(adapter);
}

export function listAdapters(): readonly TraceAdapter[] {
  return registry;
}
