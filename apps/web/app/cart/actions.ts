"use server";

import { redirect } from "next/navigation";
import {
  addDemoCredits,
  addToCart,
  CheckoutError,
  placeOrder,
  quoteCart,
  removeFromCart,
} from "@tm/core";
import type { LicenseScope } from "@tm/schema";
import { getBus, getConfig, getCurrentUser, getDb } from "@/lib/server";

const deps = () => ({ config: getConfig(), bus: getBus() });
const LICENSES = ["research", "eval", "training"];

async function buyer() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.buyerOrgId)
    redirect("/cart?error=" + encodeURIComponent("Only buyer accounts can buy."));
  return user;
}

const fail = (path: string, err: unknown): never => {
  if (err instanceof CheckoutError)
    redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message)}`);
  throw err;
};

function licenseOf(form: FormData): LicenseScope {
  const l = String(form.get("license") ?? "research");
  return (LICENSES.includes(l) ? l : "research") as LicenseScope;
}

export async function addToCartAction(form: FormData) {
  const user = await buyer();
  const listingId = String(form.get("listingId") ?? "");
  try {
    addToCart(getDb(), user, listingId);
  } catch (err) {
    fail(`/traces/${listingId}`, err);
  }
  redirect(`/traces/${listingId}?added=1`);
}

/** Buy one trace now: quote just this listing under the chosen licence. */
export async function buyNowAction(form: FormData) {
  const user = await buyer();
  const listingId = String(form.get("listingId") ?? "");
  let quoteId = "";
  try {
    quoteId = quoteCart(getDb(), deps(), user, licenseOf(form), [listingId]).id;
  } catch (err) {
    fail(`/traces/${listingId}`, err);
  }
  redirect(`/checkout/${quoteId}`);
}

export async function removeFromCartAction(form: FormData) {
  const user = await buyer();
  removeFromCart(getDb(), user, String(form.get("listingId") ?? ""));
  redirect(`/cart?license=${licenseOf(form)}`);
}

export async function reviewCartAction(form: FormData) {
  const user = await buyer();
  let quoteId = "";
  try {
    quoteId = quoteCart(getDb(), deps(), user, licenseOf(form)).id;
  } catch (err) {
    fail(`/cart?license=${licenseOf(form)}`, err);
  }
  redirect(`/checkout/${quoteId}`);
}

export async function payAction(form: FormData) {
  const user = await buyer();
  const quoteId = String(form.get("quoteId") ?? "");
  let orderId = "";
  try {
    orderId = placeOrder(getDb(), deps(), user, quoteId).orderId;
  } catch (err) {
    fail(`/checkout/${quoteId}`, err);
  }
  redirect(`/orders/${orderId}?paid=1`);
}

export async function topUpAction(form: FormData) {
  const user = await buyer();
  addDemoCredits(getDb(), getConfig(), user);
  const back = String(form.get("back") ?? "/cart");
  redirect(back.startsWith("/") ? back : "/cart");
}
