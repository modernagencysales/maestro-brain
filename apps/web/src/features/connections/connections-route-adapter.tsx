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
import { Page } from "@saas-ui/react";

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
const routingRoles = new Set(["admin", "owner"]);
const routedActions = new Set<CallRoutingReview["action"]>([
  "confirm",
  "change_brain",
]);

export function ConnectionsRouteAdapter() {
  const workspace = useWorkspace();
  const workspaceView = connectionsWorkspaceView(workspace);
  const [mutationState, setMutationState] =
    useState<CallRoutingMutationState>();
  const [importState, setImportState] = useState<TranscriptImportState>({
    status: "idle",
  });
  const health = useTemplateQuery(
    transcriptSyncRefs.listTranscriptConnectionHealth,
    workspaceView.canReview ? {} : "skip",
    { isEmpty: () => false },
  ) as TemplateDataState<ConnectionHealthData, unknown>;
  const queue = useTemplateQuery(
    callReviewRefs.listCallRoutingQueue,
    workspaceView.brainKey === null || !workspaceView.canReview
      ? "skip"
      : { brainKey: workspaceView.brainKey },
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
  const routingQueue = workspaceView.ready
    ? toRoutingQueueState(
        queue,
        workspaceView.canReview,
        workspaceView.availableBrainKeys,
        mutationState,
      )
    : ({ status: "loading" } as const);

  return (
    <Page.Root>
      <ConnectionsScreen
        role={workspaceView.role}
        routingQueue={routingQueue}
        state={toConnectionsState(health, workspaceView.canReview)}
        onConnect={(provider) =>
          connectTranscriptProvider(provider, {
            beginTranscriptConnect,
            cancelTranscriptConnect,
            completeTranscriptConnect,
          })
        }
        onDisconnect={(provider) =>
          runTranscriptProviderOperation(
            provider,
            disconnectTranscriptConnection,
          )
        }
        onPurge={(provider) =>
          runTranscriptProviderOperation(provider, requestTranscriptPurge)
        }
        onRoutingReview={(review) =>
          reviewCallRoute({
            brainKey: workspaceView.brainKey,
            review,
            reviewRoute,
            setMutationState,
          })
        }
        onTranscriptImport={(input) =>
          importTranscriptFile({
            brainKey: workspaceView.brainKey,
            importTranscript,
            input,
            setImportState,
          })
        }
        transcriptImportState={importState}
        transcriptTargets={workspaceView.transcriptTargets}
      />
    </Page.Root>
  );
}

type ConnectionsWorkspace = ReturnType<typeof useWorkspace>;

const connectionsWorkspaceView = (workspace: ConnectionsWorkspace) => {
  if (workspace.status !== "ready")
    return {
      ready: false,
      canReview: false,
      brainKey: null,
      role: "viewer",
      availableBrainKeys: [],
      transcriptTargets: [],
    } as const;
  const clientWorkspaces = workspace.workspaces.filter(
    ({ kind }) => kind === "client",
  );
  const role = workspace.activeWorkspace.role;
  return {
    ready: true,
    canReview: routingRoles.has(role),
    brainKey: workspace.activeWorkspace.workspaceId,
    role,
    availableBrainKeys: clientWorkspaces.map(({ workspaceId }) => workspaceId),
    transcriptTargets: clientWorkspaces.map(({ workspaceId, name }) => ({
      brainKey: workspaceId,
      name,
    })),
  } as const;
};

const reviewCallRoute = async ({
  brainKey,
  review,
  reviewRoute,
  setMutationState,
}: {
  readonly brainKey: string | null;
  readonly review: CallRoutingReview;
  readonly reviewRoute: ReturnType<
    typeof useTemplateMutation<typeof callReviewRefs.reviewCallRoute>
  >;
  readonly setMutationState: (state: CallRoutingMutationState) => void;
}) => {
  if (brainKey === null) return;
  setMutationState({
    status: "pending",
    proposalKey: review.item.proposalKey,
  });
  try {
    await unwrapBrainMutation(
      await reviewRoute(routingReviewArgs(brainKey, review)),
    );
    setMutationState({
      status: "success",
      message: routingReviewSuccessMessage(review.action),
    });
  } catch {
    setMutationState({
      status: "failure",
      message: "Unable to save the route. Reload and try again.",
    });
  }
};

const routingReviewArgs = (
  brainKey: string,
  { item, action, targetBrainKey, learnScope, learnValue }: CallRoutingReview,
) => ({
  brainKey,
  proposalKey: item.proposalKey,
  action,
  ...definedRoutingReviewArgs({ targetBrainKey, learnScope, learnValue }),
  attemptKey: `route-review.${crypto.randomUUID()}`,
  expectedUnitRevisionKey: item.unitRevisionKey,
  expectedRouteGeneration: item.routeGeneration,
  expectedSourceLifecycleGeneration: item.sourceLifecycleGeneration,
});

const definedRoutingReviewArgs = (
  values: Pick<
    CallRoutingReview,
    "targetBrainKey" | "learnScope" | "learnValue"
  >,
) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => Boolean(value)),
  );

