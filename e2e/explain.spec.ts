import { expect, test } from "@playwright/test";

/** Any visitor can see, line by line, why a listing has its labels and price. */
test("explains a listing line by line, linking labels and price to their lines", async ({
  page,
}) => {
  await page.goto("/traces?failure=test_tampering");
  await page.locator('a[href^="/traces/lst_"]').first().click();
  await page.getByRole("link", { name: /Explain each line/ }).click();
  await expect(page.getByRole("heading", { name: "How this session was read" })).toBeVisible();

  // Every line is described; the tampering line carries its note.
  const lines = page.getByRole("list", { name: "The session, line by line" });
  await expect(lines.getByText(/Counts as a turn/).first()).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: /^Notes on line/ })
      .filter({ hasText: "Test tampering" })
      .first(),
  ).toBeVisible();

  // Picking a label shows how many lines are behind it and marks them.
  await page.getByRole("button", { name: /^Test tampering/ }).click();
  await expect(page.getByRole("status")).toContainText(/Test tampering: \d+ line/);
  // And the price section explains the factors.
  await expect(page.getByRole("region", { name: /^Price: \$/ })).toBeVisible();
  await page
    .getByRole("button", { name: /^Failure/ })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText(/Failure: \d+ lines?/);
});
