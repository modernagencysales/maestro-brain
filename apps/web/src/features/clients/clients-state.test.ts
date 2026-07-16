import { describe, expect, it } from "vitest";

import {
  buildClientsState,
  buildCreateClientInput,
  transitionClientOnboarding,
  type ClientBrainSummary,
} from "./clients-state";

const client: ClientBrainSummary = {
  brainKey: "br_01J0000000000000000000000C",
  name: "Acme Co",
  clientSlug: "acme",
  status: "active",
  updatedAt: 1_784_073_600_000,
  connectionCount: 2,
  recentChangeCount: 3,
  connectionHealth: "not_connected",
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
          health: "Not connected",
          freshness: "Updated Jul 15, 2026",
          connections: 2,
          recentChanges: 3,
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

  it("retains one idempotency key across retry and onboarding recovery", () => {
    const creating = transitionClientOnboarding(
      { status: "idle" },
      { type: "submit", idempotencyKey: "idem-retry" },
    );
    const failed = transitionClientOnboarding(creating, {
      type: "failed",
      message: "Typed failure",
    });

    expect(failed).toEqual({
      status: "failed",
      idempotencyKey: "idem-retry",
      message: "Typed failure",
    });
    if (failed.status !== "failed") throw new Error("expected failed state");
    expect(
      buildCreateClientInput({
        name: " Retry Client ",
        clientSlug: "Retry-Client",
        existingIdempotencyKey: failed.idempotencyKey,
      }),
    ).toEqual({
      name: "Retry Client",
      clientSlug: "retry-client",
      idempotencyKey: "idem-retry",
    });
  });

  it("carries server capacity through ready onboarding", () => {
    const creating = transitionClientOnboarding(
      { status: "idle" },
      { type: "submit", idempotencyKey: "idem-ready" },
    );

    expect(
      transitionClientOnboarding(creating, {
        type: "created",
        brainKey: "br_client",
        initialPageKey: "pag_br_client_overview",
        capacity: {
          clientBrains: 4,
          clientBrainLimit: 25,
          remainingClientBrains: 21,
        },
      }),
    ).toEqual({
      status: "ready",
      idempotencyKey: "idem-ready",
      brainKey: "br_client",
      initialPageKey: "pag_br_client_overview",
      capacity: {
        clientBrains: 4,
        clientBrainLimit: 25,
        remainingClientBrains: 21,
      },
    });
  });
});
