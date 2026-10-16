import Link from "next/link";
import { canSell } from "@tm/core";
import { getCurrentUser } from "@/lib/server";
import { SignOutButton } from "./SignOutButton";
import { Wordmark } from "./Wordmark";

export async function Header() {
  const user = await getCurrentUser();
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
