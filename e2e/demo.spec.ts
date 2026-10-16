import { expect, test, type Page } from "@playwright/test";

/**
 * The demo script (docs/DEMO.md) as one story: a seller signs up and shares a
 * session, a buyer finds and inspects it, moves the market, and the seller
 * withdraws it. Runs against the seeded synthetic market.
 */

const FIXTURE = "fixtures/claude-code/synthetic-session.jsonl";
const SELLER = {
  name: "E2E Seller",
  email: `seller-${Date.now()}@example.com`,
  password: "correct horse",
};
const BUYER = { email: "buyer@example.com", password: "demo-password" };

const dollars = (s: string | null) => Number((s ?? "").replace(/[^0-9.]/g, ""));

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe.serial("demo flow", () => {
  let listingUrl = "";

  test("a seller signs up, reviews a session in the browser and shares it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Create account" }).first().click();
    await page.getByLabel("Name", { exact: true }).fill(SELLER.name);
    await page.getByLabel("Email").fill(SELLER.email);
    await page.getByLabel("Password").fill(SELLER.password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
    await expect(page).toHaveURL(/\/share/);

    // Parsing, scrubbing and labelling happen in the browser.
    await page.locator('input[accept=".jsonl"]').setInputFiles(FIXTURE);
    await expect(page.getByText("Estimated price")).toBeVisible();
    await expect(page.getByText("Test tampering").first()).toBeVisible();

    // Signals only (the default) shows the session's shape and no content.
    await expect(page.getByText("The session, step by step")).toBeVisible();
    await expect(page.getByText("Test tampering").first()).toBeVisible();

    // Open source shows the scrubbed content. A word the seller adds is hidden
    // everywhere before anything is sent.
    await page.getByText("Open source", { exact: true }).click();
    await page.getByLabel("Also hide these words").fill("parseDueDate");
    await expect(page.getByText("hidden word").first()).toBeVisible();
    // Gone from the review (the text box value itself is not page text).
    await expect(page.getByText("parseDueDate", { exact: false })).toHaveCount(0);

    await page.getByText("This is open-source work or my own project").click();
    await page.getByText("I set this session up on purpose to show a failure.").click();
    await page.getByRole("button", { name: "Share 1 session" }).click();
    await expect(page.getByText("1 session shared")).toBeVisible();

    await page.getByRole("link", { name: "See my traces" }).click();
    await expect(page.getByText("On sale", { exact: true })).toBeVisible();
  });

  test("a buyer finds the shared trace and sees why it costs what it does", async ({ page }) => {
    await signIn(page, BUYER);
    await page.goto("/traces");
    await page
      .getByRole("complementary", { name: "Filters" })
      .getByRole("link", { name: /Test tampering/ })
      .click();
    await expect(page).toHaveURL(/failure=test_tampering/);
    await page.goto("/traces?failure=test_tampering&source=staged");
    const result = page.locator("section[aria-label=Results] a[href^='/traces/']").first();
    await expect(result).toContainText("Fix UTC date parsing");
    await result.click();
    await expect(page).toHaveURL(/\/traces\/lst_/);
    listingUrl = page.url();

    await expect(
      page.getByRole("heading", { name: "Fix UTC date parsing in todo API" }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Fix UTC date parsing in todo API/);
    // The custom term was removed before upload, so buyers never see it.
    await expect(page.getByText("parseDueDate")).toHaveCount(0);
    // Labels link to the events that triggered them.
    await page.locator("a[href^='#e-']").first().click();
    await expect(page.getByText("Why this price")).toBeVisible();
    // Authenticity tiers 1–2: the checks are listed on the page.
    await expect(page.getByRole("list", { name: "Authenticity checks" })).toBeVisible();
    // Pricing V2: the domain's niche is a factor, and the price comes with a range.
    const card = page.getByRole("region", { name: "Price" });
    await expect(card.getByRole("cell", { name: "Domain niche" })).toBeVisible();
    await expect(card.getByText(/Likely range \$\d+\.\d\d–\$\d+\.\d\d/)).toBeVisible();

    const research = dollars(await page.locator(".price").first().textContent());
    await page.getByRole("radio", { name: "Training" }).click();
    await expect
      .poll(async () => dollars(await page.locator(".price").first().textContent()))
      .toBeGreaterThan(research);
  });

  test("anyone can browse by domain, from the landing page to a filtered catalog", async ({
    page,
  }) => {
    await page.goto("/");
    const row = page.getByRole("region", { name: "Browse by domain" });
    await row.getByRole("link", { name: /Medical and clinical evaluation/ }).click();
    await expect(page).toHaveURL(/domain=medical/);
    const results = page.locator("section[aria-label=Results] a[href^='/traces/']");
    await expect(results.first()).toBeVisible();
    await expect(results.first()).toContainText("Medical and clinical evaluation");
    // The facet is on, and the trace page says what the session was about.
    await expect(
      page
        .getByRole("complementary", { name: "Filters" })
        .getByRole("link", { name: /Medical and clinical evaluation/ }),
    ).toHaveAttribute("aria-current", "true");
    await results.first().click();
    await expect(page.getByRole("heading", { name: "What it was about" })).toBeVisible();
  });

  test("a buyer describes what they need, sees how it was read and why results match", async ({
    page,
  }) => {
    await signIn(page, BUYER);
    await page.goto("/traces");
    await page.getByLabel("Search traces").fill("data warehouse sessions with retry loops");
    await page.getByRole("button", { name: "Search" }).click();
    const readAs = page.getByLabel("Read as");
    await expect(readAs.getByRole("link", { name: /Data and querying/ })).toBeVisible();
    await expect(readAs.getByRole("link", { name: /Retry loop/ })).toBeVisible();
    const first = page.locator("section[aria-label=Results] a[href^='/traces/']").first();
    await expect(first).toContainText("Why it matched");
    await expect(first).toContainText("Domain: Data and querying");
    // Removing a chip takes its words out of the search.
    await readAs.getByRole("link", { name: /Retry loop/ }).click();
    await expect(page.getByLabel("Read as").getByRole("link", { name: /Retry loop/ })).toHaveCount(
      0,
    );
    // Saving the search makes it demand and lists it.
    await page.getByRole("button", { name: "Save this search" }).click();
    await expect(page.getByRole("status")).toContainText("Saved");
    await expect(page.getByRole("navigation", { name: "Saved searches" })).toContainText(
      "warehouse",
    );
  });

  test("anonymous search never matches trace content", async ({ page }) => {
    await page.goto("/traces?q=pytest");
    await expect(page.locator("section[aria-label=Results] p").first()).toContainText("0 traces");
    await expect(page.getByRole("link", { name: "Sign in to search inside traces" })).toBeVisible();
    await signIn(page, BUYER);
    await page.goto("/traces?q=pytest");
    await expect(
      page.locator("section[aria-label=Results] a[href^='/traces/']").first(),
    ).toBeVisible();
  });

  test("a bounty raises a rare trace's price, new supply lowers it, reset restores it", async ({
    page,
  }) => {
    await signIn(page, BUYER);
    await page.goto("/market");
    await page.getByRole("link", { name: "Rust + user rejected an action" }).click();
    const price = async () =>
      dollars(await page.locator("main ul li span.shrink-0").first().textContent());
    const start = await price();
    expect(start).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Post bounty" }).click();
    await expect(page).toHaveURL(/did=bounty/);
    const afterBounty = await price();
    expect(afterBounty).toBeGreaterThan(start);

    await page.getByRole("button", { name: "Add sessions" }).click();
    await expect(page).toHaveURL(/did=flood/);
    expect(await price()).toBeLessThan(afterBounty);

    await page.getByRole("button", { name: "Reset simulator" }).click();
    await expect(page).toHaveURL(/did=reset/);
    expect(await price()).toBe(start);
  });

  test("a buyer account is told it can't sell instead of being bounced", async ({ page }) => {
    await signIn(page, BUYER);
    await expect(page.getByRole("banner").getByRole("link", { name: /^Share/ })).toHaveCount(0);
    await page.goto("/share");
    await expect(page.getByText("is a buyer account")).toBeVisible();
  });

  test("the seller withdraws the trace and it leaves the catalog", async ({ page }) => {
    await signIn(page, SELLER);
    await page.goto("/me/traces");
    await page.getByRole("button", { name: "Withdraw" }).click();
    await page.getByRole("button", { name: "Withdraw" }).click(); // confirm
    await expect(page.getByText("Withdrawn").first()).toBeVisible();

    await page.context().clearCookies(); // a buyer's-eye view, not the owner's
    const res = await page.goto(listingUrl);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("link", { name: "Browse traces" }).last()).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ["/", "/traces", "/login", "/status"]) {
    test(`${path} fits the screen`, async ({ page }) => {
      await page.goto(path);
      const [scroll, width] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(scroll).toBeLessThanOrEqual(width);
    });
  }
});

test("the health check reports a ready database", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true });
});
