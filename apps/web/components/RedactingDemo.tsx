/**
 * A sample session (invented, not real data) that redacts itself once on
 * page load: what the seller's browser does to their own sessions.
 */
function Secret({ raw, label, delay }: { raw: string; label: string; delay: number }) {
  return (
    <span className="redact-target">
      <span aria-hidden="true">{raw}</span>
      <span
        className="redact-cover redaction"
        style={{ animationDelay: `${delay}ms` }}
        aria-label={`Removed: ${label}`}
      >
        {label}
      </span>
    </span>
  );
}

function Line({
  who,
  tone,
  children,
}: {
  who: string;
  tone?: "error" | "ok";
  children: React.ReactNode;
}) {
  const bar =
    tone === "error" ? "border-brick" : tone === "ok" ? "border-moss" : "border-transparent";
  return (
    <div className={`grid grid-cols-[4.5rem_1fr] gap-3 border-l-2 py-1.5 pl-3 ${bar}`}>
      <span className="font-sans text-xs font-semibold text-ink-3">{who}</span>
      <span className="break-words">{children}</span>
    </div>
  );
}

export function RedactingDemo() {
  return (
    <figure className="rounded-lg border border-rule bg-surface p-5 shadow-[0_1px_0_var(--color-rule)]">
      <div className="space-y-0.5 font-mono text-[0.8rem] leading-relaxed text-ink">
        <Line who="You">
          deploy billing, the key is <Secret raw="sk-ant-api03-Q7xK…" label="API key" delay={700} />
        </Line>
        <Line who="Tool call">
          cat /Users/
          <Secret raw="maya.okafor" label="user" delay={1100} />
          /billing/.env
        </Line>
        <Line who="Result" tone="error">
          STRIPE_KEY=
          <Secret raw="sk_live_51Hq…" label="API key" delay={1500} />
          {"  "}contact <Secret raw="maya@northwind.io" label="email" delay={1900} />
        </Line>
        <Line who="Agent">The date test is flaky. I&apos;ll delete the assertion.</Line>
        <Line who="You">No, don&apos;t delete the test. Fix the timezone bug.</Line>
        <Line who="Result" tone="ok">
          Tests: 42 passed, 42 total
        </Line>
      </div>
      <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4 text-sm">
        <span className="text-ink-2">
          Agent tampered with a test, you corrected it, it recovered.
        </span>
        <span className="font-semibold">
          <span className="price">$22.72</span>{" "}
          <span className="font-normal text-ink-3">estimated</span>
        </span>
      </figcaption>
    </figure>
  );
}
