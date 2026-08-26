import { describe, expect, it, vi } from "vitest";

import { fetchHubSpotInventory, HubSpotCapacityExceeded } from "./hubspot";

const response = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

const deal = (id: string, updatedAt: string, name: string) => ({
  id,
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt,
  archived: false,
  properties: { dealname: name, amount: "1000", dealstage: "qualified" },
});

const baseInput = {
  secretKey: "nango-secret",
  providerConfigKey: "hubspot",
  connectionId: "connection-2",
  connectionGeneration: 5,
  portalId: "portal-123",
  allowlistGeneration: 2,
  observedAt: 1_787_700_000_000,
  objectTypes: [
    {
      objectType: "deals",
      properties: ["dealstage", "amount", "dealname"],
    },
  ],
} as const;

describe("Nango HubSpot source inventory", () => {
  it("fully paginates object types and emits stable revision metadata", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          results: [deal("2", "2026-08-26T01:00:00.000Z", "Expansion")],
          paging: { next: { after: "after-2" } },
        }),
      )
      .mockResolvedValueOnce(
        response({
          results: [deal("1", "2026-08-25T01:00:00.000Z", "New business")],
        }),
      );

    const result = await fetchHubSpotInventory({ ...baseInput, request });

    expect(result).toMatchObject({
      complete: true,
      sourceCount: 2,
      pagesRead: 2,
      objectTypesScanned: ["deals"],
      scope: {
        providerKey: "hubspot",
        connectionGeneration: 5,
        containerKey: "portal-123",
        allowlistGeneration: 2,
        objectTypes: [
          {
            objectType: "deals",
            properties: ["amount", "dealname", "dealstage"],
          },
        ],
      },
    });
    expect(result.scope.scopeKey).toMatch(/^hss_[a-f0-9]{64}$/u);
    expect(result.observations.map(({ sourceKey }) => sourceKey)).toEqual([
      "hubspot:deals:1",
      "hubspot:deals:2",
    ]);
    expect(result.observations[0]).toMatchObject({
      providerObjectId: "1",
      observationOrder: {
        kind: "updated_at",
        value: String(Date.parse("2026-08-25T01:00:00.000Z")),
      },
      metadata: {
        objectType: "deals",
        properties: {
          amount: "1000",
          dealname: "New business",
          dealstage: "qualified",
        },
      },
    });
    expect(result.observations[0]?.revisionKey).toMatch(
      /^hubspot:deals:1:updated:\d+:hash:[a-f0-9]{64}$/u,
    );
    const firstUrl = new URL(String(request.mock.calls[0]?.[0]));
    expect(firstUrl.searchParams.get("properties")).toBe(
      "amount,dealname,dealstage",
    );
    const secondUrl = new URL(String(request.mock.calls[1]?.[0]));
    expect(secondUrl.searchParams.get("after")).toBe("after-2");
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer nango-secret",
      "Connection-Id": "connection-2",
      "Provider-Config-Key": "hubspot",
    });
  });

  it("uses selected properties in the scope and revision identities", async () => {
    const firstRequest = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        results: [deal("1", "2026-08-25T01:00:00.000Z", "New business")],
      }),
    );
    const secondRequest = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        results: [deal("1", "2026-08-25T01:00:00.000Z", "New business")],
      }),
    );

    const first = await fetchHubSpotInventory({
      ...baseInput,
      request: firstRequest,
    });
    const second = await fetchHubSpotInventory({
      ...baseInput,
      objectTypes: [{ objectType: "deals", properties: ["dealname"] }],
      request: secondRequest,
    });

    expect(first.scope.scopeKey).not.toBe(second.scope.scopeKey);
    expect(first.observations[0]?.revisionKey).not.toBe(
      second.observations[0]?.revisionKey,
    );
  });

  it("fails explicitly instead of truncating source inventory", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({
        results: [
          deal("1", "2026-08-25T01:00:00.000Z", "One"),
          deal("2", "2026-08-25T02:00:00.000Z", "Two"),
        ],
      }),
    );

    await expect(
      fetchHubSpotInventory({
        ...baseInput,
        request,
        limits: { maxSources: 1 },
      }),
    ).rejects.toMatchObject({
      _tag: "HubSpotCapacityExceeded",
      resource: "sources",
      capacity: 1,
    } satisfies Partial<HubSpotCapacityExceeded>);
  });

  it("fails explicitly when pagination exceeds its run bound", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ results: [], paging: { next: { after: 200 } } }),
      );

    await expect(
      fetchHubSpotInventory({
        ...baseInput,
        request,
        limits: { maxPages: 1 },
      }),
    ).rejects.toMatchObject({
      resource: "pages",
      capacity: 1,
    } satisfies Partial<HubSpotCapacityExceeded>);
  });
});
