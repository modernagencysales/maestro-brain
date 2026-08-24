import { Button, Page, Stack, Text } from "@saas-ui/react";
import { SimpleGrid } from "@chakra-ui/react";
import { FaSlack } from "react-icons/fa6";
import {
  LuAudioLines,
  LuExternalLink,
  LuNotebookTabs,
  LuRadio,
} from "react-icons/lu";
import type { IconType } from "react-icons";
import { IntegrationCard } from "../../components/integration-card/integration-card";
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
import { StateCard } from "../common/state-card";

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

const connectionPlaceholders = {
  loading: {
    title: "Loading connections",
    description: "Checking local connection state.",
  },
  empty: {
    title: "No connections yet",
    description: "No live transcript providers are connected yet.",
  },
  typed_failure: {
    title: "Connection setup unavailable",
    description: "The connection request failed a typed product contract.",
    tone: "yellow" as const,
  },
  transport_failure: {
    title: "Connection status interrupted",
    description: "Provider status could not be reached from this session.",
    tone: "red" as const,
  },
} as const;

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
  if (state.status !== "ready")
    return <StateCard {...connectionPlaceholders[state.status]} />;

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
      {state.connections.map((connection) => (
        <IntegrationCard
          key={connection.key}
          name={connection.provider}
          type={connectionType(connection)}
          icon={connectionIcon(connection.key)}
          description={connectionDescription(connection)}
          details={<ConnectionActivity connection={connection} />}
          actions={
            <ConnectionActions
              canManage={canManage}
              connection={connection}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onPurge={onPurge}
            />
          }
        />
      ))}
    </SimpleGrid>
  );
}

function ConnectionActions({
  canManage,
  connection,
  onConnect,
  onDisconnect,
  onPurge,
}: {
  readonly canManage: boolean;
  readonly connection: ConnectionRow;
  readonly onConnect?: (providerKey: string) => void | Promise<void>;
  readonly onDisconnect?: (providerKey: string) => void | Promise<void>;
  readonly onPurge?: (providerKey: string) => void | Promise<void>;
}) {
  const canDisconnect =
    connection.status !== "disconnected" &&
    connection.status !== "revoked" &&
    connection.disconnectAvailable !== false;
  const revoked = connection.status === "revoked";
  return (
    <>
      <NangoConnectButton
        enabled={canManage && !connection.cleanupPending}
        providerName={connection.provider}
        status={connectStatus(connection.status)}
        onConnect={() => onConnect?.(connection.key)}
      />
      {canDisconnect ? (
        <Button
          disabled={!canManage}
          onClick={() => onDisconnect?.(connection.key)}
          type="button"
          variant="outline"
        >
          Disconnect {connection.provider}
        </Button>
      ) : null}
      {revoked && connection.cleanupPending ? (
        <Button
          disabled={!canManage}
          onClick={() => onDisconnect?.(connection.key)}
          type="button"
          variant="outline"
        >
          Retry disconnect {connection.provider}
        </Button>
      ) : null}
      {revoked && !connection.cleanupPending && connection.purgeRequested ? (
        <Text color="yellow.700" fontSize="sm">
          Purge request pending review
        </Text>
      ) : null}
      {revoked && !connection.cleanupPending && !connection.purgeRequested ? (
        <Button
          disabled={!canManage}
          onClick={() => onPurge?.(connection.key)}
          type="button"
          variant="outline"
        >
          Request purge of {connection.provider} data
        </Button>
      ) : null}
      <Button asChild type="button" variant="ghost">
        <a
          href={connectionDocs(connection.key)}
          rel="noreferrer"
          target="_blank"
        >
          <LuExternalLink /> Docs
        </a>
      </Button>
    </>
  );
}

function ConnectionActivity({
  connection,
}: {
  readonly connection: ConnectionRow;
}) {
  if (connection.category === "slack")
    return (
      <Stack gap="1">
        <Text color="gray.600" fontSize="xs">
          {connection.authMethod} · Messages and Ask Apero
        </Text>
        {connection.lastError ? (
          <Text color="red.600" fontSize="xs">
            {connection.lastError}
          </Text>
        ) : null}
      </Stack>
    );
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
        {connection.authMethod} · {backfillStatus} · Last sync:{" "}
        {connection.lastSync ?? "Never"}
      </Text>
      {connection.lastError ? (
        <Text color="red.600" fontSize="xs">
          {connection.lastError}
        </Text>
      ) : null}
    </Stack>
  );
}

const connectionTypeByStatus = {
  disconnected: "Available integration",
  authorizing: "Connecting",
  syncing: "Connecting",
  ready: "Connected",
  error: "Connection needs attention",
  reauthorizing: "Connecting",
  revoked: "Available integration",
} as const satisfies Record<ConnectionRow["status"], string>;

const connectionType = (connection: ConnectionRow): string =>
  connectionTypeByStatus[connection.status];

const connectionDescription = (connection: ConnectionRow): string =>
  connection.category === "slack"
    ? "Bring company conversations and channel context into the Agency Brain."
    : `Import and route ${connection.provider} call transcripts into the right company or client Brain.`;

const connectionIcons: Readonly<Record<string, IconType>> = {
  slack: FaSlack,
  fireflies: LuRadio,
  gong: LuAudioLines,
  fathom: LuAudioLines,
  granola: LuNotebookTabs,
};

const connectionIcon = (key: string): IconType =>
  connectionIcons[key] ?? LuRadio;

const connectionDocs = (key: string): string =>
  ({
    slack: "https://api.slack.com/docs",
    fireflies: "https://docs.fireflies.ai/",
    gong: "https://gong.app.gong.io/settings/api/documentation",
    fathom: "https://developers.fathom.ai/",
    granola: "https://www.granola.ai/",
  })[key] ?? "https://docs.nango.dev/";

const connectStatusByConnectionStatus = {
  disconnected: "not_connected",
  authorizing: "authorizing",
  syncing: "verifying",
  ready: "active",
  error: "error",
  reauthorizing: "reauthorizing",
  revoked: "not_connected",
} as const satisfies Record<ConnectionRow["status"], SlackConnectStatus>;

const connectStatus = (status: ConnectionRow["status"]): SlackConnectStatus =>
  connectStatusByConnectionStatus[status];
