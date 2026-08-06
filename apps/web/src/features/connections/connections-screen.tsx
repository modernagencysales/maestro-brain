import {
  Badge,
  Box,
  Card,
  Flex,
  Heading,
  Page,
  Stack,
  Table,
  Text,
} from "@saas-ui/react";
import {
  NangoConnectButton,
  type SlackConnectStatus,
} from "./nango-connect-button";
import {
  CallRoutingQueue,
  type CallRoutingQueueState,
  type CallRoutingReview,
} from "./call-routing-queue";

export type ConnectionsScreenState =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "typed_failure" }
  | { readonly status: "transport_failure" }
  | {
      readonly status: "ready";
      readonly connections: readonly ConnectionRow[];
    };

export type ConnectionRow = {
  readonly key: string;
  readonly provider: string;
  readonly status:
    | "disconnected"
    | "authorizing"
    | "syncing"
    | "ready"
    | "error"
    | "reauthorizing"
    | "revoked";
  readonly lastSync: string | null;
  readonly callsDiscovered: number;
  readonly callsRouted: number;
  readonly callsAwaitingRouting: number;
};

export function ConnectionsScreen({
  onRoutingReview,
  onConnect,
  role = "viewer",
  routingQueue,
  state,
}: {
  readonly onRoutingReview?: (
    review: CallRoutingReview,
  ) => void | Promise<void>;
  readonly onConnect?: (providerKey: string) => void | Promise<void>;
  readonly role?: "viewer" | "editor" | "admin" | "owner";
  readonly routingQueue?: CallRoutingQueueState;
  readonly state: ConnectionsScreenState;
}) {
  return (
    <>
      <Page.Header
        title="Connections"
        description="Connect transcript sources and route completed calls into the right Client Brain."
      />
      <Page.Body px={{ base: "4", md: "6" }} pb="8">
        <Stack gap="6">
          <ConnectionsStateCard
            state={state}
            canManage={role === "admin" || role === "owner"}
            {...(onConnect ? { onConnect } : {})}
          />
          {routingQueue ? (
            <CallRoutingQueue
              role={role}
              state={routingQueue}
              onReview={(review) => onRoutingReview?.(review)}
            />
          ) : null}
        </Stack>
      </Page.Body>
    </>
  );
}

function ConnectionsStateCard({
  canManage,
  onConnect,
  state,
}: {
  readonly canManage: boolean;
  readonly onConnect?: (providerKey: string) => void | Promise<void>;
  readonly state: ConnectionsScreenState;
}) {
  if (state.status === "loading") {
    return (
      <StateCard
        title="Loading connections"
        description="Checking local connection state."
      />
    );
  }

  if (state.status === "empty") {
    return (
      <StateCard
        title="No connections yet"
        description="No live transcript providers are connected yet."
      />
    );
  }

  if (state.status === "typed_failure") {
    return (
      <StateCard
        title="Connection setup unavailable"
        description="The connection request failed a typed product contract."
        tone="yellow"
      />
    );
  }

  if (state.status === "transport_failure") {
    return (
      <StateCard
        title="Connection status interrupted"
        description="Provider status could not be reached from this session."
        tone="red"
      />
    );
  }

  return (
    <Card.Root borderRadius="md">
      <Card.Header>
        <Flex align="center" justify="space-between" gap="3">
          <Box>
            <Heading size="md">Workspace connections</Heading>
            <Text color="gray.600" fontSize="sm">
              Provider posture without marketplace or campaign surfaces.
            </Text>
          </Box>
          <Badge colorPalette="green">Ready</Badge>
        </Flex>
      </Card.Header>
      <Card.Body pt="0">
        <Box aria-label="Connections table" overflowX="auto" tabIndex={0}>
          <Table.Root minW="640px">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Provider</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Calls</Table.ColumnHeader>
                <Table.ColumnHeader>Last sync</Table.ColumnHeader>
                <Table.ColumnHeader>Action</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {state.connections.map((connection) => (
                <Table.Row key={connection.key}>
                  <Table.Cell fontWeight="medium">
                    {connection.provider}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge colorPalette={statusTone(connection.status)}>
                      {connection.status}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="sm">
                      {connection.callsDiscovered} discovered ·{" "}
                      {connection.callsRouted} routed ·{" "}
                      {connection.callsAwaitingRouting} awaiting routing
                    </Text>
                  </Table.Cell>
                  <Table.Cell>{connection.lastSync ?? "Never"}</Table.Cell>
                  <Table.Cell>
                    <NangoConnectButton
                      enabled={canManage}
                      providerName={connection.provider}
                      status={connectStatus(connection.status)}
                      onConnect={() => onConnect?.(connection.key)}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      </Card.Body>
    </Card.Root>
  );
}

const statusTone = (status: ConnectionRow["status"]) =>
  status === "ready"
    ? "green"
    : status === "error" || status === "revoked"
      ? "red"
      : status === "disconnected"
        ? "gray"
        : "yellow";

const connectStatus = (status: ConnectionRow["status"]): SlackConnectStatus =>
  status === "ready"
    ? "active"
    : status === "syncing"
      ? "verifying"
      : status === "disconnected" || status === "revoked"
        ? "not_connected"
        : status;

function StateCard({
  description,
  title,
  tone = "blue",
}: {
  readonly description: string;
  readonly title: string;
  readonly tone?: "blue" | "red" | "yellow";
}) {
  return (
    <Card.Root borderRadius="md">
      <Card.Body>
        <Stack gap="3">
          <Badge alignSelf="flex-start" colorPalette={tone}>
            {title}
          </Badge>
          <Heading size="md">{title}</Heading>
          <Text color="gray.600">{description}</Text>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
