import { Badge, Box, Table } from "@saas-ui/react";

import type { ChannelPolicyRow } from "./channel-policy-view-model";

export function ChannelTable({
  rows,
}: {
  readonly rows: readonly ChannelPolicyRow[];
}) {
  return (
    <Box aria-label="Slack channel policy table" overflowX="auto" tabIndex={0}>
      <Table.Root minW="720px">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Channel</Table.ColumnHeader>
            <Table.ColumnHeader>Routing</Table.ColumnHeader>
            <Table.ColumnHeader>Delivery</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={row.channelKey}>
              <Table.Cell fontWeight="medium">{row.label}</Table.Cell>
              <Table.Cell>{row.routingLabel}</Table.Cell>
              <Table.Cell>
                <Badge colorPalette={row.deliveryLocked ? "purple" : "green"}>
                  {row.deliveryLabel}
                </Badge>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
