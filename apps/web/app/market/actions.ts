"use server";

import { redirect } from "next/navigation";
import { ensureAccount, floodSupply, postBounty, resetSimulation, type PriceMove } from "@tm/core";
import type { Pattern } from "@tm/synth";
import { getBlobs, getBus, getConfig, getCurrentUser, getDb, getSearch } from "@/lib/server";

const deps = () => ({ config: getConfig(), bus: getBus(), blobs: getBlobs(), search: getSearch() });

function summary(moves: PriceMove[]): string {
  const moved = moves.filter((m) => m.before > 0 && m.after !== m.before);
  if (!moved.length) return "0:0";
  const avg = moved.reduce((s, m) => s + (m.after - m.before) / m.before, 0) / moved.length;
  return `${moved.length}:${Math.round(avg * 100)}`;
}

function back(form: FormData, extra: Record<string, string>) {
  const q = new URLSearchParams();
  for (const k of ["language", "failure"]) {
    const v = String(form.get(k) ?? "");
    if (v) q.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  redirect(`/market?${q.toString()}`);
}

function stackOf(form: FormData) {
  const [language, framework] = String(form.get("language") ?? "").split("/");
  return { language: language || undefined, framework: framework || undefined };
}

export async function postBountyAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { language, framework } = stackOf(form);
  const failure = String(form.get("failure") ?? "") || undefined;
  const perTrace = Math.min(500, Math.max(1, Number(form.get("perTrace") ?? 20)));
  const quantity = Math.min(500, Math.max(1, Math.round(Number(form.get("quantity") ?? 10))));
  if (!language && !failure)
    back(form, { error: "Choose a language or a failure type for the bounty." });
  // Sellers can try the simulator too: their bounty is posted for a demo buyer team.
  const orgId =
    user.buyerOrgId ??
    (await ensureAccount(getDb(), "simulator-buyer@example.com", "buyer", "Simulator buyer"))
      .buyerOrgId!;
  const r = postBounty(getDb(), deps(), {
    buyerOrgId: orgId,
    title: `${[language, framework, failure?.replace(/_/g, " ")].filter(Boolean).join(" ")} traces`,
    criteria: { language, framework, failure },
    perTraceCents: Math.round(perTrace * 100),
    quantity,
  });
  back(form, { did: "bounty", r: summary(r.moves), budget: String(perTrace * quantity) });
}

export async function floodAction(form: FormData) {
  if (!(await getCurrentUser())) redirect("/login");
  const { language, framework } = stackOf(form);
  const pattern = (String(form.get("failure") ?? "") || "clean") as Pattern;
  if (!language) back(form, { error: "Choose a language to add supply for." });
  const count = Math.min(100, Math.max(1, Math.round(Number(form.get("count") ?? 20))));
  const r = await floodSupply(getDb(), deps(), { language: language!, framework, pattern, count });
  back(form, { did: "flood", r: summary(r.moves), added: String(r.added) });
}

export async function resetAction(form: FormData) {
  if (!(await getCurrentUser())) redirect("/login");
  const r = await resetSimulation(getDb(), deps());
  back(form, { did: "reset", withdrawn: String(r.withdrawn) });
}