const routingReviewSuccessMessage = (
  action: CallRoutingReview["action"],
): string =>
  routedActions.has(action)
    ? "Call routed. Brain update processing started."
    : "Call routing review saved.";

const asTranscriptProvider = (
  provider: string,
): TranscriptProvider | undefined =>
  transcriptCatalog.find(({ key }) => key === provider)?.key;

const connectTranscriptProvider = async (
  provider: string,
  actions: {
    readonly beginTranscriptConnect: ReturnType<
      typeof useTemplateAction<
        typeof transcriptConnectionRefs.beginTranscriptConnect
      >
    >;
    readonly cancelTranscriptConnect: ReturnType<
      typeof useTemplateMutation<
        typeof transcriptConnectionRefs.cancelTranscriptConnect
      >
    >;
    readonly completeTranscriptConnect: ReturnType<
      typeof useTemplateAction<
        typeof transcriptConnectionRefs.completeTranscriptConnect
      >
    >;
  },
) => {
  const transcriptProvider = asTranscriptProvider(provider);
  if (transcriptProvider === undefined) return;
  await startNangoConnect({
    begin: async () =>
      unwrapActionResult(
        await actions.beginTranscriptConnect({ provider: transcriptProvider }),
      ),
    open: ({ token }) =>
      openNangoConnectWithSdk({ connectSessionToken: token }),
    complete: async ({ connectionId, connectSessionId }) =>
      unwrapActionResult(
        await actions.completeTranscriptConnect({
          provider: transcriptProvider,
          connectionId,
          connectSessionId,
        }),
      ),
    cancel: async ({ connectSessionId }) => {
      unwrapActionResult(
        await actions.cancelTranscriptConnect({
          provider: transcriptProvider,
          connectSessionId,
        }),
      );
    },
  });
};

const importTranscriptFile = async ({
  brainKey,
  importTranscript,
  input,
  setImportState,
}: {
  readonly brainKey: string | null;
  readonly importTranscript: ReturnType<
    typeof useTemplateMutation<typeof importTranscriptRef>
  >;
  readonly input: TranscriptImportRequest;
  readonly setImportState: (state: TranscriptImportState) => void;
}) => {
  if (brainKey === null) return;
  setImportState({ status: "importing" });
  try {
    const result = await importTranscript({ brainKey, ...input });
    setImportState({
      status:
        Either.isEither(result) && Either.isLeft(result)
          ? "typed_failure"
          : "success",
    });
  } catch {
    setImportState({ status: "transport_failure" });
  }
};

const runTranscriptProviderOperation = async (
  provider: string,
  operation: (input: { readonly provider: TranscriptProvider }) => unknown,
) => {
  const transcriptProvider = asTranscriptProvider(provider);
  if (transcriptProvider === undefined) return;
  await unwrapActionResult(await operation({ provider: transcriptProvider }));
};

const toConnectionsState = (
  health: TemplateDataState<ConnectionHealthData, unknown>,
  canReview: boolean,
): ConnectionsScreenState => {
  const state =
    health.status === "ready" || health.status === "empty"
      ? catalogState(health.data)
      : connectionStateByStatus[health.status];
  return canReview ? state : catalogState([]);
};

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
  return error === null ? null : transcriptErrorLabels[error];
};

const transcriptErrorLabels = {
  ProviderRateLimited: "Provider rate limit reached",
  ProviderUnavailable: "Provider unavailable",
  PermanentDecodeFailure: "Transcript response could not be decoded",
  RevisionOrderConflict: "Transcript revision order conflict",
} as const;

const toRoutingQueueState = (
  state: TemplateDataState<RoutingQueueData, unknown>,
  canReview: boolean,
  availableBrainKeys: readonly string[],
  mutation?: CallRoutingMutationState,
): CallRoutingQueueState => {
  const queue =
    state.status === "ready"
      ? readyRoutingQueue(state.data, availableBrainKeys, mutation)
      : routingQueueByStatus[state.status];
  return canReview ? queue : { status: "ready", items: [] };
};

const routingQueueFailure = {
  status: "failure",
  message: "Unable to load calls to route.",
} as const satisfies CallRoutingQueueState;

const routingQueueByStatus = {
  empty: { status: "empty" },
  loading: { status: "loading" },
  skipped: { status: "loading" },
  typed_failure: routingQueueFailure,
  parse_failure: routingQueueFailure,
  transport_failure: routingQueueFailure,
  defect: routingQueueFailure,
} as const satisfies Record<
  Exclude<TemplateDataState<unknown, unknown>["status"], "ready">,
  CallRoutingQueueState
>;

const readyRoutingQueue = (
  data: RoutingQueueData,
  availableBrainKeys: readonly string[],
  mutation?: CallRoutingMutationState,
): CallRoutingQueueState => ({
  status: "ready",
  items: data.items.map((item) => ({
    ...item,
    candidateBrainKeys: [
      ...new Set([...item.candidateBrainKeys, ...availableBrainKeys]),
    ],
  })),
  ...(mutation ? { mutation } : {}),
});
