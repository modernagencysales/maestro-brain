import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { ApiKeysPanel } from "./api-keys-panel";
import { createApiKeySettingsAdapter } from "./api-keys-adapter";

const key = {
  id: "api_key_123",
  principalId: "sp_123",
  organizationId: "org_acme",
  workspaceId: "workspace_acme",
  brainKey: "brain_client_alpha",
  name: "Client Alpha read key",
  displayPrefix: "mbk_live_abcd",
  scopes: ["brain:read", "brain:ask"],
  principalGeneration: 1,
  roleCeiling: "viewer",
  status: "active",
  createdByUserId: "user_admin",
  createdAt: 1_000,
  expiresAt: 2_000,
  revokedAt: null,
  lastUsedAt: null,
} as const;

const mutations = () => ({
  create: vi.fn().mockResolvedValue({ displayKey: "mbk_live_secret", key }),
  rotate: vi.fn().mockResolvedValue({ displayKey: "mbk_live_rotated", key }),
  revoke: vi.fn().mockResolvedValue(null),
});

const render = (role: "viewer" | "admin") => {
  const adapter = createApiKeySettingsAdapter({
    role,
    brainKey: "brain_client_alpha",
    mutations: mutations(),
  });

  return renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <ApiKeysPanel adapter={adapter} keys={{ status: "ready", data: [key] }} />
    </MaestroSaasUiProvider>,
  );
};

describe("ApiKeysPanel", () => {
  it("renders metadata without display-once secrets", () => {
    const html = render("admin");

    expect(html).toContain("Brain API keys");
    expect(html).toContain("Client Alpha read key");
    expect(html).toContain("mbk_live_abcd");
    expect(html).toContain("Rotate key");
    expect(html).toContain("Revoke key");
    expect(html).not.toContain("mbk_live_secret");
    expect(html).not.toContain("keyHash");
  });

  it("requires generated refs instead of fail-closed placeholders for admin CRUD", () => {
    const html = render("admin");

    expect(html).toContain("Create API key");
    expect(html).not.toContain(
      "Generated headless API-key refs are unavailable",
    );
  });

  it("hides create, rotate, and revoke controls from non-admin viewers", () => {
    const html = render("viewer");

    expect(html).toContain("API key administration is hidden for this role.");
    expect(html).toContain("Client Alpha read key");
    expect(html).not.toContain("Create API key");
    expect(html).not.toContain("Rotate key");
    expect(html).not.toContain("Revoke key");
  });
});
