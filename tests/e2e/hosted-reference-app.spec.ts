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

  // The SPA shell hydrates after first paint, and the hamburger only exists
  // while the sidebar is hidden. Wait for hydration to settle on one of the
  // two states instead of sampling isVisible() mid-hydration, which used to
  // mis-click the hamburger and collapse an already-open sidebar.
  const openButton = page.getByRole("button", { name: "Open sidebar" });
  await expect(nav.or(openButton).first()).toBeVisible();

  if (!(await nav.isVisible())) {
    await openButton.click();
    await expect(nav).toBeVisible();
  }

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

  test("every sidebar item renders its name once and opens its own page", async ({
    page,
  }) => {
    // 19 items × (reopen sheet + animation) on mobile outgrows the default.
    test.setTimeout(120_000);
    await page.goto("/");

    // In sheet mode the sidebar auto-closes ~150ms after each navigation;
    // detect it up front so the loop can wait out the close animation
    // instead of racing it on reopen.
    const navLocator = page.getByRole("navigation", { name: "Primary" });
    const openButton = page.getByRole("button", { name: "Open sidebar" });
    await expect(navLocator.or(openButton).first()).toBeVisible();
    const sheetMode = !(await navLocator.isVisible());

    let sidebar = await primaryNav(page);

    const items = await sidebar
      .locator("a.template-sidebar-row")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute("href") ?? "",
          label:
            anchor
              .querySelector(".template-sidebar-label")
              ?.textContent?.trim() ?? "",
        })),
      );
    expect(items.length).toBeGreaterThanOrEqual(19);

    const headingByHref = new Map<string, string>();
    for (const { href, label } of items) {
      sidebar = await primaryNav(page);
      const row = sidebar.locator(`a.template-sidebar-row[href="${href}"]`);

      // The row (anchor + its Notion Kit menuitem wrapper) must contain the
      // label exactly once — a second copy means the shell is rendering a
      // dead, non-clickable duplicate that swallows clicks.
      const rowText = (await row.locator("..").innerText()).trim();
      expect(
        rowText.split(label).length - 1,
        `sidebar label "${label}" rendered ${String(rowText.split(label).length - 1)} times`,
      ).toBe(1);

      await row.click();
      if (sheetMode) {
        await navLocator.waitFor({ state: "hidden" });
      }
      await expect(page.locator("h1").first()).toBeVisible();
      const heading =
        (await page.locator("h1").first().textContent())?.trim() ?? "";

      // Every href must land on its own page: two menu items showing the
      // same document means one of them silently fell back.
      for (const [otherHref, otherHeading] of headingByHref) {
        if (otherHref !== href) {
          expect(
            heading,
            `"${label}" (${href}) shows the same page as ${otherHref}`,
          ).not.toBe(otherHeading);
        }
      }
      headingByHref.set(href, heading);
    }
  });

  test("streams live workflow runs from the deployed Convex backend", async ({
    page,
  }) => {
    await page.goto("/");

    const sidebar = await primaryNav(page);
    await sidebar.getByRole("link", { name: /Workflows/ }).click();

    const panel = page.getByRole("region", { name: "Live workspace data" });
    await expect(
      panel.getByRole("heading", { name: "Live workspace data" }),
    ).toBeVisible();

    // The hosted build bakes VITE_CONVEX_URL, so this must be a real
    // subscription against the seeded demo workspace — not fixture data.
    await expect(panel.getByText("Streaming from workspace")).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel.getByText("Maestro Template Demo")).toBeVisible();
    await expect(
      panel.getByText("source-grounded-brief").first(),
    ).toBeVisible();
  });
});
