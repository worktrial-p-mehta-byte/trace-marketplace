"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const ROLES = [
  {
    value: "seller",
    title: "Share my sessions",
    body: "Sell traces from your own AI agent sessions.",
  },
  { value: "buyer", title: "Buy traces", body: "Search the catalog for your team's research." },
  { value: "both", title: "Both", body: "Share your sessions and buy others'." },
] as const;

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<(typeof ROLES)[number]["value"]>("seller");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const body =
      mode === "signup"
        ? {
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
            displayName: String(form.get("displayName") ?? ""),
            role,
          }
        : { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
    setBusy(true);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Try again.");
      return;
    }
    // New accounts and anyone who hasn't accepted the terms see the terms
    // for their role; returning sellers go to sharing, buyers to the market.
    const user = data.user as { termsAcceptedVersion: string | null; role: string };
    const sells = user.role === "seller" || user.role === "both" || user.role === "admin";
    router.push(
      mode === "signup" || !user.termsAcceptedVersion
        ? "/onboarding"
        : sells
          ? "/share"
          : "/market",
    );
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {mode === "signup" && (
        <label className="block">
          <span className="text-sm font-semibold">Name</span>
          <input
            name="displayName"
            className="field mt-1.5"
            autoComplete="name"
            placeholder="Optional"
          />
        </label>
      )}
      <label className="block">
        <span className="text-sm font-semibold">Email</span>
        <input name="email" type="email" required className="field mt-1.5" autoComplete="email" />
      </label>
      <label className="block">
        <span className="text-sm font-semibold">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          className="field mt-1.5"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
        {mode === "signup" && (
          <span className="mt-1 block text-sm text-ink-3">At least 8 characters.</span>
        )}
      </label>

      {mode === "signup" && (
        <fieldset>
          <legend className="text-sm font-semibold">How will you use the marketplace?</legend>
          <div className="mt-2 grid gap-2">
            {ROLES.map((r) => (
              <label
                key={r.value}
                className={`flex cursor-pointer gap-3 rounded-md border p-3 ${
                  role === r.value ? "border-cobalt bg-surface" : "border-rule bg-surface/60"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  checked={role === r.value}
                  onChange={() => setRole(r.value)}
                  className="mt-1 accent-cobalt"
                />
                <span>
                  <span className="block font-semibold">{r.title}</span>
                  <span className="block text-sm text-ink-2">{r.body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-brick/40 bg-brick/5 px-3 py-2 text-sm text-brick"
        >
          {error}
        </p>
      )}
      <button type="submit" className="btn w-full" disabled={busy}>
        {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      <p className="text-center text-sm text-ink-2">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-cobalt">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-semibold text-cobalt">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
