import { templateConfectRefs } from "@maestro-template/convex/refs";
import { openNangoConnectWithSdk } from "@maestro-template/integrations/nango/connectBrowser";
import type { Ref } from "@confect/core";
import * as Either from "effect/Either";
import { useState } from "react";

import {
  useTemplateMutation,
  useTemplateAction,
  useTemplateQuery,
  type TemplateDataState,
} from "../../adapters/confect-state";
import { unwrapBrainMutation } from "../brain/brain-surface";
import {
  type CallRoutingMutationState,
  type CallRoutingQueueState,
  type CallRoutingReview,
} from "./call-routing-queue";
import {
  ConnectionsScreen,
  type ConnectionsScreenState,
} from "./connections-screen";
import type {
  TranscriptImportRequest,
  TranscriptImportState,
} from "./transcript-import";
import { startNangoConnect } from "./nango-connect-button";
import { useWorkspace } from "../../providers/workspace";
import {
  BusinessAppShell,
  BusinessPageRoot,
} from "../../saas-ui/business-shell";

const callReviewRefs = templateConfectRefs.public.brain.callReview;
const transcriptConnectionRefs =
  templateConfectRefs.public.integrations.transcriptConnections;
const transcriptSyncRefs =
  templateConfectRefs.public.integrations.transcriptSync;
const importTranscriptRef =
  templateConfectRefs.public.capabilities.importTranscript.importTranscript;
type RoutingQueueData = Ref.Returns<typeof callReviewRefs.listCallRoutingQueue>;
type ConnectionHealthData = Ref.Returns<
  typeof transcriptSyncRefs.listTranscriptConnectionHealth
>;
type TranscriptProvider = "fireflies" | "gong" | "fathom" | "granola";

const transcriptCatalog = [
  { key: "fireflies", name: "Fireflies", authMethod: "API key" },
  { key: "gong", name: "Gong", authMethod: "Access key + secret" },
  { key: "fathom", name: "Fathom", authMethod: "API key" },
  { key: "granola", name: "Granola", authMethod: "API token" },
] as const;

export function ConnectionsRouteAdapter() {
  const workspace = useWorkspace();
  const [mutationState, setMutationState] =
    useState<CallRoutingMutationState>();
  const [importState, setImportState] = useState<TranscriptImportState>({
    status: "idle",
  });
  const canReview =
    workspace.status === "ready" &&
    (workspace.activeWorkspace.role === "admin" ||
      workspace.activeWorkspace.role === "owner");
  const brainKey =
    workspace.status === "ready" ? workspace.activeWorkspace.workspaceId : null;
  const health = useTemplateQuery(
    transcriptSyncRefs.listTranscriptConnectionHealth,
    canReview ? {} : "skip",
    { isEmpty: () => false },
  ) as TemplateDataState<ConnectionHealthData, unknown>;
  const queue = useTemplateQuery(
    callReviewRefs.listCallRoutingQueue,
    canReview && brainKey !== null ? { brainKey } : "skip",
    { isEmpty: (data) => data.items.length === 0 },
  ) as TemplateDataState<RoutingQueueData, unknown>;
  const reviewRoute = useTemplateMutation(callReviewRefs.reviewCallRoute);
  const importTranscript = useTemplateMutation(importTranscriptRef);
  const requestTranscriptPurge = useTemplateMutation(
    transcriptConnectionRefs.requestTranscriptPurge,
  );
  const cancelTranscriptConnect = useTemplateMutation(
    transcriptConnectionRefs.cancelTranscriptConnect,
  );
  const beginTranscriptConnect = useTemplateAction(
    transcriptConnectionRefs.beginTranscriptConnect,
  );
  const completeTranscriptConnect = useTemplateAction(
    transcriptConnectionRefs.completeTranscriptConnect,
  );
  const disconnectTranscriptConnection = useTemplateAction(
    transcriptConnectionRefs.disconnectTranscriptConnection,
  );
  const routingQueue =
    workspace.status === "ready"
      ? toRoutingQueueState(
          queue,
          canReview,
          workspace.workspaces
            .filter(({ kind }) => kind === "client")
            .map(({ workspaceId }) => workspaceId),
          mutationState,
        )
      : ({ status: "loading" } as const);

  const review = async ({
    item,
    action,
    targetBrainKey,
    learnScope,
    learnValue,
  }: CallRoutingReview) => {
    if (brainKey === null) return;
    setMutationState({ status: "pending", proposalKey: item.proposalKey });
    try {
      await unwrapBrainMutation(
        await reviewRoute({
          brainKey,
          proposalKey: item.proposalKey,
          action,
          ...(targetBrainKey ? { targetBrainKey } : {}),
          ...(learnScope ? { learnScope } : {}),
          ...(learnValue ? { learnValue } : {}),
          attemptKey: `route-review.${crypto.randomUUID()}`,
          expectedUnitRevisionKey: item.unitRevisionKey,
          expectedRouteGeneration: item.routeGeneration,
          expectedSourceLifecycleGeneration: item.sourceLifecycleGeneration,
        }),
      );
      setMutationState({
        status: "success",
        message:
          action === "confirm" || action === "change_brain"
            ? "Call routed. Brain update processing started."
            : "Call routing review saved.",
      });
    } catch {
      setMutationState({
        status: "failure",
        message: "Unable to save the route. Reload and try again.",
      });
    }
  };

  const connect = async (provider: string) => {
    if (!transcriptCatalog.some(({ key }) => key === provider)) return;
    const transcriptProvider = provider as TranscriptProvider;
    await startNangoConnect({
      begin: async () =>
        unwrapActionResult(
          await beginTranscriptConnect({ provider: transcriptProvider }),
        ),
      open: ({ token }) =>
        openNangoConnectWithSdk({ connectSessionToken: token }),
      complete: async ({ connectionId, connectSessionId }) =>
        unwrapActionResult(
          await completeTranscriptConnect({
            provider: transcriptProvider,
            connectionId,
            connectSessionId,
          }),
        ),
      cancel: async ({ connectSessionId }) => {
        unwrapActionResult(
          await cancelTranscriptConnect({
            provider: transcriptProvider,
            connectSessionId,
          }),
        );
      },
    });
  };

  const importFile = async (input: TranscriptImportRequest) => {
    if (brainKey === null) return;
    setImportState({ status: "importing" });
    try {
      const result = await importTranscript({ brainKey, ...input });
      if (Either.isEither(result) && Either.isLeft(result)) {
        setImportState({ status: "typed_failure" });
        return;
      }
      setImportState({ status: "success" });
    } catch {
      setImportState({ status: "transport_failure" });
    }
  };

  const disconnect = async (provider: string) => {
    if (!transcriptCatalog.some(({ key }) => key === provider)) return;
    await unwrapActionResult(
      await disconnectTranscriptConnection({
        provider: provider as TranscriptProvider,
      }),
    );
  };

  const requestPurge = async (provider: string) => {
    if (!transcriptCatalog.some(({ key }) => key === provider)) return;
    await unwrapActionResult(
      await requestTranscriptPurge({
        provider: provider as TranscriptProvider,
      }),
    );
  };

  return (
    <BusinessAppShell activePath="/connections">
      <BusinessPageRoot>
        <ConnectionsScreen
          role={
            workspace.status === "ready"
              ? workspace.activeWorkspace.role
              : "viewer"
          }
          routingQueue={routingQueue}
          state={toConnectionsState(health, canReview)}
          onConnect={connect}
          onDisconnect={disconnect}
          onPurge={requestPurge}
          onRoutingReview={review}
          onTranscriptImport={importFile}
          transcriptImportState={importState}
          transcriptTargets={
            workspace.status === "ready"
              ? workspace.workspaces
                  .filter(({ kind }) => kind === "client")
                  .map(({ workspaceId, name }) => ({
                    brainKey: workspaceId,
                    name,
                  }))
              : []
          }
        />
      </BusinessPageRoot>
    </BusinessAppShell>
  );
}

