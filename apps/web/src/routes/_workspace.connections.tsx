import { Stack } from "@saas-ui/react";
import { createFileRoute } from "@tanstack/react-router";

import { ChannelPolicyCard } from "../features/connections/channel-policy-dialog";
import { ConnectionsScreen } from "../features/connections/connections-screen";
import { BusinessAppShell, BusinessPageRoot } from "../saas-ui/business-shell";

export const Route = createFileRoute("/_workspace/connections")({
  component: ConnectionsRoute,
});

const initialConnectionsState = {
  status: "ready",
  connections: [
    {
      key: "slack",
      provider: "Slack",
      status: "Ready",
      scope: "Agency workspace",
      lastSync: "Local fixture",
    },
  ],
} as const;

function ConnectionsRoute() {
  return (
    <BusinessAppShell activePath="/connections">
      <BusinessPageRoot>
        <Stack gap="4">
          <ConnectionsScreen state={initialConnectionsState} />
          <ChannelPolicyCard />
        </Stack>
      </BusinessPageRoot>
    </BusinessAppShell>
  );
}
