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
  });
});
