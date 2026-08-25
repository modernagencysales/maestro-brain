import { expect, test } from "@playwright/test";

test("hides the root loader after hydration", async ({ page }) => {
  await page.goto("/login");

  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator("#app-loader")).toHaveCSS("opacity", "0");
});

test("uses the purchased starter workspace route and keeps its shell mounted", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.locator("#app-loader")).toHaveCSS("opacity", "0");
  await page.locator('input[type="email"]').fill("parity@saas-ui.dev");
  await page.locator('input[type="password"]').fill("DemoPassword123");
  await page.locator('input[type="password"]').press("Tab");
  const logIn = page.getByRole("button", { name: "Log in" });
  await expect(logIn).toBeEnabled();
  await logIn.click();

  await expect(page).toHaveURL(/\/awesome-inc$/u);
  await expect(page).toHaveTitle("Connections");
  await expect(page.getByRole("button", { name: "Connections" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Brain/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clients" })).toBeVisible();

  await page.goto("/awesome-inc/inbox");
  await expect(page).toHaveURL(
    /\/awesome-inc\/(?:inbox|contacts\/view\/brain-page-overview)$/u,
  );
  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connections" })).toBeVisible();
});
