# Fixtures

Only **synthetic** or **already-scrubbed** data belongs here. The repo is
public. `pnpm check:secrets` fails if a fixture contains an API key, a raw
home path (use `/Users/<user>/...`) or a real email address.

| File                                  | What it is                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code/synthetic-session.jsonl` | Hand-written Claude Code session in the native log format. Covers summaries, meta and command lines, thinking blocks, tool errors, a rejected tool call, an interrupt, a correction, a sub-agent (sidechain) line, a malformed line, an unknown line type, a compaction boundary and a `<synthetic>` model entry. |
