import { expect, test, type Page } from "@playwright/test";

/** Each role lands where its recommendations are, and each says why. */
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("the demo buyer lands on traces picked from what its team did", async ({ page }) => {
  await signIn(page, "buyer@example.com");
  await expect(page).toHaveURL(/\/traces$/);
  const picks = page.getByRole("region", { name: "Picked for you" });
  await expect(picks.locator("li").first()).toBeVisible();
  await expect(picks.locator("li").first()).toContainText(/your team (bought|viewed|searched)/);
  await expect(picks).not.toContainText("with user corrected it");
});

test("the demo seller sees what buyers want from it where it shares", async ({ page }) => {
  await signIn(page, "seller@example.com");
  await expect(page).toHaveURL(/\/share$/);
  const box = page.getByRole("region", { name: "What buyers want from you" });
  await expect(box.getByRole("listitem").first()).toContainText(/sessions/);
  await expect(box.getByRole("listitem").first()).toContainText(/^.+(You share|You follow)/);
  await page.goto("/me/traces");
  await expect(page.getByRole("region", { name: "What buyers want from you" })).toBeVisible();
});
