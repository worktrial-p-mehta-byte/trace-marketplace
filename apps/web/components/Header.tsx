import Link from "next/link";
import { canSell, cartListingIds, creditBalance, ensureWelcomeCredits } from "@tm/core";
import { money } from "@/lib/labels";
import { getConfig, getCurrentUser, getDb } from "@/lib/server";
import { SignOutButton } from "./SignOutButton";
import { Wordmark } from "./Wordmark";

export async function Header() {
  const user = await getCurrentUser();
  // A buyer team's welcome credits arrive the first time it is seen.
  if (user?.buyerOrgId) ensureWelcomeCredits(getDb(), getConfig(), user.buyerOrgId);
  return (
    <header className="border-b border-rule bg-paper">
      {/* On phones the links wrap onto their own row under the wordmark. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-6">
        <Wordmark />
        <nav className="flex w-full items-center justify-between gap-3 text-sm font-medium whitespace-nowrap text-ink-2 sm:w-auto sm:justify-end sm:gap-5">
          <Link href="/traces" className="hover:text-ink">
            Browse<span className="hidden sm:inline"> traces</span>
          </Link>
          {user ? (
            <>
              {canSell(user) && (
                <>
                  <Link href="/share" className="hover:text-ink">
                    Share<span className="hidden sm:inline"> sessions</span>
                  </Link>
                  <Link href="/me/traces" className="hover:text-ink">
                    My traces
                  </Link>
                </>
              )}
              {user.buyerOrgId && (
                <>
                  <Link href="/campaigns" className="hover:text-ink">
                    Campaigns
                  </Link>
                  <Link href="/cart" className="hover:text-ink">
                    Cart ({cartListingIds(getDb(), user.buyerOrgId).length})
                  </Link>
                  <Link
                    href="/orders"
                    className="hidden hover:text-ink sm:inline"
                    title="Your orders and credits"
                  >
                    {money(creditBalance(getDb(), user.buyerOrgId))}
                  </Link>
                </>
              )}
              <Link href="/market" className="hover:text-ink">
                Market<span className="hidden lg:inline"> simulator</span>
              </Link>
              <span className="hidden text-ink-3 sm:inline">{user.email}</span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-ink">
                Sign in
              </Link>
              <Link href="/signup" className="btn !py-2 text-sm">
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
