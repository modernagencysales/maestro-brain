import {
  Badge,
  Box,
  Button,
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
import {
  TranscriptImport,
  type TranscriptImportRequest,
  type TranscriptImportState,
} from "./transcript-import";

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
  readonly category?: "slack" | "transcript";
  readonly authMethod: string;
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
  readonly backfillComplete: boolean;
  readonly cleanupPending?: boolean;
  readonly disconnectAvailable?: boolean;
  readonly purgeRequested?: boolean;
  readonly lastError: string | null;
};

export function ConnectionsScreen({
  onRoutingReview,
  onConnect,
  onDisconnect,
  onPurge,
  onTranscriptImport,
  role = "viewer",
  routingQueue,
  state,
  transcriptImportState = { status: "idle" },
  transcriptTargets = [],
}: {
  readonly onRoutingReview?: (
    review: CallRoutingReview,
  ) => void | Promise<void>;
  readonly onConnect?: (providerKey: string) => void | Promise<void>;
  readonly onDisconnect?: (providerKey: string) => void | Promise<void>;
  readonly onPurge?: (providerKey: string) => void | Promise<void>;
  readonly onTranscriptImport?: (
    input: TranscriptImportRequest,
  ) => void | Promise<void>;
  readonly role?: "viewer" | "editor" | "admin" | "owner";
  readonly routingQueue?: CallRoutingQueueState;
  readonly state: ConnectionsScreenState;
  readonly transcriptImportState?: TranscriptImportState;
  readonly transcriptTargets?: readonly {
    readonly brainKey: string;
    readonly name: string;
  }[];
}) {
  return (
    <>
      <Page.Header
        title="Connections"
        description="Connect Slack and transcript sources so company context stays current."
      />
      <Page.Body px={{ base: "4", md: "6" }} pb="8">
        <Stack gap="6">
          <ConnectionsStateCard
            state={state}
            canManage={role === "admin" || role === "owner"}
            {...(onConnect ? { onConnect } : {})}
            {...(onDisconnect ? { onDisconnect } : {})}
            {...(onPurge ? { onPurge } : {})}
          />
          <TranscriptImport
            role={role}
            state={transcriptImportState}
            targets={transcriptTargets}
            onImport={(input) => onTranscriptImport?.(input)}
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
  onDisconnect,
  onPurge,
  state,
}: {
  readonly canManage: boolean;
  readonly onConnect?: (providerKey: string) => void | Promise<void>;
  readonly onDisconnect?: (providerKey: string) => void | Promise<void>;
  readonly onPurge?: (providerKey: string) => void | Promise<void>;
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
              Nango manages provider authorization while Brain owns ingestion
              and routing.
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
                  <Table.Cell>
                    <Stack gap="0">
                      <Text fontWeight="medium">{connection.provider}</Text>
                      <Text color="gray.600" fontSize="xs">
                        {connection.authMethod}
                      </Text>
                    </Stack>
                  </Table.Cell>
                  <Table.Cell>
                    <Stack gap="1">
                      <Badge
                        alignSelf="flex-start"
                        colorPalette={statusTone(connection.status)}
                      >
                        {connection.status}
                      </Badge>
                      {connection.lastError ? (
                        <Text color="red.600" fontSize="xs">
                          {connection.lastError}
                        </Text>
                      ) : null}
                    </Stack>
                  </Table.Cell>
                  <Table.Cell>
                    <ConnectionActivity connection={connection} />
                  </Table.Cell>
                  <Table.Cell>{connection.lastSync ?? "Never"}</Table.Cell>
                  <Table.Cell>
                    <Flex gap="2" wrap="wrap">
                      <NangoConnectButton
                        enabled={canManage && !connection.cleanupPending}
                        providerName={connection.provider}
                        status={connectStatus(connection.status)}
                        onConnect={() => onConnect?.(connection.key)}
                      />
                      {connection.status !== "disconnected" &&
                      connection.status !== "revoked" &&
                      connection.disconnectAvailable !== false ? (
                        <Button
                          disabled={!canManage}
                          onClick={() => onDisconnect?.(connection.key)}
                          type="button"
                          variant="outline"
                        >
                          Disconnect {connection.provider}
                        </Button>
                      ) : null}
                      {connection.status === "revoked" &&
                      connection.cleanupPending ? (
                        <Button
                          disabled={!canManage}
                          onClick={() => onDisconnect?.(connection.key)}
                          type="button"
                          variant="outline"
                        >
                          Retry disconnect {connection.provider}
                        </Button>
                      ) : null}
                      {connection.status === "revoked" &&
                      !connection.cleanupPending &&
                      connection.purgeRequested ? (
                        <Text color="yellow.700" fontSize="sm">
                          Purge request pending review
                        </Text>
                      ) : null}
                      {connection.status === "revoked" &&
                      !connection.cleanupPending &&
                      !connection.purgeRequested ? (
                        <Button
                          disabled={!canManage}
                          onClick={() => onPurge?.(connection.key)}
                          type="button"
                          variant="outline"
                        >
                          Request purge of {connection.provider} data
                        </Button>
                      ) : null}
                    </Flex>
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

function ConnectionActivity({
  connection,
}: {
  readonly connection: ConnectionRow;
}) {
  if (connection.category === "slack")
    return <Text fontSize="sm">Messages and Ask Apero</Text>;
  const backfillStatus = connection.backfillComplete
    ? "Backfill complete"
    : connection.status === "disconnected"
      ? "Backfill not started"
      : "Backfill in progress";
  return (
    <Stack gap="1">
      <Text fontSize="sm">
        {connection.callsDiscovered} discovered · {connection.callsRouted}{" "}
        routed · {connection.callsAwaitingRouting} awaiting routing
      </Text>
      <Text color="gray.600" fontSize="xs">
        {backfillStatus}
      </Text>
    </Stack>
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
