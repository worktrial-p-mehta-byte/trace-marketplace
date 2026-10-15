import Link from "next/link";

/** "Trace" followed by a redaction bar that reads "marketplace". */
export function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-baseline gap-1.5 text-lg font-bold tracking-tight">
      <span>Trace</span>
      <span className="redaction !text-[0.7rem] !leading-[1.6]" aria-label="Marketplace">
        marketplace
      </span>
    </Link>
  );
}
