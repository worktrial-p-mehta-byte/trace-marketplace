import { expect, test } from "@playwright/test";

/** The landing page prices real listings from several domains with the live model. */
test("landing page shows live prices from different domains", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#pricing");
  await expect(section.getByRole("heading", { name: "What a trace is worth" })).toBeVisible();
  const cards = section.getByRole("listitem").filter({ has: page.locator(".price") });
  expect(await cards.count()).toBeGreaterThanOrEqual(4);
  // The domains asked for first lead, each card names its own domain.
  await expect(cards.nth(0)).toContainText("Software engineering");
  const domains = await cards.evaluateAll((els) =>
    els.map((el) => el.querySelector("p")?.textContent ?? ""),
  );
  expect(new Set(domains).size).toBe(domains.length);
  // Old hard-coded figures are gone; each card explains its price.
  await expect(page.getByText("$22.72")).toHaveCount(0);
  await expect(cards.first().getByText("×").first()).toBeVisible();
  // A card opens that listing.
  await cards.first().getByRole("link").click();
  await expect(page).toHaveURL(/\/traces\/lst_/);
});
