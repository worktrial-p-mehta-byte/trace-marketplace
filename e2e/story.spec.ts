import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_SESSIONS_DIR } from "../playwright.config";

/**
 * The demo script (docs/DEMO.md), beat by beat, against a freshly reset
 * market with the seeded open campaign. If this passes, the demo works.
 */
const SELLER = {
  name: "Story Seller",
  email: `story-${Date.now()}@example.com`,
  password: "correct horse",
};
const BUYER = { email: "buyer@example.com", password: "demo-password" };
const session = (f: string) => join(E2E_SESSIONS_DIR, f);

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe.serial("the demo story", () => {
  test("1. a domain expert shares; the medical session sells to a campaign on listing", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Browse by domain" })).toBeVisible();
    await page.goto("/signup");
    await page.getByLabel("Name", { exact: true }).fill(SELLER.name);
    await page.getByLabel("Email").fill(SELLER.email);
    await page.getByLabel("Password").fill(SELLER.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
    await expect(page).toHaveURL(/\/share/);

    await page
      .locator('input[accept=".jsonl"]')
      .setInputFiles([
        session("09-everything.jsonl"),
        session("10-domain-medical.jsonl"),
        session("11-domain-data.jsonl"),
        session("12-authenticity-suspect.jsonl"),
      ]);
    await page.getByRole("button", { name: /Grade the triage model/ }).click();
    await expect(page.getByText(/Domain:\s*Medical and clinical evaluation/)).toBeVisible();
    await expect(page.getByText(/Authenticity:\s*Consistent/)).toBeVisible();
    await expect(page.getByText(/Likely range \$/)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Domain niche" })).toBeVisible();
    await page.getByRole("button", { name: /Fix the CSV export encoding/ }).click();
    await expect(page.getByText(/Authenticity:\s*Flagged/)).toBeVisible();
    await expect(page.getByText("1 tool result has no call").first()).toBeVisible();

    // Open source is the default: confirm the right to share them all at once.
    await page
      .getByRole("button", { name: "They are all open-source work or my own projects" })
      .click();
    await page.getByRole("button", { name: "Share 4 sessions" }).click();
    await expect(page.getByRole("heading", { name: "4 sessions shared" })).toBeVisible();
    await expect(page.getByText(/Bought by 1 campaign already/)).toBeVisible();
  });

  test("2–4. a lab describes what it needs, buys a licence, and its campaign has filled", async ({
    page,
  }) => {
    await signIn(page, BUYER);
    await page.goto("/traces");
    await page
      .getByLabel("Search traces")
      .fill("medical evaluations where the agent was corrected and recovered");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const readAs = page.getByLabel("Read as");
    await expect(readAs).toContainText("Medical and clinical evaluation");
    await expect(readAs).toContainText("User corrected it");
    const first = page.locator("section[aria-label=Results] a[href^='/traces/']").first();
    await expect(first).toContainText("Why it matched");
    await first.click();
    await expect(page.getByRole("heading", { name: "What it was about" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Authenticity checks" })).toBeVisible();

    // Buy something the team doesn't hold yet: the first open-source medical result.
    await page.goto("/traces?domain=medical&tier=0");
    const results = page.locator("section[aria-label=Results] a[href^='/traces/']");
    const n = await results.count();
    let bought = false;
    let listing = "";
    for (let i = 0; i < n && !bought; i++) {
      await page.goto("/traces?domain=medical&tier=0");
      await results.nth(i).click();
      await page.waitForURL(/\/traces\/lst_/);
      listing = page.url();
      const card = page.getByRole("region", { name: "Price" });
      await card.getByRole("radio", { name: "Evaluation" }).click();
      const buy = card.getByRole("button", { name: "Buy evaluation" });
      if (!(await buy.count())) continue;
      await buy.click();
      await page.getByRole("button", { name: /^Pay \$/ }).click();
      await expect(page.getByRole("status")).toContainText("Paid");
      bought = true;
    }
    expect(bought).toBe(true);

    // The licence holder can take the session as a replayable task.
    await page.goto(listing);
    await page
      .getByRole("region", { name: "Price" })
      .getByRole("radio", { name: "Evaluation" })
      .click();
    const taskLink = page.getByRole("link", { name: "Download as a task (JSON)" });
    await expect(taskLink).toBeVisible();
    const res = await page.request.get((await taskLink.getAttribute("href"))!);
    expect(res.ok()).toBe(true);
    const task = await res.json();
    expect(task.format).toBe("trace-task/v1");
    expect(task.prompt.length).toBeGreaterThan(0);
    expect(task.environment.domain).toBe("medical");
    expect(task.provenance.licenses).toContain("eval");
    expect(Array.isArray(task.expected.failureModes)).toBe(true);

    await page.goto("/campaigns");
    const campaign = page.locator("li", { hasText: "Clinical evaluations with corrections" });
    await expect(campaign).toContainText(/[3-6] of 6/);
  });

  test("5–6. the seller sees what buyers want and that the campaign bought their session", async ({
    page,
  }) => {
    await signIn(page, SELLER);
    await page.goto("/trends");
    await expect(page.getByRole("heading", { name: "Most wanted right now" })).toBeVisible();
    await page.getByRole("link", { name: /Notifications, \d+ unread/ }).click();
    const notes = page.getByRole("list", { name: "Notifications" });
    await expect(notes).toContainText(
      "an auction among 2 campaigns (the campaign “Clinical evaluations with corrections”)",
    );
    // Competition paid: the winner paid the runner-up's $30 bid (70% to the seller).
    await expect(notes).toContainText("You earned $21.00");
    await page.goto("/me/traces");
    // The campaign's licence, and the lab's own purchase if it picked this session.
    await expect(page.getByLabel("Earnings")).toContainText(/[12] licences? sold/);
  });
});
