"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Shown when a page throws. The details go to the server log, not the screen. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="text-3xl font-bold tracking-tight">Something went wrong on our side</h1>
      <p className="mt-4 text-ink-2">
        Try again. If it keeps happening, check that the database is set up (
        <Link href="/status" className="text-cobalt">
          system status
        </Link>
        ).
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-sm text-ink-3">Reference {error.digest}</p>
      )}
      <div className="mt-8 flex gap-3">
        <button type="button" className="btn" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn-quiet">
          Home
        </Link>
      </div>
    </main>
  );
}
