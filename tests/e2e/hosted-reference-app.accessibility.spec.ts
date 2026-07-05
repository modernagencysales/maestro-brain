import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

const openPrimaryNav = async (page: import("@playwright/test").Page) => {
  const nav = page.getByRole("navigation", { name: "Primary" });

  // Wait for hydration to settle on either the docked sidebar or the
  // hamburger (which only exists while the sidebar is hidden) instead of
  // sampling isVisible() mid-hydration.
  const openButton = page.getByRole("button", { name: "Open sidebar" });
  await expect(nav.or(openButton).first()).toBeVisible();

  if (await nav.isVisible()) {
    return nav;
  }

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await openButton.click();
  await expect(nav).toBeVisible();

  return nav;
};

const expectNoAxeViolations = async (
  page: import("@playwright/test").Page,
  label: string,
) => {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }));

  expect(violations, `${label} has axe violations`).toEqual([]);
};

test.describe("hosted reference app accessibility", () => {
  test("exposes landmarks, skip link, and live status", async ({ page }) => {
    await page.goto("/");

    const skipLink = page.getByRole("link", { name: "Skip to content" });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveAttribute("href", "#template-main-content");
    await expect(await openPrimaryNav(page)).toBeVisible();
    const viewport = page.viewportSize();
    if (!viewport || viewport.width >= 768) {
      await expect(
        page.getByRole("navigation", { name: "Workspace" }),
      ).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Close sidebar" }).click();
      await expect(
        page.getByRole("button", { name: "Open sidebar" }),
      ).toBeVisible();
    }
    await expect(page.getByRole("status")).toContainText("Viewing Overview");
    await expectNoAxeViolations(page, "Overview");
  });

  test("keeps mobile navigation operable and announces route changes", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = await openPrimaryNav(page);

    await nav.getByRole("link", { name: /Brain/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "The Brain turns company knowledge into usable AI context",
      }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Viewing Brain");
    await expect(page.locator("#template-main-content")).toBeFocused();
    await expectNoAxeViolations(page, "Brain");
  });
});
