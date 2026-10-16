"use server";

import { redirect } from "next/navigation";
import { deleteSavedSearch, saveSearch, SavedSearchError, type SavedQuery } from "@tm/core";
import { getBus, getConfig, getCurrentUser, getDb } from "@/lib/server";

const KEYS = [
  "q",
  "domain",
  "authenticity",
  "language",
  "framework",
  "failure",
  "outcome",
  "tier",
  "model",
  "source",
];

function backTo(form: FormData, extra: Record<string, string>) {
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = String(form.get(k) ?? "");
    if (v) q.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  redirect(`/traces?${q.toString()}`);
}

export async function saveSearchAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const get = (k: string) => String(form.get(k) ?? "") || undefined;
  const query: SavedQuery = {
    text: get("q"),
    domain: get("domain"),
    authenticity: get("authenticity"),
    language: get("language"),
    framework: get("framework"),
    failure: get("failure"),
    outcome: get("outcome") as SavedQuery["outcome"],
    tier: get("tier") === "1" ? 1 : get("tier") === "0" ? 0 : undefined,
    model: get("model"),
    source: get("source") as SavedQuery["source"],
  };
  try {
    saveSearch(getDb(), { config: getConfig(), bus: getBus() }, user, { query });
  } catch (err) {
    if (err instanceof SavedSearchError) backTo(form, { saveError: err.message });
    throw err;
  }
  backTo(form, { saved: "1" });
}

export async function deleteSavedSearchAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user?.buyerOrgId) redirect("/login");
  deleteSavedSearch(getDb(), user.buyerOrgId, String(form.get("id") ?? ""));
  backTo(form, {});
}
