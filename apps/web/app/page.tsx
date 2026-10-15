import Link from "next/link";
import { RedactingDemo } from "@/components/RedactingDemo";
import { getCurrentUser } from "@/lib/server";

const STEPS = [
  {
    title: "Choose sessions",
    body: "Pick Claude Code session files from your machine. They are read in your browser and never uploaded as they are.",
  },
  {
    title: "Review what leaves",
    body: "Keys, emails, your username and any words you add are blacked out. You see every redaction and the estimated price before anything is sent.",
  },
  {
    title: "Share and earn",
    body: "Approved sessions are listed and priced. You keep 70% of each sale and can withdraw a session from sale at any time.",
  },
];

export default async function Home() {
  const user = await getCurrentUser();
  const start = user ? "/share" : "/signup";
  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-16 pb-20 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <h1 className="text-[2.6rem] leading-[1.05] font-bold tracking-tight sm:text-[3.4rem]">
            Sell the sessions your coding agent already logs.
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-ink-2">
            AI labs pay for real examples of agents getting things wrong and recovering. Your
            sessions are scrubbed on your own machine, priced by what makes them rare, and you can
            withdraw them whenever you like.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={start} className="btn">
              Share your sessions
            </Link>
            <a href="#pricing" className="btn-quiet">
              See what traces are worth
            </a>
          </div>
        </div>
        <RedactingDemo />
      </section>

      <section className="border-t border-rule bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-bold tracking-tight">How sharing works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-t-2 border-ink pt-4">
                <p className="text-sm font-semibold text-ink-3">Step {i + 1}</p>
                <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-bold tracking-tight">What a trace is worth</h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-ink-2">
          Price follows what buyers learn from a session: failures, especially ones the agent
          recovered from, unusual languages and frameworks, and what buyers are searching for right
          now. Every price comes with its reasons.
        </p>
        <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-rule bg-rule md:grid-cols-2">
          <div className="bg-surface p-6">
            <p className="text-sm text-ink-3">An everyday session</p>
            <p className="mt-1 text-3xl font-bold">
              <span className="price">$1.76</span>
            </p>
            <p className="mt-3 text-ink-2">
              TypeScript and React, 18 turns, one tool error, a month old. Common, so rarity pulls
              the price down.
            </p>
          </div>
          <div className="bg-surface p-6">
            <p className="text-sm text-ink-3">A rare near-miss</p>
            <p className="mt-1 text-3xl font-bold">
              <span className="price">$22.72</span>
            </p>
            <p className="mt-3 text-ink-2">
              Rust and Tokio, 64 turns, stuck in a retry loop then recovered with tests passing, and
              a buyer has a bounty open for exactly this.
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-ink-3">
          Illustrative prices from the pricing model. Prices move as the catalog and demand change.
        </p>
      </section>
    </main>
  );
}
