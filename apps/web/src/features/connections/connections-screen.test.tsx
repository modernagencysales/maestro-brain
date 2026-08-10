import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { BusinessPageRoot } from "../../saas-ui/business-shell";
import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import {
  ConnectionsScreen,
  type ConnectionsScreenState,
} from "./connections-screen";

const render = (
  state: ConnectionsScreenState,
  props: Omit<ComponentProps<typeof ConnectionsScreen>, "state"> = {},
) =>
  renderToStaticMarkup(
    <MaestroSaasUiProvider>
      <BusinessPageRoot>
        <ConnectionsScreen state={state} {...props} />
      </BusinessPageRoot>
    </MaestroSaasUiProvider>,
  );

describe("ConnectionsScreen", () => {
  it.each([
    ["loading" as const, "Loading connections"],
    ["empty" as const, "No connections yet"],
    ["typed_failure" as const, "Connection setup unavailable"],
    ["transport_failure" as const, "Connection status interrupted"],
  ])("renders the %s state", (status, text) => {
    expect(render({ status })).toContain(text);
  });

  it("renders ready connection rows without requiring a live provider", () => {
    const html = render({
      status: "ready",
      connections: [
        {
          key: "fireflies",
          provider: "Fireflies",
          authMethod: "API key",
          status: "ready",
          lastSync: "5 minutes ago",
          callsDiscovered: 12,
          callsRouted: 8,
          callsAwaitingRouting: 4,
          backfillComplete: true,
          lastError: null,
        },
      ],
    });

    expect(html).toContain("Connections");
    expect(html).toContain("Fireflies");
    expect(html).toContain("12 discovered");
    expect(html).toContain("8 routed");
    expect(html).toContain("4 awaiting routing");
    expect(html).toContain("API key");
    expect(html).toContain("Backfill complete");
    expect(html).toContain("Disconnect Fireflies");
    expect(html).not.toContain("Purge Fireflies data");
  });

  it("shows typed provider errors and permits purge only after revocation", () => {
    const html = render({
      status: "ready",
      connections: [
        {
          key: "gong",
          provider: "Gong",
          authMethod: "Access key + secret",
          status: "error",
          lastSync: null,
          callsDiscovered: 2,
          callsRouted: 0,
          callsAwaitingRouting: 2,
          backfillComplete: false,
          lastError: "Provider unavailable",
        },
        {
          key: "fathom",
          provider: "Fathom",
          authMethod: "API key",
          status: "revoked",
          lastSync: null,
          callsDiscovered: 3,
          callsRouted: 3,
          callsAwaitingRouting: 0,
          backfillComplete: true,
          lastError: null,
        },
      ],
    });

    expect(html).toContain("Access key + secret");
    expect(html).toContain("Provider unavailable");
    expect(html).toContain("Backfill in progress");
    expect(html).toContain("Request purge of Fathom data");
    expect(html).not.toContain("Purge Gong data");
  });

  it("offers provider cleanup retry before purge", () => {
    const html = render(
      {
        status: "ready",
        connections: [
          {
            key: "fireflies",
            provider: "Fireflies",
            authMethod: "API key",
            status: "revoked",
            lastSync: null,
            callsDiscovered: 2,
            callsRouted: 1,
            callsAwaitingRouting: 1,
            backfillComplete: false,
            lastError: "Provider cleanup pending",
            cleanupPending: true,
          },
        ],
      },
      { role: "admin" },
    );

    expect(html).toContain("Provider cleanup pending");
    expect(html).toContain("Retry disconnect Fireflies");
    expect(html).not.toContain("Purge Fireflies data");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Connect Fireflies<\/button>/,
    );
  });

  it("shows an audited purge request as pending review", () => {
    const html = render({
      status: "ready",
      connections: [
        {
          key: "fathom",
          provider: "Fathom",
          authMethod: "API key",
          status: "revoked",
          lastSync: null,
          callsDiscovered: 3,
          callsRouted: 3,
          callsAwaitingRouting: 0,
          backfillComplete: true,
          lastError: null,
          purgeRequested: true,
        },
      ],
    });

    expect(html).toContain("Purge request pending review");
    expect(html).not.toContain("Request purge of Fathom data");
  });

  it("renders every transcript connection lifecycle state", () => {
    const statuses = [
      "disconnected",
      "authorizing",
      "syncing",
      "ready",
      "error",
      "reauthorizing",
      "revoked",
    ] as const;
    const html = render({
      status: "ready",
      connections: statuses.map((status) => ({
        key: status,
        provider: status,
        authMethod: "API key",
        status,
        lastSync: null,
        callsDiscovered: 0,
        callsRouted: 0,
        callsAwaitingRouting: 0,
        backfillComplete: false,
        lastError: null,
      })),
    });

    for (const status of statuses) expect(html).toContain(status);
  });

  it("hides disconnect when authorization has no provider connection yet", () => {
    const html = render(
      {
        status: "ready",
        connections: [
          {
            key: "fireflies",
            provider: "Fireflies",
            authMethod: "API key",
            status: "authorizing",
            lastSync: null,
            callsDiscovered: 0,
            callsRouted: 0,
            callsAwaitingRouting: 0,
            backfillComplete: false,
            lastError: null,
            disconnectAvailable: false,
          },
        ],
      },
      { role: "admin" },
    );

    expect(html).not.toContain("Disconnect Fireflies");
  });

  it("renders the live call routing adapter below connection status", () => {
    const html = render(
      { status: "empty" },
      {
        role: "admin",
        routingQueue: { status: "empty" },
        onRoutingReview: () => undefined,
      },
    );

    expect(html).toContain("Calls to route");
    expect(html).toContain("No calls need routing");
  });
});
