import { describe, expect, it } from "vitest";
import { Trace, TRACE_SCHEMA_VERSION } from "@tm/schema";
import { buildStages, isSensitiveKey, scrubTrace } from "./index";

// Fake secrets are assembled at runtime so this file passes the repo's own secret scan.
const FAKE = {
  anthropic: "sk-" + "ant-api03-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4",
  openai: "sk-" + "proj-" + "abcdefghijklmnopqrstuvwxyz0123456789AB",
  github: "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz0123456789",
  aws: "AK" + "IA" + "IOSFODNN7EXAMPLE",
  awsSecret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCY" + "EXAMPLEKEY",
  stripe: "sk_" + "live_" + "4eC39HqLyjWDarjtT1zdp7dc",
  jwt:
    "eyJ" +
    "hbGciOiJIUzI1NiJ9.eyJ" +
    "zdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
};

const text = (s: string) => buildStages().reduce((acc, st) => st.scrubText(acc).text, s);

describe("secrets stage", () => {
  it.each([
    ["Anthropic key", `export ANTHROPIC_API_KEY=${FAKE.anthropic}`, "[REDACTED:anthropic_key]"],
    ["OpenAI key", `key = "${FAKE.openai}"`, "[REDACTED:openai_key]"],
    ["GitHub token", `git clone https://${FAKE.github}@github.com/x/y`, "[REDACTED:github_token]"],
    ["AWS access key", `aws_access_key_id = ${FAKE.aws}`, "[REDACTED:aws_access_key]"],
    ["Stripe key", `STRIPE=${FAKE.stripe}`, "[REDACTED:stripe_key]"],
    ["JWT", `cookie: session=${FAKE.jwt}`, "[REDACTED:jwt]"],
  ])("redacts %s", (_name, input, expected) => {
    const out = text(input);
    expect(out).toContain(expected);
    expect(out).not.toMatch(/sk-ant-api03|sk-proj-|ghp_|AKIA|sk_live_|eyJhbG/);
  });

  it("keeps the variable name and redacts only the value", () => {
    expect(text(`aws_secret_access_key = ${FAKE.awsSecret}`)).toBe(
      "aws_secret_access_key = [REDACTED:aws_secret_key]",
    );
    expect(text("DB_PASSWORD=hunter2hunter2")).toBe("DB_PASSWORD=[REDACTED:secret]");
    expect(text('{"api_key": "abc123def456ghi"}')).toBe('{"api_key": "[REDACTED:secret]"}');
  });

  it("redacts bearer tokens and URL credentials but keeps hosts", () => {
    expect(text("Authorization: Bearer abcdef0123456789abcdef")).toBe(
      "Authorization: Bearer [REDACTED:bearer_token]",
    );
    expect(text("postgres://admin:s3cretpw@db.example.com:5432/app")).toBe(
      "postgres://[REDACTED:url_credentials]@db.example.com:5432/app",
    );
  });

  it("redacts whole private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----"; // tm-allow-secret
    expect(text(`key:\n${pem}\ndone`)).toBe("key:\n[REDACTED:private_key]\ndone");
  });

  it("leaves ordinary code alone", () => {
    const code = [
      "const password: string = process.env.DB_PASSWORD;",
      "token = getToken()",
      "if (apiKey === undefined) throw new Error('missing api key')",
      "secret: ${{ secrets.DEPLOY_KEY }}",
    ].join("\n");
    expect(text(code)).toBe(code);
  });
});

describe("PII, path and host stages", () => {
  it("redacts emails but keeps example and noreply addresses", () => {
    expect(text("contact jane.doe@acme.io or dev@example.com")).toBe(
      "contact [REDACTED:email] or dev@example.com",
    );
  });

  it("redacts valid card numbers only (Luhn check)", () => {
    expect(text("card 4242 4242 4242 4242")).toBe("card [REDACTED:credit_card]");
    expect(text("order 1234 5678 9012 3456")).toBe("order 1234 5678 9012 3456");
  });

  it("redacts phone numbers and public IPs but not loopback or versions", () => {
    expect(text("call (415) 555-0132")).toBe("call [REDACTED:phone]");
    expect(text("server at 34.120.5.17, local 127.0.0.1")).toBe(
      "server at [REDACTED:ip_address], local 127.0.0.1",
    );
    expect(text("node v22.12.0 and version 1.2.3.4-beta")).toContain("v22.12.0");
  });

  it("replaces the account name in home paths but keeps the path shape", () => {
    expect(text("/Users/priya/code/app/src/index.ts")).toBe("/Users/<user>/code/app/src/index.ts");
    expect(text("cd /home/ubuntu/project")).toBe("cd /home/<user>/project");
    expect(text("C:\\Users\\Priya\\repo\\main.py")).toBe("C:\\Users\\<user>\\repo\\main.py");
  });

  it("redacts internal hostnames", () => {
    expect(text("curl http://build01.corp:8080/status")).toBe(
      "curl http://[REDACTED:internal_host]:8080/status",
    );
  });

  it("hides custom terms the seller adds, whole words only", () => {
    const stages = buildStages({ customTerms: ["Acme", "Project Falcon"] });
    const out = stages.reduce(
      (s, st) => st.scrubText(s).text,
      "Acme's Project Falcon (not Acmeville)",
    );
    expect(out).toBe("[REDACTED:custom_term]'s [REDACTED:custom_term] (not Acmeville)");
  });

  it("lets optional stages be disabled, never secrets", () => {
    const stages = buildStages({ disable: ["pii", "paths", "hosts"] });
    expect(stages.map((s) => s.name)).toEqual(["secrets"]);
  });
});

