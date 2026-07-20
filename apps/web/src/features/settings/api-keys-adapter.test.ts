import { describe, expect, it, vi } from "vitest";

import { createApiKeySettingsAdapter } from "./api-keys-adapter";

const mutations = () => ({
  create: vi.fn().mockResolvedValue({
    displayKey: "mbk_live_display_once",
    key: { id: "api_key_1" },
  }),
  rotate: vi.fn().mockResolvedValue({
    displayKey: "mbk_live_rotated_once",
    key: { id: "api_key_2" },
  }),
  revoke: vi.fn().mockResolvedValue(null),
});

describe("createApiKeySettingsAdapter", () => {
  it("hides create, rotate, and revoke from non-admin roles before mutation", async () => {
    const api = mutations();
    const adapter = createApiKeySettingsAdapter({
      role: "viewer",
      brainKey: "brain_client_alpha",
      mutations: api,
    });

    expect(adapter.canAdministerKeys).toBe(false);
    await expect(
      adapter.createKey({
        name: "Reader",
        scopes: ["brain:read"],
        expiresAt: 2_000,
      }),
    ).rejects.toThrow("API key administration requires admin or owner role.");
    await expect(
      adapter.rotateKey({ keyId: "api_key_1", expiresAt: 3_000 }),
    ).rejects.toThrow("API key administration requires admin or owner role.");
    await expect(adapter.revokeKey({ keyId: "api_key_1" })).rejects.toThrow(
      "API key administration requires admin or owner role.",
    );
    expect(api.create).not.toHaveBeenCalled();
    expect(api.rotate).not.toHaveBeenCalled();
    expect(api.revoke).not.toHaveBeenCalled();
  });

  it("injects the server-selected Brain key into generated API-key mutations", async () => {
    const api = mutations();
    const adapter = createApiKeySettingsAdapter({
      role: "admin",
      brainKey: "brain_client_alpha",
      mutations: api,
    });

    await expect(
      adapter.createKey({
        name: "Reader",
        scopes: ["brain:read", "brain:ask"],
        expiresAt: 2_000,
      }),
    ).resolves.toBe("mbk_live_display_once");
    await expect(
      adapter.rotateKey({ keyId: "api_key_1", expiresAt: 3_000 }),
    ).resolves.toBe("mbk_live_rotated_once");
    await expect(adapter.revokeKey({ keyId: "api_key_1" })).resolves.toBe(
      undefined,
    );

    expect(api.create).toHaveBeenCalledWith({
      brainKey: "brain_client_alpha",
      name: "Reader",
      scopes: ["brain:read", "brain:ask"],
      expiresAt: 2_000,
    });
    expect(api.rotate).toHaveBeenCalledWith({
      brainKey: "brain_client_alpha",
      keyId: "api_key_1",
      expiresAt: 3_000,
    });
    expect(api.revoke).toHaveBeenCalledWith({
      brainKey: "brain_client_alpha",
      keyId: "api_key_1",
    });
  });
});
