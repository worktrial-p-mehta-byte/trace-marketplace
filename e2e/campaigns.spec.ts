import { expect, test, type Page } from "@playwright/test";

/** A buyer starts a campaign; it buys matching traces straight away. */
const BUYER = { email: "buyer@example.com", password: "demo-password" };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("a buyer's campaign buys matching traces at list price and holds the rest in escrow", async ({
  page,
}) => {
  await signIn(page, BUYER);
  await page.goto("/campaigns");
  const form = page.getByRole("form", { name: "New campaign" });
  await form.getByLabel("What should it buy?").fill("data warehouse sessions");
  await form.getByLabel("Max per trace ($)").fill("40");
  await form.getByLabel("How many").fill("3");
  await form.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("status")).toContainText("Campaign started");
  const card = page.locator("li", { hasText: "data querying" }).first();
  await expect(card).toContainText("3 of 3 bought");
  await expect(card).toContainText("filled");
  await expect(card.getByRole("link", { name: "Download" }).first()).toBeVisible();
});
