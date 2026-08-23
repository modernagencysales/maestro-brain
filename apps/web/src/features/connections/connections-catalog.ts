import { templateConfectRefs } from "@maestro-template/convex/refs";
import type { Ref } from "@confect/core";

import type { TemplateDataState } from "../../adapters/confect-state";
import type {
  ConnectionRow,
  ConnectionsScreenState,
} from "./connections-screen";

export type ConnectionHealthData = Ref.Returns<
  typeof templateConfectRefs.public.integrations.transcriptSync.listTranscriptConnectionHealth
>;
export type SlackConnectionData = Ref.Returns<
  typeof templateConfectRefs.public.integrations.slackConnections.getSlackConnectionStatus
>;

const transcriptCatalog = [
  { key: "fireflies", name: "Fireflies", authMethod: "API key" },
  { key: "gong", name: "Gong", authMethod: "Access key + secret" },
  { key: "fathom", name: "Fathom", authMethod: "API key" },
  { key: "granola", name: "Granola", authMethod: "API token" },
] as const;

const connectionStateByStatus = {
  loading: { status: "loading" },
  skipped: { status: "loading" },
  typed_failure: { status: "typed_failure" },
  parse_failure: { status: "transport_failure" },
  transport_failure: { status: "transport_failure" },
  defect: { status: "transport_failure" },
} as const satisfies Record<
  Exclude<TemplateDataState<unknown, unknown>["status"], "ready" | "empty">,
  ConnectionsScreenState
>;

const slackStatusForScreen = (
  status: SlackConnectionData["status"],
): ConnectionRow["status"] => {
  if (status === "not_connected") return "disconnected";
  if (status === "active") return "ready";
  if (status === "verifying") return "syncing";
  return status;
};

const transcriptErrorLabels = {
  ProviderRateLimited: "Provider rate limit reached",
  ProviderUnavailable: "Provider unavailable",
  PermanentDecodeFailure: "Transcript response could not be decoded",
  RevisionOrderConflict: "Transcript revision order conflict",
} as const;

const lastErrorLabel = (
  error: keyof typeof transcriptErrorLabels | null,
): string | null => (error === null ? null : transcriptErrorLabels[error]);

const catalogState = (
  health: ConnectionHealthData,
  slack: SlackConnectionData,
): ConnectionsScreenState => ({
  status: "ready",
  connections: [
    {
      key: "slack",
      provider: "Slack",
      category: "slack",
      authMethod: "OAuth via Nango",
      status: slackStatusForScreen(slack.status),
      lastSync: null,
      callsDiscovered: 0,
      callsRouted: 0,
      callsAwaitingRouting: 0,
      backfillComplete: false,
      disconnectAvailable: false,
      lastError: null,
    },
    ...transcriptCatalog.map((provider) => {
      const connected = health.find((item) => item.provider === provider.key);
      return {
        key: provider.key,
        provider: provider.name,
        category: "transcript" as const,
        authMethod: provider.authMethod,
        status: (connected?.state ?? "disconnected") as ConnectionRow["status"],
        lastSync:
          connected?.lastSuccessAt == null
            ? null
            : new Date(connected.lastSuccessAt).toLocaleString(),
        callsDiscovered: connected?.callsDiscovered ?? 0,
        callsRouted: connected?.callsRouted ?? 0,
        callsAwaitingRouting: connected?.callsAwaitingRouting ?? 0,
        backfillComplete: connected?.backfillComplete ?? false,
        cleanupPending: connected?.cleanupPending ?? false,
        disconnectAvailable: connected?.disconnectAvailable ?? false,
        purgeRequested: connected?.purgeRequested ?? false,
        lastError: connected?.cleanupPending
          ? "Provider cleanup pending"
          : lastErrorLabel(connected?.lastErrorTag ?? null),
      };
    }),
  ],
});

export const toConnectionsState = (
  health: TemplateDataState<ConnectionHealthData, unknown>,
  slack: TemplateDataState<SlackConnectionData, unknown>,
  canReview: boolean,
): ConnectionsScreenState => {
  if (slack.status !== "ready" && slack.status !== "empty")
    return connectionStateByStatus[slack.status];
  const state =
    health.status === "ready" || health.status === "empty"
      ? catalogState(health.data, slack.data)
      : connectionStateByStatus[health.status];
  return canReview
    ? state
    : catalogState([], {
        connectionKey: null,
        status: "not_connected",
        teamId: null,
      });
};
