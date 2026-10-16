"use server";

import { redirect } from "next/navigation";
import {
  ensureAccount,
  FloodError,
  floodSupply,
  postBounty,
  resetSimulation,
  type PriceMove,
} from "@tm/core";
import { PATTERNS, type Pattern } from "@tm/synth";
import { DOMAIN_NAMES } from "@/lib/labels";
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
  for (const k of ["domain", "language", "failure"]) {
    const v = String(form.get(k) ?? "");
    if (v) q.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  redirect(`/market?${q.toString()}`);
}

function stackOf(form: FormData) {
  const [language, framework] = String(form.get("language") ?? "").split("/");
  const domain = String(form.get("domain") ?? "");
  return {
    domain: domain in DOMAIN_NAMES ? domain : undefined,
    language: language || undefined,
    framework: framework || undefined,
  };
}

export async function postBountyAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { domain, language, framework } = stackOf(form);
  const failure = String(form.get("failure") ?? "") || undefined;
  const perTrace = Math.min(500, Math.max(1, Number(form.get("perTrace") ?? 20)));
  const quantity = Math.min(500, Math.max(1, Math.round(Number(form.get("quantity") ?? 10))));
  if (!domain && !language && !failure)
    back(form, { error: "Choose a domain, a language or a failure type for the bounty." });
  // Sellers can try the simulator too: their bounty is posted for a demo buyer team.
  const orgId =
    user.buyerOrgId ??
    (await ensureAccount(getDb(), "simulator-buyer@example.com", "buyer", "Simulator buyer"))
      .buyerOrgId!;
  const r = postBounty(getDb(), deps(), {
    buyerOrgId: orgId,
    title: `${[domain && DOMAIN_NAMES[domain], language, framework, failure?.replace(/_/g, " ")]
      .filter(Boolean)
      .join(" ")} traces`,
    criteria: { domain, language, framework, failure },
    perTraceCents: Math.round(perTrace * 100),
    quantity,
  });
  back(form, { did: "bounty", r: summary(r.moves), budget: String(perTrace * quantity) });
}

export async function floodAction(form: FormData) {
  if (!(await getCurrentUser())) redirect("/login");
  const { domain, language, framework } = stackOf(form);
  const pattern = (String(form.get("failure") ?? "") || "clean") as Pattern;
  if (!domain && !language)
    back(form, { error: "Choose a domain or a language to add supply for." });
  if (!PATTERNS.some((p) => p.pattern === pattern))
    back(form, { error: "The simulator can't generate that failure type." });
  const count = Math.min(100, Math.max(1, Math.round(Number(form.get("count") ?? 20))));
  let r;
  try {
    r = await floodSupply(getDb(), deps(), { domain, language, framework, pattern, count });
  } catch (err) {
    if (err instanceof FloodError) back(form, { error: err.message });
    throw err;
  }
  back(form, {
    did: "flood",
    r: summary(r.moves),
    added: String(r.added),
    bought: String(r.bought),
  });
}

export async function resetAction(form: FormData) {
  if (!(await getCurrentUser())) redirect("/login");
  const r = await resetSimulation(getDb(), deps());
  back(form, { did: "reset", withdrawn: String(r.withdrawn) });
}
