"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function WithdrawButton({ traceId }: { traceId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className="text-sm font-semibold text-brick hover:underline"
        onClick={() => setConfirming(true)}
      >
        Withdraw
      </button>
    );
  }
  return (
    <span className="flex items-center gap-3 text-sm">
      <span className="text-ink-2">Stop selling it?</span>
      <button
        type="button"
        className="font-semibold text-brick hover:underline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await fetch(`/api/traces/${traceId}/revoke`, { method: "POST" });
          router.refresh();
        }}
      >
        {busy ? "Withdrawing…" : "Withdraw"}
      </button>
      <button
        type="button"
        className="text-ink-3 hover:text-ink"
        onClick={() => setConfirming(false)}
      >
        Keep selling
      </button>
    </span>
  );
}
