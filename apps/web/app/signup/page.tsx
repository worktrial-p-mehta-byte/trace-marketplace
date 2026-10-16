import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-14">
      <h1 className="text-3xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-2 text-ink-2">Takes a minute. No payment details needed.</p>
      <div className="mt-8">
        <AuthForm mode="signup" />
      </div>
    </main>
  );
}
