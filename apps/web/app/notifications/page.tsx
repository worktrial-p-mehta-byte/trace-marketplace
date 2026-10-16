import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listNotifications } from "@tm/core";
import { getCurrentUser, getDb } from "@/lib/server";
import { markAllReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = listNotifications(getDb(), user.id);
  const unread = items.some((n) => !n.readAt);
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
        {unread && (
          <form action={markAllReadAction}>
            <button className="btn-quiet text-sm">Mark all read</button>
          </form>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-6 text-ink-2">
          Nothing yet. Sales and new campaigns in the domains you{" "}
          <Link href="/trends" className="text-cobalt">
            follow
          </Link>{" "}
          show up here.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-rule border-y border-rule" aria-label="Notifications">
          {items.map((n) => (
            <li key={n.id} className={`py-3 ${n.readAt ? "" : "font-semibold"}`}>
              {n.href ? (
                <Link href={n.href} className="hover:text-cobalt">
                  {n.title}
                </Link>
              ) : (
                n.title
              )}
              <p className="mt-0.5 text-sm font-normal text-ink-2">{n.body}</p>
              <p className="mt-0.5 text-xs font-normal text-ink-3">
                {n.createdAt.toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
