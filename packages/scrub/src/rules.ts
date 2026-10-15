/**
 * Redaction rules. Each rule finds spans to replace; `group` selects which
 * capture group is the sensitive part (0 = whole match), so surrounding
 * context such as `API_KEY=` stays readable. A rule that sets `group` must
 * capture its entire match in consecutive groups (lookaheads are fine), so
 * the match can be rebuilt with just that group swapped.
 *
 * Order matters within a stage: more specific patterns come first so a
 * GitHub token is reported as `github_token`, not a generic `secret`.
 */
export interface Rule {
  kind: string;
  re: RegExp;
  group?: number;
  replace?: (match: string) => string;
  /** Extra check on the matched text; return false to keep it. */
  accept?: (match: string) => boolean;
}

export const tag = (kind: string) => `[REDACTED:${kind}]`;

/** Zero-tolerance secrets. */
export const SECRET_RULES: Rule[] = [
  {
    kind: "private_key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  { kind: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai_key", re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { kind: "stripe_key", re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  {
    kind: "github_token",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  },
  { kind: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    kind: "aws_secret_key",
    re: /(aws_secret_access_key|AWS_SECRET_ACCESS_KEY)(\s*[:=]\s*["']?)([A-Za-z0-9/+=]{40})/g,
    group: 3,
  },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    kind: "bearer_token",
    re: /(\b[Bb]earer\s+)([A-Za-z0-9._~+/=-]{16,})/g,
    group: 2,
  },
  {
    kind: "url_credentials",
    // scheme://user:password@host — keep scheme and host, drop credentials.
    re: /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+:[^\s/@]+)(@)/gi,
    group: 2,
  },
  {
    kind: "secret",
    // KEY=value / "token": "value" where the key name says it's a secret.
    re: /((?:[A-Za-z0-9_-]*?)(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key)["']?\s*[:=]\s*["']?)([^\s"',;}]{8,})/gi,
    group: 2,
    // Skip obvious code: env lookups, types, template placeholders, redactions.
    accept: (v) =>
      !/^(?:process\.env|os\.environ|env\.|\$\{|\{\{|<|\[REDACTED|string\b|number\b|undefined|null|true|false)/i.test(
        v,
      ) && /[0-9]/.test(v),
  },
];

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Personal data. */
export const PII_RULES: Rule[] = [
  {
    kind: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    accept: (m) => !/@(?:example\.(?:com|org|net)|users\.noreply\.github\.com)$/i.test(m),
  },
  {
    kind: "credit_card",
    re: /\b(?:\d[ -]?){13,19}\b/g,
    accept: (m) => {
      const d = m.replace(/[ -]/g, "");
      return d.length >= 13 && d.length <= 19 && luhnValid(d);
    },
  },
  {
    kind: "phone",
    re: /(?<![\w.])\+?1?[ .-]?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\w.])/g,
  },
  {
    kind: "ip_address",
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    // Loopback, unspecified and documentation ranges carry no information.
    accept: (m) => !/^(?:127\.|0\.0\.0\.0|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(m),
  },
];

/** Home directories reveal the user's account name; keep the path shape. */
export const PATH_RULES: Rule[] = [
  {
    kind: "home_path",
    re: /(\/Users\/|\/home\/)(?!<user>)([A-Za-z0-9._-]+)(?=\/|\b)/g,
    group: 2,
    replace: () => "<user>",
  },
  {
    kind: "home_path",
    re: /([A-Za-z]:\\\\?Users\\\\?)(?!<user>)([A-Za-z0-9._ -]+?)(?=\\)/g,
    group: 2,
    replace: () => "<user>",
  },
];

/** Internal hostnames (corporate or local network names). */
export const HOST_RULES: Rule[] = [
  {
    kind: "internal_host",
    re: /\b(?:[a-z0-9-]+\.)+(?:internal|corp|local|lan|intranet|private)\b/gi,
    accept: (m) => m.toLowerCase() !== "localhost.local",
  },
];

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Terms the seller asks to hide (their name, company, project codename). */
export function customTermRules(terms: string[]): Rule[] {
  const clean = terms.map((t) => t.trim()).filter((t) => t.length >= 2);
  if (!clean.length) return [];
  return [
    {
      kind: "custom_term",
      re: new RegExp(
        `(?<![A-Za-z0-9])(?:${clean.map(escapeRegExp).join("|")})(?![A-Za-z0-9])`,
        "gi",
      ),
    },
  ];
}
