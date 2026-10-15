import { redirect } from "next/navigation";
import { canSell, TERMS_VERSION } from "@tm/core";
import { ShareFlow } from "@/components/share/ShareFlow";
import { getConfig, getCurrentUser } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function SharePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signup");
  if (user.termsAcceptedVersion !== TERMS_VERSION) redirect("/onboarding");
  if (!canSell(user)) redirect("/");
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Share sessions</h1>
      <p className="mt-2 max-w-2xl text-ink-2">
        Your sessions are read and scrubbed in this browser tab. Review each one, choose how to
        share it, and only what you approve is uploaded.
      </p>
      <ShareFlow sellerShare={getConfig().revenue.sellerShare} />
    </main>
  );
}
