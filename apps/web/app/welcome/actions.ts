"use server";

import { redirect } from "next/navigation";
import { PreferencesError, setBuyerPreferences } from "@tm/core";
import type { LicenseScope } from "@tm/schema";
import { getBus, getConfig, getCurrentUser, getDb } from "@/lib/server";

export async function savePreferencesAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  try {
    setBuyerPreferences(getDb(), { config: getConfig(), bus: getBus() }, user, {
      domains: form.getAll("domain").map(String),
      failures: form.getAll("failure").map(String),
      license: String(form.get("license") ?? "research") as LicenseScope,
      contentNeeded: form.get("content") === "1",
      maxPriceCents: Math.round(Number(form.get("maxPrice") || 0) * 100) || undefined,
    });
  } catch (err) {
    if (err instanceof PreferencesError)
      redirect(`/welcome?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect("/welcome?done=1");
}
