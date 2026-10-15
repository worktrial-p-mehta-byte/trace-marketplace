# Demo script (about 4 minutes)

> All steps work as of M6. Filled in fully in M7.
>
> Before the demo: `pnpm demo:reset` (a fresh seeded market), then `pnpm dev`.

1. **Land and sign up.** Create an account and accept the data terms.
2. **Connect sessions.** Pick your Claude Code session files. The browser parses
   and scrubs them locally; nothing is uploaded yet.
3. **Review.** Before/after view with redactions highlighted, suggested tier,
   auto-labels, and an estimated price with its breakdown.
4. **Share.** Approve sessions. Only scrubbed versions upload, each with a consent record.
5. **Browse.** Catalog with prices, filters and search.
6. **View a trace.** Timeline of messages and tool calls, labels, and "why this price".
7. **Move the market.** Open **Market simulator** and pick "Rust + user corrected
   it" (one trace, rare). Post a bounty: its price rises. Add 25 sessions: it
   falls by about half. Reset: back where it started. Open the trace to see
   the full price history chart.
8. **Revoke.** Withdraw a trace; it leaves the catalog and the consent ledger records it.
