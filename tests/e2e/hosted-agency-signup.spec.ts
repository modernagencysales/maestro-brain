import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { NotFoundException, WorkOS } from "@workos-inc/node";

const externalOrganizationId = (userId: string) =>
  `maestro-brain-founder:${userId}`;

const isNotFound = (error: unknown): error is NotFoundException =>
  error instanceof NotFoundException;

const removeDisposableUserMemberships = async (
  workos: WorkOS,
  userId: string,
) => {
  const memberships = await workos.userManagement.listOrganizationMemberships({
    userId,
    statuses: ["active", "inactive", "pending"],
    limit: 100,
  });
  for (const membership of memberships.data) {
    await workos.userManagement.deleteOrganizationMembership(membership.id);
  }
};

const cleanupAcceptanceArtifacts = async (input: {
  readonly workos: WorkOS;
  readonly userId: string;
  readonly externalId: string;
}) => {
  await removeDisposableUserMemberships(input.workos, input.userId);

  let organizationId: string | undefined;
  try {
    organizationId = (
      await input.workos.organizations.getOrganizationByExternalId(
        input.externalId,
      )
    ).id;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  if (organizationId) {
    try {
      await input.workos.organizations.deleteOrganization(organizationId);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  try {
    await input.workos.userManagement.deleteUser(input.userId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
};

test("provisions an isolated owner agency for a zero-membership user", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey || !process.env.WORKOS_CLIENT_ID) {
    throw new Error("WorkOS acceptance environment missing");
  }

  const workos = new WorkOS(apiKey);
  const marker = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const emailDomain = process.env.WORKOS_ACCEPTANCE_EMAIL_DOMAIN ?? "gmail.com";
  const email = `brain-acceptance-${marker}@${emailDomain}`;
  const password = `AgencyBrain-${randomUUID()}!aA9`;
  const user = await workos.userManagement.createUser({
    email,
    password,
    name: "Brain Acceptance",
    firstName: "Brain",
    lastName: "Acceptance",
    emailVerified: true,
    externalId: `maestro-brain-acceptance:${marker}`,
  });
  const externalId = externalOrganizationId(user.id);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const expectVisibleBrainDocument = async () => {
    const body = page.locator("body");
    await expect(body).toBeVisible();
    expect((await body.innerText()).trim()).not.toBe("");
    await expect(
      page.getByText("Authorized workspace list is not ready.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.getByText("Route unavailable")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  };
  let primaryError: unknown;
  let cleanupFailed = false;

  try {
    await removeDisposableUserMemberships(workos, user.id);
    const initialMemberships =
      await workos.userManagement.listOrganizationMemberships({
        userId: user.id,
        statuses: ["active"],
        limit: 100,
      });
    expect(initialMemberships.data).toEqual([]);

    await page.goto("/sign-in?returnPathname=%2Fbrain");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("button", { name: "Continue with email" }).click();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in|continue/i }).click();
    await page.waitForURL((url) => url.pathname === "/brain", {
      timeout: 60_000,
    });

    await expectVisibleBrainDocument();
    await expect(
      page.getByRole("heading", { name: "Agency Brain", exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    await page.reload();
    await expectVisibleBrainDocument();
    await expect(
      page.getByRole("heading", { name: "Agency Brain", exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    const organization =
      await workos.organizations.getOrganizationByExternalId(externalId);
    expect(organization.externalId).toBe(externalId);
    const memberships = await workos.userManagement.listOrganizationMemberships(
      {
        userId: user.id,
        statuses: ["active"],
        limit: 100,
      },
    );
    expect(memberships.data).toHaveLength(1);
    expect(memberships.data[0]?.organizationId).toBe(organization.id);

    await expect(
      page.getByRole("status").filter({ hasText: "Viewing Agency Brain" }),
    ).toBeVisible();
    await expect(page.getByLabel("Active workspace")).toHaveCount(0);

    await page.goto("/settings");
    await expect(
      page.getByRole("form", { name: "Create API key" }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await cleanupAcceptanceArtifacts({
        workos,
        userId: user.id,
        externalId,
      });
    } catch {
      cleanupFailed = true;
      testInfo.annotations.push({
        type: "cleanup",
        description:
          "WorkOS cleanup also failed; inspect only the disposable acceptance user and its deterministic organization.",
      });
    }
  }

  if (primaryError !== undefined) throw primaryError;
  if (cleanupFailed) throw new Error("WorkOS acceptance cleanup failed");
});
