import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-14">
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <div className="mt-8">
        <AuthForm mode="login" />
      </div>
    </main>
  );
}
