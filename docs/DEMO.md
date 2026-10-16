# Demo script (about 4 minutes)

The story: a developer shares a real agent session in under a minute without
leaking anything; a buyer finds the rare failure they need; and the market
prices it by what makes it rare.

## Before the demo (5 minutes)

```bash
pnpm demo:reset          # fresh database with the 200-trace synthetic market
pnpm build && pnpm start # production mode: every page is fast on first click
```

- **A session file to share.** Copy a few of your Claude Code sessions
  somewhere visible:
  `mkdir -p ~/Desktop/agent-sessions && cp ~/.claude/projects/*/*.jsonl ~/Desktop/agent-sessions/`.
  A session from the [failure lab](../demo/failure-lab) is best, because it
  shows a real failure. If you have none to hand, use
  [`fixtures/claude-code/synthetic-session.jsonl`](../fixtures/claude-code/synthetic-session.jsonl):
  it is synthetic and shows test tampering, a correction, a rejected action
  and an interrupt. It has nothing secret in it, so to show the scrubber at
  work type a word from it (e.g. `parseDueDate`) under **Also hide these
  words** on the review screen.
- **Two browser windows.** One normal window for the seller (you will sign
  up live) and one private window signed in as the buyer
  (`buyer@example.com` / `demo-password`).
- Close other tabs; zoom the browser to 110% for a projector.

The whole script also runs as an automated test (`pnpm build && pnpm e2e`,
[`e2e/demo.spec.ts`](../e2e/demo.spec.ts)), in CI on every pull request, so
the steps below stay true.

To show the pricing engine in depth, use the twelve seller sessions from
`pnpm demo:sessions`; [demo/seller-sessions](../demo/seller-sessions/README.md)
has a five-minute pricing walkthrough.

## Script

| Time | Step                  | What to do                                                                                                                                                                                           | What to say                                                                                                                                                     |
| ---- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | **Land**              | Open `http://localhost:3000`                                                                                                                                                                         | "Agents already log every session. The rare ones, where the agent got stuck or cheated, are exactly what labs want to train and evaluate on."                   |
| 0:20 | **Sign up**           | **Create account** → any email and password → **Accept and continue** on the data terms                                                                                                              | "Consent comes first, and it's recorded, per session."                                                                                                          |
| 0:40 | **Pick sessions**     | You land on **Share sessions** → **Choose files** → pick your session file(s)                                                                                                                        | "Parsing and scrubbing happen here, in the browser. Nothing has been uploaded yet."                                                                             |
| 1:00 | **Review**            | Point at **What will be shared** (the black bars are removals), the detected failure, and **Estimated price** with its reasons. Toggle **Open source** / **Signals only** and watch the price change | "Every redaction is marked with what was removed. Signals only shares the structure without any content, for work you can't open."                              |
| 1:30 | **Share**             | Tick the consent box (and **I set this session up on purpose…** for a failure-lab session) → **Share 1 session**                                                                                     | "Only the scrubbed version is uploaded. The server scrubs it again rather than trusting the browser."                                                           |
| 1:50 | **Browse as a buyer** | Private window → **Browse traces** → filter **What went wrong** → _Test tampering_; then search `retry`                                                                                              | "Buyers filter by failure, outcome, stack and model, and by whether a trace is real, staged or synthetic."                                                      |
| 2:20 | **Open a trace**      | Click a result → click a failure label to jump to the event → **Why this price** → switch the license                                                                                                | "Each label links to the exact events. The price explains itself: rarity, failure value, richness, freshness, demand."                                          |
| 2:50 | **Move the market**   | **Market simulator** → shortcut _Rust + user rejected an action_ (or _Medical and clinical evaluation + user corrected it_) → **Post bounty** → **Add sessions** → **Reset simulator**               | "Two traces of this kind exist. A bounty pushes its price up about 20%. Twenty-five more like it and it's no longer rare: down about half. Reset puts it back." |
| 3:30 | **Withdraw**          | Seller window → **My traces** → **Withdraw** on the shared session                                                                                                                                   | "Sellers can stop selling at any time. The listing leaves the catalog and the consent record keeps the date."                                                   |
| 3:50 | **Close**             | Back to the landing page                                                                                                                                                                             | "One repo, runs locally with no cloud accounts; production swaps in Postgres, S3, a queue and Stripe behind the same interfaces."                               |

## If something goes wrong

| Problem                                          | Fix                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| "didn't contain a Claude Code session"           | The file isn't a Claude Code `.jsonl` (or is empty). Use the fixture file above.                                              |
| "You have already shared this session"           | It was shared earlier in this database. Pick another file, or withdraw it in **My traces** first.                             |
| A market action shows "No matching prices moved" | Pick a language or failure that has traces (the shortcuts always do).                                                         |
| Prices look different from this script           | Prices depend on the time since seeding; the direction of each move is what matters. Run `pnpm demo:reset` for a fresh start. |
| Sign-in doesn't stick in production mode         | Use `http://localhost:3000`, not an IP address (cookies are HTTPS-only in production; see [DEPLOYING.md](DEPLOYING.md)).      |

## After the demo

`pnpm demo:reset` puts everything back, including your new account and the
shared session.
