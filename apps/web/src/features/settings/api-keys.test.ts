import { describe, expect, it } from "vitest";

import { buildApiKeySettingsSections } from "./api-keys";

const workspace = {
  workspaceId: "workspace_acme",
  organizationId: "org_acme",
  name: "Acme Demo",
  slug: "acme-demo",
  role: "owner",
  status: "active",
} as const;

const apiKey = {
  id: "api_key_123",
  name: "Client Alpha read key",
  displayPrefix: "mbk_live_abcd",
  scopes: ["brain:read", "brain:ask"],
  roleCeiling: "viewer",
  status: "active",
  createdAt: 1_000,
  expiresAt: 2_000,
} as const;

describe("settings API key surface", () => {
  it("stays read-only without a server-derived workspace", () => {
    expect(
      buildApiKeySettingsSections({
        workspace: null,
        viewer: { role: "owner" },
        keys: [],
        brainKey: null,
      }),
    ).toEqual([
      {
        heading: "API keys unavailable",
        body: [
          "API keys require a server-derived active workspace and Brain scope.",
        ],
      },
    ]);
  });

  it("renders contract-shaped public list metadata with adapter-selected Brain context", () => {
    const sections = buildApiKeySettingsSections({
      workspace,
      viewer: { role: "admin" },
      keys: [apiKey],
      brainKey: "brain_client_alpha",
    });

    expect(sections.map((section) => section.heading)).toEqual([
      "Brain API keys",
      "Client Alpha read key",
    ]);
    expect(sections[0]?.body.join("\n")).toContain(
      "Admins can create expiring, viewer-ceiling keys for one Brain.",
    );
    expect(sections[1]?.body).toContain("Brain: brain_client_alpha");
    expect(sections[1]?.body).toContain("Scopes: brain:read, brain:ask");
    const rendered = JSON.stringify(sections);
    expect(rendered).not.toContain("secret");
    expect(rendered).not.toContain("keyHash");
    expect(rendered).not.toContain("principalId");
    expect(rendered).not.toContain("organizationId");
    expect(rendered).not.toContain("workspaceId");
    expect(rendered).not.toContain("principalGeneration");
    expect(rendered).not.toContain("createdByUserId");
    expect(rendered).not.toContain("revokedAt");
    expect(rendered).not.toContain("lastUsedAt");
  });

  it("hides create and rotation language from non-admin viewers", () => {
    const sections = buildApiKeySettingsSections({
      workspace,
      viewer: { role: "viewer" },
      keys: [apiKey],
      brainKey: "brain_client_alpha",
    });

    expect(sections[0]?.body).toContain(
      "API key creation, rotation, and revocation are hidden for non-admin roles.",
    );
  });
});
