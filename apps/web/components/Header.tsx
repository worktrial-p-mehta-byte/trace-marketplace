import Link from "next/link";
import { getCurrentUser } from "@/lib/server";
import { SignOutButton } from "./SignOutButton";
import { Wordmark } from "./Wordmark";

export async function Header() {
  const user = await getCurrentUser();
  return (
    <header className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Wordmark />
        <nav className="flex items-center gap-3 text-sm font-medium whitespace-nowrap text-ink-2 sm:gap-5">
          <Link href="/traces" className="hover:text-ink">
            Browse<span className="hidden sm:inline"> traces</span>
          </Link>
          {user ? (
            <>
              <Link href="/share" className="hover:text-ink">
                Share<span className="hidden sm:inline"> sessions</span>
              </Link>
              <Link href="/me/traces" className="hover:text-ink">
                My traces
              </Link>
              <Link href="/market" className="hidden hover:text-ink md:inline">
                Market simulator
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
