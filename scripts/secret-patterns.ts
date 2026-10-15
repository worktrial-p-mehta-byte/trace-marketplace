/**
 * Patterns that must never appear in committed files. The repo is public,
 * and fixtures must only ever hold synthetic or already-scrubbed traces.
 * Put `tm-allow-secret` on a line to mark an intentional fake (e.g. in
 * scrubber tests).
 */
export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI-style API key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    name: "GitHub token",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/,
  },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

/** Extra rules for fixtures/: raw home paths mean a session was not scrubbed. */
export const FIXTURE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Unscrubbed macOS home path", re: /\/Users\/(?!<user>|REDACTED)[A-Za-z0-9._-]+\// },
  { name: "Unscrubbed Linux home path", re: /\/home\/(?!<user>|REDACTED)[A-Za-z0-9._-]+\// },
  {
    name: "Email address",
    re: /[A-Za-z0-9._%+-]+@(?!example\.(?:com|org))[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  },
];

export const ALLOW_MARKER = "tm-allow-secret";

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

export function scanText(file: string, text: string, isFixture: boolean): Finding[] {
  const rules = isFixture ? [...SECRET_PATTERNS, ...FIXTURE_PATTERNS] : SECRET_PATTERNS;
  const findings: Finding[] = [];
  text.split("\n").forEach((lineText, i) => {
    if (lineText.includes(ALLOW_MARKER)) return;
    for (const r of rules) {
      if (r.re.test(lineText)) findings.push({ file, line: i + 1, rule: r.name });
    }
  });
  return findings;
}
