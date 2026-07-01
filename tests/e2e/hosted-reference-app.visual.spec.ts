import { expect, test } from "@playwright/test";

test.describe("hosted reference app visual coverage", () => {
  test("matches the investor-visible first viewport", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        name: "A calm template for custom Brain, workflow, and agent apps",
      }),
    ).toBeVisible();
    await expect(page.getByText("What this proves")).toBeVisible();

    const documentPage = await page.locator(".notion-page").boundingBox();

    expect(documentPage?.width ?? 0).toBeGreaterThan(280);
    expect(documentPage?.height ?? 0).toBeGreaterThan(420);

    await expect(page).toHaveScreenshot("reference-app-first-viewport.png", {
      animations: "disabled",
      fullPage: false,
      maxDiffPixelRatio: 0.03,
    });
  });

  test("matches the workflow document page", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: /Workflows/ })
      .click();

    await expect(
      page.getByRole("heading", {
        name: "Workflows compose capabilities into auditable runs",
      }),
    ).toBeVisible();
    await expect(page.locator(".workflow-canvas")).toBeVisible();

    await expect(page.locator(".notion-page")).toHaveScreenshot(
      "workflow-document-page.png",
      {
        animations: "disabled",
        maxDiffPixelRatio: 0.03,
      },
    );
  });
});
