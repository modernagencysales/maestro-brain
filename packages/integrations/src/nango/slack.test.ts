import { describe, expect, it, vi } from "vitest";

import { fetchSlackSnapshot, SlackSnapshotCapacityExceeded } from "./slack";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

const requestedUrl = (request: ReturnType<typeof vi.fn>, index: number) =>
  new URL(String(request.mock.calls[index]?.[0]));

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

  it("paginates channels and every channel history page", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          channels: [{ id: "C01", name: "company-context" }],
          response_metadata: { next_cursor: "channels-2" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          channels: [{ id: "C02", name: "delivery" }],
          response_metadata: { next_cursor: "" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          messages: [{ ts: "3.0", user: "U03", text: "Third" }],
          response_metadata: { next_cursor: "history-2" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          messages: [{ ts: "2.0", user: "U02", text: "Second" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          messages: [{ ts: "1.0", user: "U01", text: "First" }],
        }),
      );

    const result = await fetchSlackSnapshot({
      secretKey: "nango-secret",
      providerConfigKey: "slack",
      connectionId: "connection-1",
      request,
    });

    expect(result.channels.map(({ id }) => id)).toEqual(["C01", "C02"]);
    expect(
      result.channels[0]?.messages.map(({ timestamp }) => timestamp),
    ).toEqual(["3.0", "2.0"]);
    expect(result.messageCount).toBe(3);
    expect(requestedUrl(request, 1).searchParams.get("cursor")).toBe(
      "channels-2",
    );
    expect(requestedUrl(request, 3).searchParams.get("cursor")).toBe(
      "history-2",
    );
  });

  it("loads every thread reply page without duplicating the parent", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          channels: [{ id: "C01", name: "company-context" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          messages: [
            {
              ts: "10.0",
              user: "U01",
              text: "Parent",
              reply_count: 2,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          messages: [
            { ts: "10.0", user: "U01", text: "Parent" },
            { ts: "10.1", user: "U02", text: "First reply" },
          ],
          response_metadata: { next_cursor: "replies-2" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          messages: [{ ts: "10.2", bot_id: "B01", text: "Second reply" }],
        }),
      );

    const result = await fetchSlackSnapshot({
      secretKey: "nango-secret",
      providerConfigKey: "slack",
      connectionId: "connection-1",
      request,
    });

    expect(result.channels[0]?.messages).toEqual([
      { timestamp: "10.0", authorId: "U01", text: "Parent" },
      { timestamp: "10.1", authorId: "U02", text: "First reply" },
      { timestamp: "10.2", authorId: "B01", text: "Second reply" },
    ]);
    expect(requestedUrl(request, 2).pathname).toBe(
      "/proxy/conversations.replies",
    );
    expect(requestedUrl(request, 2).searchParams.get("ts")).toBe("10.0");
    expect(requestedUrl(request, 3).searchParams.get("cursor")).toBe(
      "replies-2",
    );
  });

  it("fails explicitly when channel capacity is exceeded", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        channels: [
          { id: "C01", name: "one" },
          { id: "C02", name: "two" },
        ],
      }),
    );

    await expect(
      fetchSlackSnapshot({
        secretKey: "nango-secret",
        providerConfigKey: "slack",
        connectionId: "connection-1",
        request,
        limits: { maxChannels: 1 },
      }),
    ).rejects.toMatchObject({
      name: "SlackSnapshotCapacityExceeded",
      resource: "channels",
      capacity: 1,
    } satisfies Partial<SlackSnapshotCapacityExceeded>);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("counts thread replies against per-channel message capacity", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          channels: [{ id: "C01", name: "company-context" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          messages: [
            {
              ts: "10.0",
              user: "U01",
              text: "Parent",
              reply_count: 1,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          messages: [
            { ts: "10.0", user: "U01", text: "Parent" },
            { ts: "10.1", user: "U02", text: "Reply" },
          ],
        }),
      );

    await expect(
      fetchSlackSnapshot({
        secretKey: "nango-secret",
        providerConfigKey: "slack",
        connectionId: "connection-1",
        request,
        limits: { maxMessagesPerChannel: 1 },
      }),
    ).rejects.toMatchObject({
      name: "SlackSnapshotCapacityExceeded",
      resource: "messages",
      capacity: 1,
    } satisfies Partial<SlackSnapshotCapacityExceeded>);
  });

  it("fails explicitly when a collection exceeds its page bound", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        channels: [{ id: "C01", name: "one" }],
        response_metadata: { next_cursor: "channels-2" },
      }),
    );

    await expect(
      fetchSlackSnapshot({
        secretKey: "nango-secret",
        providerConfigKey: "slack",
        connectionId: "connection-1",
        request,
        limits: { maxPagesPerCollection: 1 },
      }),
    ).rejects.toMatchObject({
      name: "SlackSnapshotCapacityExceeded",
      resource: "pages",
      capacity: 1,
    } satisfies Partial<SlackSnapshotCapacityExceeded>);
  });
});
