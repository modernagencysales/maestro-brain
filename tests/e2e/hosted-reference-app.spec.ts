import { expect, test } from "@playwright/test";

test.describe("hosted reference app", () => {
  test("renders the investor-facing workspace shell", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Maestro Template/);
    await expect(
      page.getByRole("heading", {
        name: "A calm template for custom Brain, workflow, and agent apps",
      }),
    ).toBeVisible();
    await expect(page.locator(".notion-eyebrow")).toHaveText(
      "Private AI app factory",
    );
    await expect(page.getByText("What this proves")).toBeVisible();
    await expect(page.getByText("How to read the template")).toBeVisible();
  });

  test("presents each primitive as a single readable document page", async ({
    page,
  }) => {
    await page.goto("/");
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await sidebar.getByRole("link", { name: /Brain/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "The Brain is simple, source-grounded, and intentionally flexible",
      }),
    ).toBeVisible();
    await expect(page.getByText("Founder interview notes")).toBeVisible();

    await sidebar.getByRole("link", { name: /Workflows/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Workflows compose capabilities into auditable runs",
      }),
    ).toBeVisible();
    await expect(page.locator(".workflow-canvas")).toBeVisible();

    await sidebar.getByRole("link", { name: /Capabilities/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Capabilities are typed units of work",
      }),
    ).toBeVisible();
    await expect(page.getByText("createTrustReceipt")).toBeVisible();

    await sidebar.getByRole("link", { name: /Agents/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Agents are nondeterministic actors with explicit grants",
      }),
    ).toBeVisible();
    await expect(page.getByText("Agent grants are explicit.")).toBeVisible();
  });

  test("keeps generated API and provider proof easy to read", async ({
    page,
  }) => {
    await page.goto("/");
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await sidebar.getByRole("link", { name: /API \/ CLI \/ MCP/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "The same registry powers API, CLI, MCP, and Scalar docs",
      }),
    ).toBeVisible();
    await expect(page.getByText("Scalar docs are mounted")).toBeVisible();
    await expect(page.getByText("3 generated operations")).toBeVisible();

    await sidebar.getByRole("link", { name: /Integrations/ }).click();
    await expect(page.getByText("WorkOS/AuthKit")).toBeVisible();
    await expect(page.getByText("PostHog")).toBeVisible();

    await sidebar.getByRole("link", { name: /Safety/ }).click();
    await expect(page.getByText("Tenant identity")).toBeVisible();
    await expect(page.getByText("receipt_template_001")).toBeVisible();
  });

  test("keeps the Notion-style sidebar visible while navigating", async ({
    page,
  }) => {
    await page.goto("/");

    const sidebar = page.getByRole("navigation", { name: "Primary" });
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: /Overview/ }),
    ).toHaveAttribute("aria-current", "page");

    await sidebar.getByRole("link", { name: /Integrations/ }).click();

    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: /Integrations/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("WorkOS/AuthKit")).toBeVisible();
  });
});
