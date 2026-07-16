import { Badge, Box, Table } from "@saas-ui/react";
import type { ClientRow } from "./clients-screen";

export function ClientsTable({
  clients,
}: {
  readonly clients: readonly ClientRow[];
}) {
  return (
    <Box aria-label="Clients table" overflowX="auto" tabIndex={0}>
      <Table.Root minW="760px">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Client</Table.ColumnHeader>
            <Table.ColumnHeader>Connection health</Table.ColumnHeader>
            <Table.ColumnHeader>Freshness</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Connections</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">
              Recent changes
            </Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {clients.map((client) => (
            <Table.Row key={client.key}>
              <Table.Cell fontWeight="medium">{client.name}</Table.Cell>
              <Table.Cell>
                <Badge
                  colorPalette={
                    client.health === "Connected" ? "green" : "gray"
                  }
                >
                  {client.health}
                </Badge>
              </Table.Cell>
              <Table.Cell>{client.freshness}</Table.Cell>
              <Table.Cell textAlign="end">{client.connections}</Table.Cell>
              <Table.Cell textAlign="end">{client.recentChanges}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
