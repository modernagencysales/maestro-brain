import { expect, test } from "@playwright/test";

test.describe("hosted reference app", () => {
  test("renders the investor-facing workspace shell", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Maestro Template/);
    await expect(
      page.getByRole("heading", {
        name: "Custom Brain, workflow, and agent apps without rebuilding the platform",
      }),
    ).toBeVisible();
    await expect(page.getByText("Private AI app factory")).toBeVisible();
    await expect(page.getByText("Confect/Effect contracts")).toBeVisible();
    await expect(page.getByText("Reference Workflow")).toBeVisible();
  });

  test("shows the reusable Brain, workflow, headless, and safety primitives", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Living Brain" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Workflow Runtime" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Headless Registry" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "OpenAPI / Scalar" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Workflow Run Receipt" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Trust Receipt" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Default Provider Posture" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Safety Model" }),
    ).toBeVisible();
  });

  test("keeps generated API and provider proof visible", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "OpenAPI / Scalar" }),
    ).toBeVisible();
    await expect(
      page.locator(".api-doc-card").getByText("/api/docs"),
    ).toBeVisible();
    await expect(page.getByText("3 generated operations")).toBeVisible();
    await expect(
      page.locator("#integrations").getByText("WorkOS/AuthKit"),
    ).toBeVisible();
    await expect(
      page.locator("#integrations").getByText("PostHog"),
    ).toBeVisible();
    await expect(
      page.locator("#safety").getByText("Dodo billing"),
    ).toBeVisible();
    await expect(
      page.locator("#safety").getByText("MailerSend email"),
    ).toBeVisible();
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
    await expect(
      page.locator("#integrations").getByText("WorkOS/AuthKit"),
    ).toBeVisible();
  });
});
