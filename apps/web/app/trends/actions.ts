"use server";

import { redirect } from "next/navigation";
import { setInterest } from "@tm/core";
import { getCurrentUser, getDb } from "@/lib/server";

export async function followDomainAction(form: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  setInterest(getDb(), user.id, String(form.get("domain") ?? ""), form.get("on") === "1");
  redirect("/trends#domains");
}
