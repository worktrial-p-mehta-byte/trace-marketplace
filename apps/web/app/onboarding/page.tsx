import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { canSell, TERMS_VERSION } from "@tm/core";
import { TermsForm } from "@/components/TermsForm";
import { money } from "@/lib/labels";
import { getConfig, getCurrentUser } from "@/lib/server";

export const metadata: Metadata = { title: "Before you start" };

export const dynamic = "force-dynamic";

type Row = [term: string, body: ReactNode];

function Terms({ rows }: { rows: Row[] }) {
  return (
    <dl className="mt-4 divide-y divide-rule border-y border-rule">
      {rows.map(([term, body]) => (
        <div key={term} className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
          <dt className="font-semibold">{term}</dt>
          <dd className="space-y-2 text-ink-2">{body}</dd>
        </div>
      ))}
    </dl>
  );
}

function sellerRows(share: number): Row[] {
  return [
    [
      "Stays on your machine",
      "Your raw session files. They are read and scrubbed inside this browser tab. Only the version you approve on the review screen is uploaded.",
    ],
    [
      "Removed automatically",
      "API keys and tokens, passwords, emails, phone and card numbers, IP addresses, your username in file paths, internal hostnames, and any words you add. Automatic scrubbing can miss things, so review each session before sharing it.",
    ],
    [
      "Two ways to share",
      <>
        <p>
          <strong className="text-ink">Open source</strong>: the full scrubbed session. Only for
          open-source work or your own projects.
        </p>
        <p>
          <strong className="text-ink">Signals only</strong>: the shape of the session (which tools
          ran, what failed, when you stepped in) with no text or code. Safe for private work, and
          priced lower.
        </p>
      </>,
    ],
    ["Your earnings", `You receive ${share}% of every sale of your sessions.`],
    [
      "Withdrawing",
      "You can withdraw any session from sale at any time. Copies already sold stay with their buyers.",
    ],
  ];
}

function buyerRows(welcome: number, share: number, lockMinutes: number): Row[] {
  return [
    [
      "What you get",
      <>
        <p>
          Recorded agent sessions that sellers chose to share, scrubbed of secrets and personal
          details before they were uploaded.
        </p>
        <p>
          <strong className="text-ink">Open source</strong> sessions include the scrubbed
          conversation and code. <strong className="text-ink">Signals only</strong> sessions include
          just their shape: which tools ran, what failed, when the person stepped in. Synthetic
          sessions are labelled as such.
        </p>
      </>,
    ],
    [
      "Licences",
      "Each purchase is a licence to study, evaluate or train on a session. Licences are non-exclusive and don't expire; use a session only within the licence you bought, and don't redistribute it.",
    ],
    [
      "Paying",
      `Your team pays in credits and starts with ${money(welcome)}. Prices move with supply and demand; a quote holds its price for ${lockMinutes} minutes. Sellers receive ${share}% of every sale.`,
    ],
    [
      "Checks are not guarantees",
      "Labels, prices and authenticity levels come from automated checks of each session. Read the evidence on a listing before relying on it.",
    ],
    [
      "Respect the people in them",
      "Don't try to identify sellers or anyone mentioned in a session. If you find something personal that scrubbing missed, don't use it.",
    ],
  ];
}

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signup");
  const config = getConfig();
  const share = Math.round(config.revenue.sellerShare * 100);
  const sells = canSell(user);
  const buys = Boolean(user.buyerOrgId);
  // Anyone who buys (including "both" accounts) answers four questions about
  // what they need first; sellers only go straight to sharing.
  const next = buys ? "/welcome" : sells ? "/share" : "/";
  const accepted = user.termsAcceptedVersion === TERMS_VERSION;
  const both = sells && buys;

  const heading = both
    ? "Before you share or buy"
    : buys
      ? "Before you buy anything"
      : "Before you share anything";
  const intro = both
    ? "Here is what happens to a session you share, and what you can do with one you buy. These are the terms you agree to."
    : buys
      ? "Here is what you are buying and how you may use it. These are the terms you agree to."
      : "Here is exactly what happens to a session you share. These are the data terms you agree to.";
  const agreement = both
    ? "I agree to these terms. I will only share sessions I have the right to share, I understand that sold copies can't be recalled, and I will use what I buy only within its licence."
    : buys
      ? "I agree to these terms. I will use what I buy only within its licence, won't redistribute it, and won't try to identify the people in it."
      : "I agree to these terms. I will only share sessions I have the right to share, and I understand that sold copies can't be recalled.";

  const buyer = buyerRows(
    config.checkout.welcomeCreditCents,
    share,
    config.pricing.quoteLockMinutes,
  );
  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <p className="text-sm font-semibold text-ink-3">Welcome, {user.displayName}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{heading}</h1>
      <p className="mt-3 leading-relaxed text-ink-2">{intro}</p>

      {both ? (
        <>
          <h2 className="mt-8 text-lg font-bold">When you share</h2>
          <Terms rows={sellerRows(share)} />
          <h2 className="mt-8 text-lg font-bold">When you buy</h2>
          <Terms rows={buyer} />
        </>
      ) : (
        <div className="mt-4">
          <Terms rows={buys ? buyer : sellerRows(share)} />
        </div>
      )}

      {accepted ? (
        <p className="mt-8 text-ink-2">
          You have already accepted these terms.{" "}
          <a href={next} className="font-semibold text-cobalt">
            Continue
          </a>
        </p>
      ) : (
        <TermsForm next={next} agreement={agreement} />
      )}
    </main>
  );
}
