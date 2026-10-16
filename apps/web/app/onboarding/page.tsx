import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSell, TERMS_VERSION } from "@tm/core";
import { TermsForm } from "@/components/TermsForm";
import { getConfig, getCurrentUser } from "@/lib/server";

export const metadata: Metadata = { title: "Before you share" };

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signup");
  const share = Math.round(getConfig().revenue.sellerShare * 100);
  // Sellers go to share; buyers answer four questions about what they need.
  const next = canSell(user) ? "/share" : "/welcome";
  const accepted = user.termsAcceptedVersion === TERMS_VERSION;

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <p className="text-sm font-semibold text-ink-3">Welcome, {user.displayName}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Before you share anything</h1>
      <p className="mt-3 leading-relaxed text-ink-2">
        Here is exactly what happens to a session you share. These are the data terms you agree to.
      </p>

      <dl className="mt-8 divide-y divide-rule border-y border-rule">
        <div className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
          <dt className="font-semibold">Stays on your machine</dt>
          <dd className="text-ink-2">
            Your raw session files. They are read and scrubbed inside this browser tab. Only the
            version you approve on the review screen is uploaded.
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
          <dt className="font-semibold">Removed automatically</dt>
          <dd className="text-ink-2">
            API keys and tokens, passwords, emails, phone and card numbers, IP addresses, your
            username in file paths, internal hostnames, and any words you add. Automatic scrubbing
            can miss things, so review each session before sharing it.
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
          <dt className="font-semibold">Two ways to share</dt>
          <dd className="space-y-2 text-ink-2">
            <p>
              <strong className="text-ink">Open source</strong>: the full scrubbed session. Only for
              open-source work or your own projects.
            </p>
            <p>
              <strong className="text-ink">Signals only</strong>: the shape of the session (which
              tools ran, what failed, when you stepped in) with no text or code. Safe for private
              work, and priced lower.
            </p>
          </dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
          <dt className="font-semibold">Your earnings</dt>
          <dd className="text-ink-2">You receive {share}% of every sale of your sessions.</dd>
        </div>
        <div className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
          <dt className="font-semibold">Withdrawing</dt>
          <dd className="text-ink-2">
            You can withdraw any session from sale at any time. Copies already sold stay with their
            buyers.
          </dd>
        </div>
      </dl>

      {accepted ? (
        <p className="mt-8 text-ink-2">
          You have already accepted these terms.{" "}
          <a href={next} className="font-semibold text-cobalt">
            Continue
          </a>
        </p>
      ) : (
        <TermsForm next={next} />
      )}
    </main>
  );
}
