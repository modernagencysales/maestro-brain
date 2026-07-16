import { describe, expect, it } from "vitest";

import { buildClientsState, type ClientBrainSummary } from "./clients-state";

const client: ClientBrainSummary = {
  brainKey: "br_01J0000000000000000000000C",
  name: "Acme Co",
  clientSlug: "acme",
  status: "active",
  updatedAt: 1_784_073_600_000,
  connectionCount: 2,
  recentChangeCount: 3,
};

describe("clients state", () => {
  it("maps empty and ready client Brains into UI rows", () => {
    expect(buildClientsState({ status: "ready", clients: [] })).toEqual({
      status: "empty",
    });

    expect(buildClientsState({ status: "ready", clients: [client] })).toEqual({
      status: "ready",
      clients: [
        expect.objectContaining({
          key: client.brainKey,
          name: "Acme Co",
          health: "Ready",
          freshness: "Updated Jul 15, 2026",
          connections: 2,
        }),
      ],
    });
  });

  it("excludes archived clients from the active list", () => {
    expect(
      buildClientsState({
        status: "ready",
        clients: [{ ...client, status: "archived" }],
      }),
    ).toEqual({ status: "empty" });
  });
});
