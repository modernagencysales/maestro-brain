import { expect, test } from "@playwright/test";

const openPrimaryNav = async (page: import("@playwright/test").Page) => {
  const nav = page.getByRole("navigation", { name: "Primary" });
  const openButton = page.getByRole("button", { name: "Open sidebar" });

  // Wait for hydration: either the sidebar or its opener must exist before we
  // can decide whether a click is needed.
  await expect(nav.or(openButton).first()).toBeVisible();

  if (!(await nav.isVisible())) {
    await openButton.click();
    await expect(nav).toBeVisible();
  }

  return nav;
};

test.describe("hosted reference app visual coverage", () => {
  test("matches the investor-visible first viewport", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        name: "A reusable foundation for custom AI implementation work",
      }),
    ).toBeVisible();
    await expect(page.getByText("What an investor should see")).toBeVisible();

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
    const nav = await openPrimaryNav(page);
    await nav.getByRole("link", { name: /Workflows/ }).click();

    await expect(
      page.getByRole("heading", {
        name: "Workflows turn AI ideas into repeatable business processes",
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
