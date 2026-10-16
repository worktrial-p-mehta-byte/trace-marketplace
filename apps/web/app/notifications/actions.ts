"use server";

import { redirect } from "next/navigation";
import { markAllRead } from "@tm/core";
import { getCurrentUser, getDb } from "@/lib/server";

export async function markAllReadAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  markAllRead(getDb(), user.id);
  redirect("/notifications");
}
