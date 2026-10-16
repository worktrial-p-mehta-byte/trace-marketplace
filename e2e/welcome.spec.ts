import { expect, test } from "@playwright/test";

/** A new buyer answers four questions and gets picks, a matching catalog row and a campaign idea. */
test("a new buyer says what they need and gets traces picked for them", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Lab Buyer");
  await page.getByLabel("Email").fill(`lab-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct horse");
  await page.getByRole("radio", { name: /Buy traces/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept and continue" }).click();

  await expect(page).toHaveURL(/\/welcome/);
  await page.getByLabel("Data and querying").check();
  await page.getByLabel(/Retry loop/).check();
  await page.getByRole("radio", { name: /Evaluate models/ }).check();
  await page.getByLabel("Typical budget per trace ($, optional)").fill("12");
  await page.getByRole("button", { name: "Show me traces" }).click();

  await expect(page.getByRole("heading", { name: "Picked for you" })).toBeVisible();
  const picks = page.getByRole("list", { name: "Picked for you" });
  await expect(picks.locator("li").first()).toContainText("Data and querying");
  await expect(page.getByRole("link", { name: "Set up a campaign" })).toHaveAttribute(
    "href",
    /describe=data%20querying%20retry%20loop&maxPrice=12.00&license=eval/,
  );

  // The catalog keeps the picks at the top, and prices open on the stated licence.
  await page.goto("/traces");
  const row = page.getByRole("region", { name: "Picked for you" });
  await expect(row.locator("a").first()).toBeVisible();
  await row.locator("a[href^='/traces/']").first().click();
  const card = page.getByRole("region", { name: "Price" });
  await expect(card.getByRole("radio", { name: "Evaluation" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // Adding to the cart keeps the licence the buyer was looking at.
  await card.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("status").getByRole("link", { name: "cart" }).click();
  await expect(page.getByRole("button", { name: /Evaluation/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