const toConnectionsState = (
  health: TemplateDataState<ConnectionHealthData, unknown>,
  canReview: boolean,
): ConnectionsScreenState => {
  if (!canReview) return catalogState([]);
  if (health.status === "loading" || health.status === "skipped")
    return { status: "loading" };
  if (health.status === "typed_failure") return { status: "typed_failure" };
  if (
    health.status === "parse_failure" ||
    health.status === "transport_failure" ||
    health.status === "defect"
  )
    return { status: "transport_failure" };
  return catalogState(health.data);
};

const unwrapActionResult = <A, E>(result: A | Either.Either<A, E>): A => {
  if (!Either.isEither(result)) return result;
  if (Either.isLeft(result)) throw result.left;
  return result.right;
};

const catalogState = (
  health: ConnectionHealthData,
): ConnectionsScreenState => ({
  status: "ready",
  connections: transcriptCatalog.map((provider) => {
    const connected = health.find((item) => item.provider === provider.key);
    return {
      key: provider.key,
      provider: provider.name,
      authMethod: provider.authMethod,
      status: connected?.state ?? "disconnected",
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
});

const lastErrorLabel = (
  error:
    | "ProviderRateLimited"
    | "ProviderUnavailable"
    | "PermanentDecodeFailure"
    | "RevisionOrderConflict"
    | null,
): string | null => {
  switch (error) {
    case "ProviderRateLimited":
      return "Provider rate limit reached";
    case "ProviderUnavailable":
      return "Provider unavailable";
    case "PermanentDecodeFailure":
      return "Transcript response could not be decoded";
    case "RevisionOrderConflict":
      return "Transcript revision order conflict";
    case null:
      return null;
  }
};

const toRoutingQueueState = (
  state: TemplateDataState<RoutingQueueData, unknown>,
  canReview: boolean,
  availableBrainKeys: readonly string[],
  mutation?: CallRoutingMutationState,
): CallRoutingQueueState => {
  if (!canReview) return { status: "ready", items: [] };
  if (state.status === "ready")
    return {
      status: "ready",
      items: state.data.items.map((item) => ({
        ...item,
        candidateBrainKeys: [
          ...new Set([...item.candidateBrainKeys, ...availableBrainKeys]),
        ],
      })),
      ...(mutation ? { mutation } : {}),
    };
  if (state.status === "empty") return { status: "empty" };
  if (state.status === "loading" || state.status === "skipped")
    return { status: "loading" };
  return { status: "failure", message: "Unable to load calls to route." };
};