describe("scrubTrace", () => {
  const trace = Trace.parse({
    schemaVersion: TRACE_SCHEMA_VERSION,
    id: "t1",
    title: "Deploy for jane@acme.io",
    startedAt: "2026-10-10T09:00:00Z",
    endedAt: "2026-10-10T09:05:00Z",
    provenance: {
      source: "real",
      harness: { name: "claude-code" },
      model: { id: "m" },
      capturedAt: "2026-10-10T09:05:00Z",
    },
    events: [
      { seq: 0, type: "user_message", text: `Use key ${FAKE.anthropic} to deploy` },
      {
        seq: 1,
        type: "tool_call",
        callId: "c1",
        tool: "Bash",
        input: { command: "cat /Users/jane/.env", nested: [{ token: `ghx ${FAKE.github}` }] },
      },
      { seq: 2, type: "tool_result", callId: "c1", output: "OPENAI=" + FAKE.openai },
      { seq: 3, type: "assistant_message", text: "Done. No secrets here." },
    ],
  });
  const result = scrubTrace(trace);
  const json = JSON.stringify(result.trace);

  it("scrubs every text field, including nested tool input and the title", () => {
    for (const secret of [FAKE.anthropic, FAKE.github, FAKE.openai, "jane", "acme.io"]) {
      expect(json).not.toContain(secret);
    }
    expect(result.trace.title).toBe("Deploy for [REDACTED:email]");
    expect(result.trace.events[1]).toMatchObject({
      input: {
        command: "cat /Users/<user>/.env",
        nested: [{ token: "[REDACTED:secret]" }],
      },
    });
  });

  it("reports redactions by kind and event, without the removed text", () => {
    expect(result.stats.byKind).toEqual({
      anthropic_key: 1,
      secret: 1,
      openai_key: 1,
      home_path: 1,
      email: 1,
    });
    expect(result.redactions.map((r) => r.eventSeq).sort()).toEqual([-1, 0, 1, 1, 2]);
    expect(JSON.stringify(result.redactions)).not.toContain("sk-");
  });

  it("computes redaction density between 0 and 1", () => {
    expect(result.stats.density).toBeGreaterThan(0);
    expect(result.stats.density).toBeLessThan(1);
  });

  it("does not mutate the input trace", () => {
    expect(trace.events[0]).toMatchObject({ text: expect.stringContaining("sk-ant-") });
  });

  it("is idempotent: scrubbing twice finds nothing new", () => {
    const again = scrubTrace(result.trace);
    expect(again.stats.redactions).toBe(0);
    expect(again.trace).toEqual(result.trace);
  });
});

describe("structured credentials in tool input", () => {
  const withInput = (input: unknown) =>
    Trace.parse({
      schemaVersion: TRACE_SCHEMA_VERSION,
      id: "t2",
      startedAt: "2026-10-10T09:00:00Z",
      endedAt: "2026-10-10T09:05:00Z",
      provenance: {
        source: "real",
        harness: { name: "claude-code" },
        model: { id: "m" },
        capturedAt: "2026-10-10T09:05:00Z",
      },
      events: [{ seq: 0, type: "tool_call", callId: "c1", tool: "Login", input }],
    });

  it("redacts bare values under credential keys, whatever they look like", () => {
    const r = scrubTrace(
      withInput({ user: "sam", password: "p4ssphrase", api_key: "notarealtoken123" }), // tm-allow-secret
    );
    expect(r.trace.events[0]).toMatchObject({
      input: { user: "sam", password: "[REDACTED:secret]", api_key: "[REDACTED:secret]" },
    });
    expect(r.stats.byKind).toEqual({ secret: 2 });
  });

  it("covers camelCase, headers, numbers and anything nested under a credential key", () => {
    const r = scrubTrace(
      withInput({
        headers: { Authorization: "Basic c2FtOmh1bnRlcjI=", Cookie: "sid=abc" },
        accessToken: "plainvalue",
        pin: 4921,
        credentials: { user: "sam", list: ["one", "two"] },
      }),
    );
    expect(r.trace.events[0]).toMatchObject({
      input: {
        headers: { Authorization: "[REDACTED:secret]", Cookie: "[REDACTED:secret]" },
        accessToken: "[REDACTED:secret]",
        pin: "[REDACTED:secret]",
        credentials: {
          user: "[REDACTED:secret]",
          list: ["[REDACTED:secret]", "[REDACTED:secret]"],
        },
      },
    });
    expect(JSON.stringify(r.trace)).not.toMatch(/c2Ft|abc|plainvalue|4921|"sam"/);
  });

  it("leaves keys that only look sensitive alone", () => {
    for (const k of ["max_tokens", "tokenizer", "secret_name", "author", "password_hint_shown"]) {
      expect(isSensitiveKey(k), k).toBe(false);
    }
    for (const k of [
      "password",
      "api_key",
      "apiKey",
      "ACCESS_TOKEN",
      "client-secret",
      "db_password",
    ]) {
      expect(isSensitiveKey(k), k).toBe(true);
    }
  });
});
