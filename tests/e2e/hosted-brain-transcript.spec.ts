import { expect, test } from "@playwright/test";

test("renders transcript connectors without a route failure", async ({
  page,
}) => {
  await page.goto("/connections");
  if (await page.getByRole("heading", { name: "Sign in" }).isVisible()) {
    const email = process.env.WORKOS_SMOKE_EMAIL;
    const password = process.env.WORKOS_SMOKE_PASSWORD;
    if (!email || !password)
      throw new Error("WorkOS smoke credentials missing");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in|continue/i }).click();
    await page.waitForURL((url) => url.pathname === "/connections");
  }

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/connections");
  await page.reload();

  await expect(page.getByText("Route unavailable")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { exact: true, name: "Connections" }),
  ).toBeVisible();
  await expect(page.locator('[aria-label="Connections table"]')).toBeVisible();

  for (const provider of ["Fireflies", "Gong", "Fathom", "Granola"]) {
    const row = page.getByRole("row").filter({ hasText: provider });
    await expect(row).toBeVisible();
    await expect(
      row.getByRole("button", { name: new RegExp(provider) }),
    ).toBeEnabled();
  }

  await expect(page.getByLabel("Transcript file")).toBeEnabled();
  await expect(page.getByLabel("Optional target Brain")).toBeEnabled();

  expect(errors).toEqual([]);
});
