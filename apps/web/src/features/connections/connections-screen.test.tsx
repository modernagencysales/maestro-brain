import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
      <ConnectionsScreen state={state} {...props} />
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

  it("uses the canonical integration-card screen without legacy page chrome", () => {
    const html = render({
      status: "ready",
      connections: [
        {
          key: "slack",
          provider: "Slack",
          category: "slack",
          authMethod: "OAuth",
          status: "ready",
          lastSync: "5 minutes ago",
          callsDiscovered: 0,
          callsRouted: 0,
          callsAwaitingRouting: 0,
          backfillComplete: true,
          lastError: null,
        },
        {
          key: "fireflies",
          provider: "Fireflies",
          authMethod: "OAuth",
          status: "disconnected",
          lastSync: null,
          callsDiscovered: 0,
          callsRouted: 0,
          callsAwaitingRouting: 0,
          backfillComplete: false,
          lastError: null,
        },
      ],
    });

    expect(html).toContain("Slack");
    expect(html).toContain("Connected");
    expect(html).toContain("Fireflies");
    expect(html).toContain("Available integration");
    expect(html).toContain("Disconnect");
    expect(html).toContain("Connect");
    expect(html).toContain("Docs");
    expect(html).not.toContain("Connect Slack and transcript sources");
    expect(html).not.toContain("Import a transcript");
    expect(html).not.toContain("Calls to route");
    expect(html).not.toContain("Connections table");
  });

  it("projects provider lifecycle state into canonical card labels", () => {
    const statuses = [
      ["authorizing", "Connecting"],
      ["syncing", "Connecting"],
      ["reauthorizing", "Connecting"],
      ["error", "Connection needs attention"],
      ["revoked", "Available integration"],
    ] as const;
    const html = render({
      status: "ready",
      connections: statuses.map(([status]) => ({
        key: status,
        provider: status,
        authMethod: "OAuth",
        status,
        lastSync: null,
        callsDiscovered: 0,
        callsRouted: 0,
        callsAwaitingRouting: 0,
        backfillComplete: false,
        lastError: "internal provider detail",
      })),
    });

    for (const [, label] of statuses) expect(html).toContain(label);
    expect(html).not.toContain("internal provider detail");
  });
});
