"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TermsForm({ next }: { next: string }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-8 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!checked) {
          setError("Tick the box to accept the data terms.");
          return;
        }
        setBusy(true);
        const res = await fetch("/api/onboarding/terms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accept: true }),
        });
        setBusy(false);
        if (!res.ok) {
          setError((await res.json()).error);
          return;
        }
        router.push(next);
        router.refresh();
      }}
    >
      <label className="flex gap-3 rounded-md border border-rule bg-surface p-4">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            setChecked(e.target.checked);
            setError(null);
          }}
          className="mt-1 size-4 accent-cobalt"
        />
        <span>
          I agree to these terms. I will only share sessions I have the right to share, and I
          understand that sold copies can&apos;t be recalled.
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-brick">
          {error}
        </p>
      )}
      <button className="btn" disabled={busy}>
        {busy ? "Saving…" : "Accept and continue"}
      </button>
    </form>
  );
}
