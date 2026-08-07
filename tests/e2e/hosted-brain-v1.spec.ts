import { expect, test } from "@playwright/test";

test("publishes a cited imported transcript into only its Client Brain", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const clientName = "Brain V1 Acceptance";
  const clientSlug = "brain-v1-acceptance-20260807";
  const marker = `Lighthouse-${Date.now()}`;
  const callTitle = `V1 acceptance ${marker}`;

  await page.goto("/clients");
  if (await page.getByRole("heading", { name: "Sign in" }).isVisible()) {
    const email = process.env.WORKOS_SMOKE_EMAIL;
    const password = process.env.WORKOS_SMOKE_PASSWORD;
    if (!email || !password)
      throw new Error("WorkOS smoke credentials missing");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in|continue/i }).click();
    await page.waitForURL((url) => url.pathname === "/clients");
  }

  const workspaceSelect = page.getByLabel("Active workspace");
  await expect(workspaceSelect).toBeVisible();
  if (
    (await workspaceSelect
      .locator("option", { hasText: clientName })
      .count()) === 0
  ) {
    await page.getByLabel("Client name").fill(clientName);
    await page.getByLabel("Client slug").fill(clientSlug);
    await page.getByRole("button", { name: "Create Client Brief" }).click();
    await page.waitForURL((url) => url.pathname === "/brain");
  }

  await expect(
    workspaceSelect.locator("option", { hasText: clientName }),
  ).toHaveCount(1);
  await workspaceSelect.selectOption({ label: clientName });
  await page.goto("/connections");
  await expect(page.getByLabel("Active workspace")).toHaveValue(
    (await page
      .getByLabel("Optional target Brain")
      .locator("option", { hasText: clientName })
      .getAttribute("value")) ?? "",
  );

  await page.getByLabel("Transcript file").setInputFiles({
    name: `${marker}.vtt`,
    mimeType: "text/vtt",
    buffer: Buffer.from(
      `WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nJordan: The client approved launching Project ${marker} on September 18.\n\n00:00:05.000 --> 00:00:10.000\nJordan: Jordan owns the final ${marker} launch checklist by September 12.\n`,
    ),
  });
  await page.getByLabel("Call title").fill(callTitle);
  await page.getByLabel("Call date and time").fill("2026-08-07T18:00");
  await page
    .getByLabel("Optional target Brain")
    .selectOption({ label: clientName });
  await page.getByRole("button", { name: "Import transcript" }).click();
  await expect(
    page.getByText("Transcript imported. Brain processing has started."),
  ).toBeVisible();

  await page.goto("/brain");
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByRole("form", { name: `Review ${callTitle}` }),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ intervals: [2_000, 5_000, 10_000], timeout: 180_000 });

  const review = page.getByRole("form", { name: `Review ${callTitle}` });
  await expect(review).toContainText(marker);
  await review.getByRole("button", { name: "Accept all changes" }).click();
  await expect(page.getByText("Call updates published.")).toBeVisible();

  await page.getByLabel("Search Brain").fill(marker);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByLabel(`Search results for ${marker}`)).toContainText(
    marker,
  );
  await expect(page.getByLabel(`Search results for ${marker}`)).toContainText(
    "Citation:",
  );

  await page
    .getByLabel("Active workspace")
    .selectOption({ label: "Agency Brain" });
  await page.getByLabel("Search Brain").fill(marker);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(`No Brain results for ${marker}.`)).toBeVisible();
});
