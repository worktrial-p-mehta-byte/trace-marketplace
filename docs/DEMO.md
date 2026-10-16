# Demo script (about 6 minutes)

The story: a domain expert shares agent sessions without leaking anything;
the marketplace knows what each one is about, whether it's authentic, and
what it is worth; a lab finds exactly what it needs by describing it, buys
it, and leaves a standing bid that buys the next one the moment it's
shared; and sellers see what buyers want.

## Before the demo (5 minutes)

```bash
pnpm demo:reset          # fresh database: 200-trace market, an open campaign, a few past sales
pnpm demo:sessions       # writes the thirteen seller sessions to demo/seller-sessions/
pnpm build && pnpm start # production mode: every page is fast on first click
```

- **Two browser windows.** One normal window for the seller (you will sign
  up live) and one private window signed in as the buyer
  (`buyer@example.com` / `demo-password`).
- In a third tab, optionally sign in as the demo seller
  (`seller@example.com` / `demo-password`): it follows Medical and Data and
  querying, so it is told about campaigns there.
- Close other tabs; zoom to 110% for a projector.
- **Audience following along?** Send them [FOLLOW-ALONG.md](FOLLOW-ALONG.md)
  ten minutes before: one line sets up their own copy (`scripts/try-it.sh`).

What the seed sets up: the buyer team has its demo credits, three past
purchases, and an open campaign, **"Clinical evaluations with corrections"**
(up to $25 each, 6 wanted, 2 bought from the seeded market).

Every step below also runs as an automated test (`pnpm build && pnpm e2e`;
specs in [`e2e/`](../e2e)), in CI on every pull request.

## Script

| Time | Beat                    | What to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | What to say                                                                                                                                                                                                   |
| ---- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | **Land**                | Open `http://localhost:3000`. Point at **Browse by domain**.                                                                                                                                                                                                                                                                                                                                                                                                                      | "Agents log every session, and not only for code: clinical evaluations, SQL, research, support. Labs want the rare ones from every domain."                                                                   |
| 0:20 | **1. Share**            | **Create account** (seller) → accept the terms → **Choose files** → pick `10-domain-medical`, `11-domain-data`, `12-authenticity-suspect` and `09-everything` from `demo/seller-sessions/`.                                                                                                                                                                                                                                                                                       | "Parsing, scrubbing and labelling happen here in the browser. Nothing is uploaded yet."                                                                                                                       |
| 0:50 | **Review**              | Click `10`: **Domain: Medical and clinical evaluation (92% sure)**, **Authenticity: Consistent**, the estimate with its **likely range**, and the reasons: rarity for a scarce domain (counted for less while it is the seller's own claim, signals only) and demand 2× from the open campaign. Click `12`: **Authenticity: Flagged** ("1 tool result has no call", "every step is the same length apart"), priced 0.7×. Toggle `09` to **Open source** and watch the price rise. | "It knows what the session was about, checks the log is genuine, and prices it: a clinical evaluation is scarce here, so it's worth more than a common coding fix. A spliced log is flagged and priced down." |
| 1:40 | **Share**               | **Share 4 sessions**.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `10` shows **Bought by 1 campaign already**: "A lab had a standing bid for exactly this. It sold the moment it was listed."                                                                                   |
| 2:00 | **2. Discover**         | Buyer window → **Browse traces** → type `medical evaluations where the agent was corrected and recovered` → **Search**.                                                                                                                                                                                                                                                                                                                                                           | "Buyers describe what they need. It's read into filters, shown as chips they can remove, and every result says why it matched, with the events that prove it."                                                |
| 2:40 | **Inspect**             | Open a result: **What it was about**, **Authenticity** (each check), **What happened** (labels link to events), **Why this price** (domain niche, likely range). Switch the licence. Optionally **Explain each line**: every line's notes, and clicking **Test tampering** or **Failure** highlights the lines behind it.                                                                                                                                                         | "The price explains itself: failure evidence, domain rarity and niche, demand, near-duplicates, authenticity, freshness."                                                                                     |
| 3:20 | **3. Buy**              | **Buy evaluation** → checkout (price held for 15 minutes) → **Pay with credits** → receipt → **Download**.                                                                                                                                                                                                                                                                                                                                                                        | "Local checkout: demo credits are the only simulated step. One balanced ledger posting pays the seller 70% and the platform its fee; the licence unlocks the download."                                       |
| 3:50 | **4. Campaign**         | **Campaigns**: "Clinical evaluations with corrections" now shows **3 of 6 bought**, including the session shared a minute ago.                                                                                                                                                                                                                                                                                                                                                    | "A standing bid with escrow. It buys every matching trace at its list price, now and as supply arrives, and refunds the rest when it ends."                                                                   |
| 4:20 | **5. What buyers want** | Seller window → **Trends**: the most wanted segments, the domain table (demand vs supply, typical price, campaigns), **Follow** a domain.                                                                                                                                                                                                                                                                                                                                         | "Sellers see where demand outruns supply, so domain experts spend their time where it pays, and they hear when a lab starts a campaign in their domain."                                                      |
| 5:00 | **6. Get paid**         | Bell → "Sold: … through the campaign …". **My traces**: licences sold and earnings.                                                                                                                                                                                                                                                                                                                                                                                               | "Every sale is a notification and a ledger entry. Sellers can withdraw a session at any time."                                                                                                                |
| 5:30 | **Market (optional)**   | **Market simulator** → shortcut _Medical and clinical evaluation + user corrected it_ → **Post bounty** → **Add sessions** → **Reset simulator**.                                                                                                                                                                                                                                                                                                                                 | "Demand pushes prices up, supply brings them down, and V2 prices by domain, so the move is concentrated where the market is thin."                                                                            |
| 6:00 | **Close**               | Landing page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | "Runs locally with no network calls; production swaps in Postgres, S3, a queue and Stripe behind the same interfaces."                                                                                        |

## Showing the pricing engine in depth

`pnpm pricing:shadow` prints v1 and V2 prices by domain on the live
database and both policies through the wind tunnel (a modelled buyer
population). The thirteen seller sessions and a pricing walkthrough are in
[demo/seller-sessions](../demo/seller-sessions/README.md). A new buyer
account goes through the four onboarding questions and gets a **Picked for
you** row.

## If something goes wrong

| Problem                                          | Fix                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| "didn't contain a Claude Code session"           | The file isn't a Claude Code `.jsonl`. Use the files from `pnpm demo:sessions`.                                          |
| "You have already shared this session"           | It was shared earlier in this database. Run `pnpm demo:sessions` again for fresh ids, or `pnpm demo:reset`.              |
| Session 10 isn't bought by the campaign          | The campaign filled or ended (it wants 6). `pnpm demo:reset` restores it.                                                |
| A market action shows "No matching prices moved" | Pick a domain or language with traces (the shortcuts always have some).                                                  |
| Prices differ from this script                   | Prices depend on time since seeding and on demand; the direction of each move is what matters.                           |
| Sign-in doesn't stick in production mode         | Use `http://localhost:3000`, not an IP address (cookies are HTTPS-only in production; see [DEPLOYING.md](DEPLOYING.md)). |

## After the demo

`pnpm demo:reset` puts everything back: accounts, shares, orders, campaigns.
