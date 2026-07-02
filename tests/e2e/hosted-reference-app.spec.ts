import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const primaryNav = async (page: Page) => {
  const nav = page.getByRole("navigation", { name: "Primary" });
  const waitForRouteLinksOnScreen = async () => {
    await page.waitForFunction(() => {
      const link = document.querySelector(
        'nav[aria-label="Primary"] a.template-sidebar-row',
      );
      const box = link?.getBoundingClientRect();

      return Boolean(box && box.left >= 0 && box.right > box.left);
    });
  };

  if (await nav.isVisible().catch(() => false)) {
    await waitForRouteLinksOnScreen();
    return nav;
  }

  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(nav).toBeVisible();
  await waitForRouteLinksOnScreen();

  return nav;
};

test.describe("hosted reference app", () => {
  test("renders the investor-facing workspace shell", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Maestro Template/);
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#template-main-content");
    await expect(page.getByRole("status")).toContainText("Viewing Overview");
    await expect(page.locator(".template-toast-region")).toBeAttached();
    await expect(
      page.getByRole("heading", {
        name: "A reusable foundation for custom AI implementation work",
      }),
    ).toBeVisible();
    await expect(page.locator(".notion-eyebrow")).toHaveText(
      "Private AI app factory",
    );
    await expect(
      page.getByText("What a GTM operator should see"),
    ).toBeVisible();
    await expect(page.getByText("What an investor should see")).toBeVisible();
    await expect(page.getByLabel("Template operating model")).toBeVisible();
  });

  test("presents each primitive as a single readable document page", async ({
    page,
  }) => {
    await page.goto("/");
    let sidebar = await primaryNav(page);

    await sidebar.getByRole("link", { name: /Brain/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "The Brain turns company knowledge into usable AI context",
      }),
    ).toBeVisible();
    await expect(page.getByText("Founder interview notes")).toBeVisible();
    await expect(page.getByLabel("Brain context path")).toBeVisible();

    sidebar = await primaryNav(page);
    await sidebar.getByRole("link", { name: /Workflows/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Workflows turn AI ideas into repeatable business processes",
      }),
    ).toBeVisible();
    await expect(page.locator(".workflow-canvas")).toBeVisible();
    await expect(page.getByText("Run status")).toBeVisible();
    await expect(
      page.getByText("maestro-template workflow run --workflow"),
    ).toBeVisible();
    await expect(
      page.getByText(
        "trust_run_template_001 proves source-backed-no-default-rag",
      ),
    ).toBeVisible();

    sidebar = await primaryNav(page);
    await sidebar.getByRole("link", { name: /Capabilities/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Capabilities are the safe actions the system can perform",
      }),
    ).toBeVisible();
    await expect(page.getByText("createTrustReceipt")).toBeVisible();

    sidebar = await primaryNav(page);
    await sidebar.getByRole("link", { name: /Agents/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Agents make choices, but only inside boundaries",
      }),
    ).toBeVisible();
    await expect(page.getByText("Agent grants are explicit.")).toBeVisible();
  });

  test("keeps generated API and provider proof easy to read", async ({
    page,
  }) => {
    await page.goto("/");
    let sidebar = await primaryNav(page);

    await sidebar.getByRole("link", { name: /API \/ CLI \/ MCP/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "One operation can show up in the app, API, CLI, MCP, and docs",
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel("One operation registry, many surfaces"),
    ).toBeVisible();
    await expect(page.getByText("Scalar docs are mounted")).toBeVisible();
    await expect(page.getByText("4 generated operations")).toBeVisible();

    sidebar = await primaryNav(page);
    await sidebar.getByRole("link", { name: /Integrations/ }).click();
    await expect(page.getByText("WorkOS/AuthKit")).toBeVisible();
    await expect(page.getByText("PostHog")).toBeVisible();

    sidebar = await primaryNav(page);
    await sidebar.getByRole("link", { name: /Safety/ }).click();
    await expect(page.getByText("Tenant identity")).toBeVisible();
    await expect(page.getByText("trust_run_template_001")).toBeVisible();
  });

  test("keeps setup, settings, and billing quickstart pages readable", async ({
    page,
  }) => {
    await page.goto("/");
    let sidebar = await primaryNav(page);

    await sidebar.getByRole("link", { name: /Onboarding/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Onboarding turns the template into a client app",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Create or confirm the client workspace"),
    ).toBeVisible();

    sidebar = await primaryNav(page);
    await sidebar.getByRole("link", { name: /Settings/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Settings make the fork operational without live secrets",
      }),
    ).toBeVisible();
    await expect(page.getByText("WorkOS/AuthKit")).toBeVisible();

    sidebar = await primaryNav(page);
    await sidebar.getByRole("link", { name: /Billing/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Billing starts fake and becomes live after signoff",
      }),
    ).toBeVisible();
    await expect(page.getByText("billing fake first mode")).toBeVisible();
  });

  test("keeps the Notion-style sidebar visible while navigating", async ({
    page,
  }) => {
    await page.goto("/");

    let sidebar = await primaryNav(page);
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: /Overview/ }),
    ).toHaveAttribute("aria-current", "page");

    await sidebar.getByRole("link", { name: /Integrations/ }).click();

    sidebar = await primaryNav(page);
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: /Integrations/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("WorkOS/AuthKit")).toBeVisible();
  });
});
