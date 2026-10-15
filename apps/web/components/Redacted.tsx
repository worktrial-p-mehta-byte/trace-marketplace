import { Fragment } from "react";

const PLACEHOLDER = /(\[REDACTED:[a-z_]+\]|<user>)/g;

const LABELS: Record<string, string> = {
  anthropic_key: "API key",
  openai_key: "API key",
  stripe_key: "API key",
  github_token: "token",
  slack_token: "token",
  google_api_key: "API key",
  aws_access_key: "AWS key",
  aws_secret_key: "AWS secret",
  jwt: "token",
  bearer_token: "token",
  url_credentials: "password",
  secret: "secret",
  private_key: "private key",
  email: "email",
  credit_card: "card number",
  phone: "phone",
  ip_address: "IP address",
  home_path: "username",
  internal_host: "hostname",
  custom_term: "hidden word",
};

export function redactionLabel(kind: string): string {
  return LABELS[kind] ?? kind.replace(/_/g, " ");
}

/** Render scrubbed text with every placeholder shown as an ink redaction bar. */
export function Redacted({ text }: { text: string }) {
  const parts = text.split(PLACEHOLDER);
  return (
    <>
      {parts.map((p, i) => {
        if (p === "<user>") {
          return (
            <span key={i} className="redaction" title="Removed: username">
              user
            </span>
          );
        }
        const m = /^\[REDACTED:([a-z_]+)\]$/.exec(p);
        if (m) {
          const label = redactionLabel(m[1]!);
          return (
            <span key={i} className="redaction" title={`Removed: ${label}`}>
              {label}
            </span>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
