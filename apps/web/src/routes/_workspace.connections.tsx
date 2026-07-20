import { Card, Heading, Stack, Text } from "@saas-ui/react";
import { createFileRoute } from "@tanstack/react-router";

import { ChannelPolicyDialogSummary } from "../features/connections/channel-policy-dialog";
import { buildChannelPolicyRows } from "../features/connections/channel-policy-view-model";
import { ChannelTable } from "../features/connections/channel-table";
import { localChannelPolicyFixture } from "../features/connections/connections-adapter";
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

function ChannelPolicyCard() {
  return (
    <Card.Root borderRadius="md">
      <Card.Header>
        <Heading size="md">Slack channel policies</Heading>
        <Text color="gray.600" fontSize="sm">
          Bulk-select joined channels and apply immutable routing and delivery
          policies.
        </Text>
      </Card.Header>
      <Card.Body>
        <Stack gap="4">
          <ChannelTable
            rows={buildChannelPolicyRows(localChannelPolicyFixture.channels)}
          />
          <ChannelPolicyDialogSummary
            clientBrainCount={localChannelPolicyFixture.clientBrainCount}
            selectedChannelCount={
              localChannelPolicyFixture.selectedChannelCount
            }
          />
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
