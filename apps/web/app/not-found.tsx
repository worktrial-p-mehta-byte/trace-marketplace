import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-sm text-ink-3">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        This page is <span className="redaction align-middle !text-base">not here</span>
      </h1>
      <p className="mt-4 text-ink-2">
        The link may be wrong, or the trace was withdrawn by its seller and is no longer for sale.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/traces" className="btn">
          Browse traces
        </Link>
        <Link href="/" className="btn-quiet">
          Home
        </Link>
      </div>
    </main>
  );
}
