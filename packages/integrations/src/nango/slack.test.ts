import { describe, expect, it, vi } from "vitest";

import { fetchSlackSnapshot } from "./slack";

describe("Nango Slack snapshot", () => {
  it("loads bounded channel history through the workspace connection", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channels: [{ id: "C01", name: "company-context" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            messages: [
              { ts: "1782924800.0001", user: "U01", text: "Our ICP is…" },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await fetchSlackSnapshot({
      secretKey: "nango-secret",
      providerConfigKey: "slack",
      connectionId: "connection-1",
      request,
    });

    expect(result).toEqual({
      channels: [
        {
          id: "C01",
          name: "company-context",
          messages: [
            {
              timestamp: "1782924800.0001",
              authorId: "U01",
              text: "Our ICP is…",
            },
          ],
        },
      ],
      messageCount: 1,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer nango-secret",
      "Connection-Id": "connection-1",
      "Provider-Config-Key": "slack",
    });
  });
});
