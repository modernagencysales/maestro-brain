import { SimpleGrid } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import { FaSlack } from "react-icons/fa6";
import { LuAudioLines, LuNotebookTabs, LuRadio } from "react-icons/lu";

import { IntegrationCard } from "../../components/integration-card/integration-card";
import { StateCard } from "../common/state-card";
import type {
  CallRoutingQueueState,
  CallRoutingReview,
} from "./call-routing-queue";
import type {
  TranscriptImportRequest,
  TranscriptImportState,
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

const connectionPlaceholders = {
  loading: {
    title: "Loading connections",
    description: "Checking local connection state.",
  },
  empty: {
    title: "No connections yet",
    description: "No live providers are connected yet.",
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

type ConnectionsScreenProps = {
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
};

/** Exact Pro IntegrationCard screen; product operations stay behind callbacks. */
export function ConnectionsScreen({
  onConnect,
  onDisconnect,
  role = "viewer",
  state,
}: ConnectionsScreenProps) {
  if (state.status !== "ready") {
    return <StateCard {...connectionPlaceholders[state.status]} />;
  }

  const canManage = role === "admin" || role === "owner";

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
      {state.connections.map((connection) => (
        <IntegrationCard
          key={connection.key}
          name={connection.provider}
          type={connectionType(connection.status)}
          icon={connectionIcon(connection.key)}
          description={connectionDescription(connection)}
          docs={connectionDocs(connection.key)}
          isConnected={connection.status === "ready"}
          onConnect={canManage ? () => onConnect?.(connection.key) : undefined}
          onDisconnect={
            canManage ? () => onDisconnect?.(connection.key) : undefined
          }
          onDocs={() =>
            window.open(connectionDocs(connection.key), "_blank", "noopener")
          }
        />
      ))}
    </SimpleGrid>
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

const connectionType = (status: ConnectionRow["status"]): string =>
  connectionTypeByStatus[status];

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
