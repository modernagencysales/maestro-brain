import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  ApiKeysPanel,
  acknowledgeDisplayKey,
  copyDisplayKey,
  hideDisplayKey,
  showCreatedDisplayKey,
  showDisplayKey,
  showRotatedDisplayKey,
} from "./api-keys-panel";
import { createApiKeySettingsAdapter } from "./api-keys-adapter";

const key = {
  id: "api_key_123",
  name: "Client Alpha read key",
  displayPrefix: "mbk_live_abcd",
  scopes: ["brain:read", "brain:ask"],
  roleCeiling: "viewer",
  status: "active",
  createdAt: 1_000,
  expiresAt: 2_000,
} as const;

const mutations = () => ({
  create: vi.fn().mockResolvedValue({ displayKey: "mbk_live_secret", key }),
  rotate: vi.fn().mockResolvedValue({ displayKey: "mbk_live_rotated", key }),
  revoke: vi.fn().mockResolvedValue(null),
});

const adapterFor = (role: "viewer" | "admin", keyMutations = mutations()) =>
  createApiKeySettingsAdapter({
    role,
    brainKey: "brain_client_alpha",
    mutations: keyMutations,
  });

const render = (role: "viewer" | "admin") => {
  const adapter = adapterFor(role);

  return renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <ApiKeysPanel adapter={adapter} keys={{ status: "ready", data: [key] }} />
    </MaestroSaasUiProvider>,
  );
};

describe("ApiKeysPanel", () => {
  it("renders contract-shaped public list metadata without display-once secrets", () => {
    const html = render("admin");

    expect(html).toContain("Brain API keys");
    expect(html).toContain("Client Alpha read key");
    expect(html).toContain("mbk_live_abcd");
    expect(html).toContain("brain_client_alpha");
    expect(html).toContain("Rotate key");
    expect(html).toContain("Revoke key");
    expect(html).not.toContain("mbk_live_secret");
    expect(html).not.toContain("keyHash");
    expect(html).not.toContain("principalId");
    expect(html).not.toContain("organizationId");
    expect(html).not.toContain("workspaceId");
    expect(html).not.toContain("principalGeneration");
    expect(html).not.toContain("createdByUserId");
    expect(html).not.toContain("revokedAt");
    expect(html).not.toContain("lastUsedAt");
  });

  it("requires generated refs instead of fail-closed placeholders for admin CRUD", () => {
    const html = render("admin");

    expect(html).toContain("Create API key");
    expect(html).not.toContain(
      "Generated headless API-key refs are unavailable",
    );
  });

  it("keeps created and rotated display keys in ephemeral panel state until acknowledged", async () => {
    const created = showCreatedDisplayKey(undefined, "mbk_live_secret");

    expect(created).toEqual({
      action: "created",
      displayKey: "mbk_live_secret",
      visible: true,
      copyStatus: "idle",
    });

    const rotated = showRotatedDisplayKey(created, "mbk_live_rotated");
    expect(rotated).toEqual({
      action: "rotated",
      displayKey: "mbk_live_rotated",
      visible: true,
      copyStatus: "idle",
    });
    expect(JSON.stringify(rotated)).not.toContain("mbk_live_secret");

    expect(hideDisplayKey(rotated)).toMatchObject({ visible: false });
    expect(showDisplayKey(hideDisplayKey(rotated))).toMatchObject({
      visible: true,
      displayKey: "mbk_live_rotated",
    });
    expect(copyDisplayKey(rotated)).toMatchObject({ copyStatus: "copied" });
    expect(acknowledgeDisplayKey(rotated)).toBeUndefined();

    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <ApiKeysPanel
          adapter={adapterFor("admin")}
          keys={{ status: "ready", data: [key] }}
          initialDisplayKeyNotice={rotated}
        />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain(
      "Copy this key now. It is shown once and cannot be recovered.",
    );
    expect(html).toContain("mbk_live_rotated");
    expect(html).toContain("Copy display key");
    expect(html).toContain("I have saved this key");
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
