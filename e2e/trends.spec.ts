import { expect, test, type Page } from "@playwright/test";

/** A seller sees what buyers want, follows a domain, and hears about a new campaign in it. */
const SELLER = { email: "seller@example.com", password: "demo-password" };
const BUYER = { email: "buyer@example.com", password: "demo-password" };

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("a seller follows a domain and is told when a buyer starts a campaign in it", async ({
  page,
}) => {
  await signIn(page, SELLER);
  await page.goto("/trends");
  await expect(page.getByRole("heading", { name: "What buyers want" })).toBeVisible();
  const table = page.locator("#domains table");
  await expect(table).toContainText("Legal and compliance");
  await page
    .getByRole("button", { name: "Notify me about Legal and compliance campaigns" })
    .click();
  await expect(
    page.getByRole("button", { name: "Notify me about Legal and compliance campaigns" }),
  ).toHaveAttribute("aria-pressed", "true");

  await signIn(page, BUYER);
  await page.goto("/campaigns");
  const form = page.getByRole("form", { name: "New campaign" });
  await form.getByLabel("What should it buy?").fill("contract review");
  await form.getByLabel("Max per trace ($)").fill("0.10");
  await form.getByLabel("How many").fill("2");
  await form.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("status")).toContainText("Campaign started");

  await signIn(page, SELLER);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Notifications, \d+ unread/ })).toBeVisible();
  await page.getByRole("link", { name: /Notifications/ }).click();
  await expect(page.getByRole("list", { name: "Notifications" })).toContainText(
    "A buyer wants Legal and compliance traces",
  );
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByRole("link", { name: "Notifications" })).toBeVisible();
});
