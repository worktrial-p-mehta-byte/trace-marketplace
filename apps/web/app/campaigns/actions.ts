"use server";

import { redirect } from "next/navigation";
import { CampaignError, cancelCampaign, createCampaign } from "@tm/core";
import type { LicenseScope } from "@tm/schema";
import { getBus, getConfig, getCurrentUser, getDb } from "@/lib/server";

const deps = () => ({ config: getConfig(), bus: getBus() });

export async function createCampaignAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const get = (k: string) => String(form.get(k) ?? "");
  const license = (
    ["research", "eval", "training"].includes(get("license")) ? get("license") : "research"
  ) as LicenseScope;
  let id = "";
  let filled = 0;
  try {
    const r = createCampaign(getDb(), deps(), user, {
      title: get("title") || undefined,
      describe: get("describe"),
      criteria: { domain: get("domain") || undefined, failure: get("failure") || undefined },
      license,
      maxPriceCents: Math.round(Number(get("maxPrice")) * 100),
      quantity: Number(get("quantity")),
      days: Number(get("days")),
    });
    id = r.campaign.id;
    filled = r.filled;
  } catch (err) {
    if (err instanceof CampaignError)
      redirect(
        `/campaigns?error=${encodeURIComponent(err.message)}&describe=${encodeURIComponent(get("describe"))}`,
      );
    throw err;
  }
  redirect(`/campaigns?created=${id}&filled=${filled}`);
}

export async function cancelCampaignAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  try {
    cancelCampaign(getDb(), deps(), user, String(form.get("id") ?? ""));
  } catch (err) {
    if (err instanceof CampaignError)
      redirect(`/campaigns?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect("/campaigns");
}
