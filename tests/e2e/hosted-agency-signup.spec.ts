import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { NotFoundException, WorkOS } from "@workos-inc/node";

const externalOrganizationId = (userId: string) =>
  `maestro-brain-founder:${userId}`;

const isNotFound = (error: unknown): error is NotFoundException =>
  error instanceof NotFoundException;

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
  const emailDomain =
    process.env.WORKOS_ACCEPTANCE_EMAIL_DOMAIN ?? "example.com";
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
  let primaryFailed = false;

  try {
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

    await expect(page.getByText("Route unavailable")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Agency Brain", exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    await page.reload();
    await expect(page.getByText("Route unavailable")).toHaveCount(0);
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

    const workspaceSelect = page.getByLabel("Active workspace");
    await expect(workspaceSelect).toBeVisible();
    await expect(workspaceSelect.locator("option")).toHaveCount(1);
    await expect(workspaceSelect.locator("option")).toHaveText(
      "Brain Acceptance Agency",
    );

    await page.goto("/settings");
    await expect(
      page.getByRole("form", { name: "Create API key" }),
    ).toBeVisible();
  } catch (error) {
    primaryFailed = true;
    throw error;
  } finally {
    try {
      let organizationId: string | undefined;
      try {
        organizationId = (
          await workos.organizations.getOrganizationByExternalId(externalId)
        ).id;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }

      if (organizationId) {
        const memberships =
          await workos.userManagement.listOrganizationMemberships({
            userId: user.id,
            statuses: ["active", "inactive", "pending"],
            limit: 100,
          });
        for (const membership of memberships.data) {
          if (membership.organizationId === organizationId) {
            await workos.userManagement.deleteOrganizationMembership(
              membership.id,
            );
          }
        }
        try {
          await workos.organizations.deleteOrganization(organizationId);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }

      try {
        await workos.userManagement.deleteUser(user.id);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    } catch {
      if (!primaryFailed) throw new Error("WorkOS acceptance cleanup failed");
      testInfo.annotations.push({
        type: "cleanup",
        description:
          "WorkOS cleanup also failed; inspect only the disposable acceptance user and its deterministic organization.",
      });
    }
  }
});
