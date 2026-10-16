# Seller demo sessions

Fourteen synthetic Claude Code sessions, each built to show off one dimension of
the pricing engine or the marketplace when you share it from **Share sessions**. They are in
Claude Code's own `.jsonl` format, so they go through the real parser,
scrubber and labeler, exactly like a seller's own sessions.

```bash
pnpm demo:reset       # a fresh seeded market to price against
pnpm demo:sessions    # writes the .jsonl files here and prints each one's estimate
```

The files are generated, not committed: their timestamps are relative to now
(freshness is a pricing factor), and the leaky session contains fake
credentials. All content is invented.

## The price formula, in one line

**price = base × quality × richness × failure × rarity × niche × demand × near-duplicates × freshness × license**, pulled up towards any open bounty's offer

Base is $2.00 for open source and $0.25 for signals only. This is Pricing V2;
see [docs/PRICING.md](../../docs/PRICING.md) for every weight, and
`pnpm pricing:shadow` to compare it with v1 on the current market.

## What each session shows

Approximate open-source prices against a fresh `pnpm demo:reset` market.

| File                      | Dimension                  | What to point at                                                                                                                                                                                               | Factor                                               | Price               |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------- |
| `01-everyday-baseline`    | Baseline                   | Short, clean TypeScript/React work. Coding is the most crowded domain, so rarity pulls it down                                                                                                                 | Rarity 0.68×                                         | ~$1.80              |
| `02-failure-recovered`    | Failure (verified)         | A retry loop the agent got past, and the tests pass afterwards: a recovery the session proves                                                                                                                  | Failure 1.9×                                         | ~$4.73              |
| `03-preference-pairs`     | Failure + preference pairs | The agent tries to weaken the test twice (rejected) and is corrected twice. Each "no, do this instead" is a preference pair                                                                                    | Failure 2.2×                                         | ~$6.72              |
| `04a-rarity-common`       | Rarity within a domain     | A date-picker bug in TypeScript/React                                                                                                                                                                          | Rarity 0.73×                                         | ~$3.91              |
| `04b-rarity-rare`         | Rarity within a domain     | The same story in Verilog: a rarer stack adds a little. Domain matters far more: compare `10`                                                                                                                  | Rarity 0.77×                                         | ~$4.09              |
| `05-richness-marathon`    | Richness                   | 100+ turns moving 22 Go handlers onto new middleware, no failures                                                                                                                                              | Richness 2.0× (maximum)                              | ~$3.40              |
| `06-freshness-old-model`  | Freshness                  | Session 02's story, but 11 months old and on a superseded model                                                                                                                                                | Freshness 0.28×                                      | ~$1.62              |
| `07-quality-leaky`        | Quality                    | Keys, emails, IPs and a home path everywhere (watch the black bars), plus a log too long to keep whole                                                                                                         | Quality 0.5× ("76% redacted, some output truncated") | ~$3.22              |
| `08-demand-bounty`        | Demand and bounty          | A Rust retry loop. Post a bounty for it (below): demand doubles and the bounty's $20 offer pulls the price up to $12                                                                                           | Demand 1.0× → 2.0×, bounty 1.24×                     | ~$4.83 → ~$12.00    |
| `09-everything`           | Everything at once         | Rare stack (Haskell), test tampering caught, five corrections, recovered, 90+ turns, fresh                                                                                                                     | Failure 2.2×, richness 2.0×                          | ~$8.90              |
| `10-domain-medical`       | Domain rarity and niche    | Grading a triage model's chest pain answers against a clinical rubric: no code. Five medical listings in the whole market                                                                                      | Rarity 2.5× (maximum)                                | ~$17.69             |
| `11-domain-data`          | Domain                     | A dbt revenue model with an inner join that drops guest orders, fixed and checked against the warehouse                                                                                                        | Rarity 1.16×                                         | ~$5.51              |
| `12-authenticity-suspect` | Authenticity               | A log that was put together, not recorded: every step exactly 30 s apart and a tool result with no call. Flagged                                                                                               | Authenticity 0.7×                                    | ~$0.99 signals only |
| `13-pii-redaction`        | Privacy                    | A support refund full of a customer's data: email, phone, card, a public IP, a home path and internal hosts, every one blacked out. Her name stays until you add `Maya Okafor` under **Also hide these words** | Quality, rarity (support)                            | ~$13                |

Every estimate also shows a **likely range** (the price band): narrow when
the policy is sure, wider for an unclear domain, a thin cohort or a
signals-only upload.

Sessions start as **Open source** on the review screen: buyers get the
scrubbed content, so it is worth about 8× more, and you see every black bar
the scrubber drew. For private work, switch a session (or all of them, with
**Share all as Signals only**) to **Signals only**: the preview then shows
what a signals-only buyer gets, counts, the tools used and the session as a
row of steps with failures in red, but no text.

## A five-minute pricing walkthrough

1. **Load them all.** Sign up as a seller, open **Share sessions**, choose
   all fourteen files. Each one shows its estimate in the list on the left.
2. **Read a breakdown.** Click `09-everything` ("Fix the pricing engine's
   rounding…"). Each factor has a plain reason: "agent tampered with a
   failing test, then recovered; 5 preference pairs", "92 turns, 51 tool
   calls", "outcome checked by tests".
3. **Tier.** Toggle **Signals only** / **Open source** on any session. The
   base price moves from $0.25 to $2.00.
4. **Rarity.** Compare `04a` (date picker, TypeScript/React) with `04b`
   (UART receiver, Verilog): within one domain, a rarer stack adds a little.
   Then open `10`: a clinical evaluation, one of five medical sessions in the
   market, is the most valuable session here at the rarity maximum.
5. **Freshness.** Compare `02` with `06`: the same story. 06 is 330 days old
   on `claude-3-5-sonnet-20241022`, so its price is about a quarter of 02's.
6. **Quality.** Open `07`. The scrubber removed 800 items, and the estimate
   says why the price dropped.
7. **Demand, live.** Select `08` ("Stop the job queue retrying forever") and
   note its price. In another tab, sign in as `buyer@example.com`, open
   **Market** → language _Rust_, failure _Retry loop_ → **Post bounty**.
   Back on the share tab, toggle `08`'s tier off and on to re-estimate:
   demand goes from 1.0× to 2.0×, and the bounty's $20 offer pulls the price up to $12.
8. **License.** Share `09` as open source (tick the two boxes), then open it
   from **Browse traces**. The price card's Research / Evaluation / Training
   switch applies the license multiplier (1×, 1.5×, 2×).
9. **Authenticity.** `12` is flagged on the review screen ("1 tool result
   has no call"; "every step is the same length apart") and priced 0.7×.
   After sharing, **Browse traces** → Authenticity → _Flagged_ finds it, and
   its page lists each check.
10. **Domains.** Open `10` and `11`: the review screen says what each
    session was about (medical, 92% sure; data and querying, 88%). After
    sharing, **Browse traces** → Domain filters to them, and the landing
    page's _Browse by domain_ row links straight there.

## Notes

- **Rarity is measured domain first.** V2 fixed v1's problem in the seeded
  market (most exact combinations appear once, so v1 rarity could only
  lower prices): cohorts are domain → failure → stack, compared with the
  typical cohort size at each level, so a scarce domain reaches the 2.5×
  maximum and crowded coding sits below 1×.
- **The price cap and limits** (12× combined multiplier, $0.10–$50) aren't
  reached by these sessions. The highest, `09` with a bounty for Haskell,
  stays under them.
- Prices drift a little with time since seeding (freshness, demand window).
  Run `pnpm demo:sessions` again to see current estimates.
