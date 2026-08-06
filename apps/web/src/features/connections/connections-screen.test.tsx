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
          key: "slack",
          provider: "Slack",
          status: "Ready",
          scope: "Agency workspace",
          lastSync: "5 minutes ago",
        },
      ],
    });

    expect(html).toContain("Connections");
    expect(html).toContain("Slack");
    expect(html).toContain("Agency workspace");
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
