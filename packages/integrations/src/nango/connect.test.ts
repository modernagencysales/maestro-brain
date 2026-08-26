import { describe, expect, it, vi } from "vitest";

import { createNangoConnectSession, verifyNangoConnection } from "./connect";

describe("Nango Connect adapter", () => {
  it("creates a Slack-only session and clamps its expiry", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            token: `${"connect"}_session_fixture`,
            expires_at: "2026-08-23T16:11:00.000Z",
          },
        }),
        { status: 200 },
      ),
    );

    const session = await createNangoConnectSession({
      secretKey: "secret",
      providerConfigKey: "slack",
      workspaceId: "workspace_1",
      generation: 3,
      now: Date.parse("2026-08-23T16:05:30.000Z"),
      request,
    });

    expect(session.expiresAt).toBe(Date.parse("2026-08-23T16:10:30.000Z"));
    const requestInit = request.mock.calls.at(0)?.[1];
    if (requestInit?.body === undefined)
      throw new Error("missing request body");
    expect(JSON.parse(requestInit.body as string)).toEqual({
      allowed_integrations: ["slack"],
      end_user: { id: "workspace:workspace_1" },
      organization: { id: "workspace:workspace_1" },
      tags: { correlationTag: "slack:workspace_1:3" },
    });
  });

  it("rejects a connection that is not bound to the initiating workspace", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider_config_key: "slack",
          end_user: {
            id: "workspace:other",
            organization: { id: "workspace:other" },
          },
          tags: { correlationTag: "slack:other:1" },
        }),
        { status: 200 },
      ),
    );

    await expect(
      verifyNangoConnection({
        secretKey: "secret",
        providerConfigKey: "slack",
        workspaceId: "workspace_1",
        generation: 1,
        connectionId: "connection_1",
        request,
      }),
    ).rejects.toMatchObject({ _tag: "NangoConnectionInvalid" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retries a connection read while Nango is still converging", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response("not ready", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            connection_id: "connection_1",
            provider_config_key: "slack",
            end_user: {
              id: "workspace:workspace_1",
              organization: { id: "workspace:workspace_1" },
              tags: null,
            },
            tags: { correlationtag: "slack:workspace_1:2" },
          }),
          { status: 200 },
        ),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyNangoConnection({
        secretKey: "secret",
        providerConfigKey: "slack",
        workspaceId: "workspace_1",
        generation: 2,
        connectionId: "connection_1",
        request,
        sleep,
      }),
    ).resolves.toEqual({ connectionId: "connection_1" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it.each([400, 401, 403])(
    "fails fast when Nango returns permanent status %i",
    async (status) => {
      const request = vi
        .fn()
        .mockResolvedValue(new Response("permanent failure", { status }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      await expect(
        verifyNangoConnection({
          secretKey: "secret",
          providerConfigKey: "slack",
          workspaceId: "workspace_1",
          generation: 2,
          connectionId: "connection_1",
          request,
          sleep,
        }),
      ).rejects.toMatchObject({
        _tag: "NangoProviderUnavailable",
        status,
      });
      expect(request).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("exhausts the bounded retry schedule without a final sleep", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response("not ready", { status: 404 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyNangoConnection({
        secretKey: "secret",
        providerConfigKey: "slack",
        workspaceId: "workspace_1",
        generation: 2,
        connectionId: "connection_1",
        request,
        sleep,
      }),
    ).rejects.toMatchObject({
      _tag: "NangoProviderUnavailable",
      status: 404,
    });
    expect(request).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls).toEqual([[250], [500], [1_000], [2_000]]);
  });

  it("verifies the current Nango connection response and normalized tags", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          connection_id: "connection_1",
          provider_config_key: "slack",
          end_user: {
            id: "workspace:workspace_1",
            organization: { id: "workspace:workspace_1" },
          },
          tags: { correlationtag: "slack:workspace_1:2" },
        }),
        { status: 200 },
      ),
    );

    await expect(
      verifyNangoConnection({
        secretKey: "secret",
        providerConfigKey: "slack",
        workspaceId: "workspace_1",
        generation: 2,
        connectionId: "connection_1",
        request,
      }),
    ).resolves.toEqual({ connectionId: "connection_1" });
    expect(request).toHaveBeenCalledWith(
      "https://api.nango.dev/connections/connection_1?provider_config_key=slack",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    );
  });
});
