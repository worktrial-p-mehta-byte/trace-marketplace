import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_SESSIONS_DIR } from "../playwright.config";

/**
 * The seller demo walkthrough (demo/seller-sessions/README.md): load all ten
 * demo sessions at once and share them as signals only, the default. Then the
 * owner's view of a signals-only listing, which must match the buyer's.
 */

const SELLER = {
  name: "Signals Seller",
  email: `signals-${Date.now()}@example.com`,
  password: "correct horse",
};
const BUYER = { email: "buyer@example.com", password: "demo-password" };
/** Listed when the test runs: the web server generates them, after test collection. */
const sessionFiles = () =>
  readdirSync(E2E_SESSIONS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => join(E2E_SESSIONS_DIR, f));

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe.serial("signals-only sharing", () => {
  let listingUrl = "";

  test("a seller shares all ten demo sessions at once as signals only", async ({ page }) => {
    const sessions = sessionFiles();
    expect(sessions).toHaveLength(10);
    await page.goto("/signup");
    await page.getByLabel("Name", { exact: true }).fill(SELLER.name);
    await page.getByLabel("Email").fill(SELLER.email);
    await page.getByLabel("Password").fill(SELLER.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
    await expect(page).toHaveURL(/\/share/);

    await page.locator('input[accept=".jsonl"]').setInputFiles(sessions);
    // 04a and 04b are the same story in two languages: with the text stripped
    // they look identical, and one used to be refused as a duplicate.
    const share = page.getByRole("button", { name: "Share 10 sessions" });
    await expect(share).toBeEnabled();
    await share.click();
    await expect(page.getByRole("heading", { name: "10 sessions shared" })).toBeVisible();
    await expect(page.getByText("Not shared")).toHaveCount(0);

    await page.goto("/me/traces");
    await expect(page.getByText("On sale", { exact: true })).toHaveCount(10);
    await expect(page.getByRole("cell", { name: "Signals only" })).toHaveCount(10);
  });

  test("the owner of a signals-only listing sees what buyers see", async ({ page }) => {
    await signIn(page, SELLER);
    await page.goto("/me/traces");
    await page.locator("tbody a[href^='/traces/']").first().click();
    await expect(page).toHaveURL(/\/traces\/lst_/);
    listingUrl = page.url();

    await expect(page.getByText("This is your trace")).toBeVisible();
    await expect(page.getByText("You shared this session as signals only")).toBeVisible();
    // The structural view, not the content timeline full of stripped placeholders.
    await expect(page.getByText("The session, step by step")).toBeVisible();
    await expect(page.getByRole("list", { name: "Session steps" })).toBeVisible();
    await expect(page.getByText("[signals only]")).toHaveCount(0);
  });

  test("a buyer sees the same structural view of that listing", async ({ page }) => {
    await signIn(page, BUYER);
    await page.goto(listingUrl);
    await expect(page.getByText("The seller shared this session as signals only")).toBeVisible();
    await expect(page.getByRole("list", { name: "Session steps" })).toBeVisible();
    await expect(page.getByText("[signals only]")).toHaveCount(0);
    await expect(page.getByText("This is your trace")).toHaveCount(0);
  });
});
