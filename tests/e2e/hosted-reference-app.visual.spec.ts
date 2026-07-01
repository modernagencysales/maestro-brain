import { expect, test } from "@playwright/test";

test.describe("hosted reference app visual coverage", () => {
  test("matches the investor-visible first viewport", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        name: "Custom Brain, workflow, and agent apps without rebuilding the platform",
      }),
    ).toBeVisible();
    await expect(page.locator(".workflow-canvas")).toBeVisible();

    const header = await page.locator(".page-header").boundingBox();
    const workflow = await page.locator(".workflow-canvas").boundingBox();

    expect(header?.width ?? 0).toBeGreaterThan(280);
    expect(header?.height ?? 0).toBeGreaterThan(80);
    expect(workflow?.width ?? 0).toBeGreaterThan(280);
    expect(workflow?.height ?? 0).toBeGreaterThan(240);

    await expect(page).toHaveScreenshot("reference-app-first-viewport.png", {
      animations: "disabled",
      fullPage: false,
      maxDiffPixelRatio: 0.03,
    });
  });

  test("matches the workflow and trust receipt section", async ({ page }) => {
    await page.goto("/");
    await page.locator("#runs").scrollIntoViewIfNeeded();

    await expect(
      page.getByRole("heading", { name: "Workflow Run Receipt" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Trust Receipt" }),
    ).toBeVisible();

    await expect(page.locator("#runs")).toHaveScreenshot(
      "workflow-trust-receipt-section.png",
      {
        animations: "disabled",
        maxDiffPixelRatio: 0.03,
      },
    );
  });
});
