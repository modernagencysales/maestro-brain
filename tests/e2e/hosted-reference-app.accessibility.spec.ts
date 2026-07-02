import { expect, test } from "@playwright/test";

const openPrimaryNav = async (page: import("@playwright/test").Page) => {
  const nav = page.getByRole("navigation", { name: "Primary" });

  if (await nav.isVisible().catch(() => false)) {
    return nav;
  }

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(nav).toBeVisible();

  return nav;
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
    }
    await expect(page.getByRole("status")).toContainText("Viewing Overview");
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
    await expect(page.getByRole("status")).toContainText(
      "The Brain turns company knowledge into usable AI context",
    );
  });
});
