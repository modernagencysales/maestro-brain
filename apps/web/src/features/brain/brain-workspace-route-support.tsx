import { Button, Page, Stack, Text } from "@saas-ui/react";

import {
  useTemplateMutation,
  type TemplateDataState,
} from "../../adapters/confect-state";
import { useWorkspace } from "../../providers/workspace";
import type {
  BrainCallMaintenanceQueueData,
  BrainPageDetail,
  BrainPageListData,
  BrainReviewQueueData,
  BrainSearchState,
  BrainSourcesSearchData,
} from "./brain-surface";
import {
  brainCallReviewRefs,
  toBrainSearchState,
  unwrapBrainMutation,
} from "./brain-surface";
import type {
  CallMaintenanceDecision,
  CallMaintenanceMutationState,
  CallMaintenanceReviewState,
} from "./call-maintenance-review";
import type { BrainReviewQueueState } from "./review-queue";
import type {
  BrainPageDetailState,
  BrainPageListState,
} from "./brain-workspace-types";

const restartWorkspaceSession = (
  signOut: (input: { readonly returnTo: string }) => unknown,
) => signOut({ returnTo: "/brain" });

export const routeWorkspaceContext = (
  workspace: ReturnType<typeof useWorkspace>,
) => {
  if (workspace.status !== "ready")
    return { brainKey: null, workspaceRole: "viewer" } as const;
  return {
    brainKey: workspace.activeWorkspace.workspaceId,
    workspaceRole: workspace.activeWorkspace.role,
  } as const;
};

export const requiredQueryArgs = <Args,>(
  requirements: readonly unknown[],
  args: Args,
): Args | "skip" =>
  requirements.some((value) => missingQueryValues.has(value)) ? "skip" : args;

const missingQueryValues = new Set<unknown>([null, undefined]);

export const selectedBrainPageKey = (
  list: TemplateDataState<BrainPageListData, unknown>,
  selectedPageKey: string | null,
): string | null | undefined => {
  if (list.status !== "ready") return null;
  return (
    list.data.pages.find(({ pageKey }) => pageKey === selectedPageKey)
      ?.pageKey ?? list.data.pages[0]?.pageKey
  );
};

export const firstExactCandidate = (
  state: TemplateDataState<BrainSourcesSearchData, unknown>,
) => (state.status === "ready" ? state.data.results[0] : undefined);

export const presentRouteSearchState = (
  query: string | null,
  state: TemplateDataState<BrainSourcesSearchData, unknown>,
): BrainSearchState =>
  query === null ? { status: "idle" } : toBrainSearchState(state, query);

const pageListDataStatuses = new Set(["ready", "empty"]);
const transientQueryStatuses = new Set(["loading", "skipped"]);

export const toBrainPageListState = (
  state: TemplateDataState<BrainPageListData, unknown>,
): BrainPageListState => {
  if (pageListDataStatuses.has(state.status))
    return state as BrainPageListState;
  if (transientQueryStatuses.has(state.status))
    return state as BrainPageListState;
  return { status: "failure", message: "The Brain page list request failed." };
};

export const toBrainPageDetailState = (
  state: TemplateDataState<BrainPageDetail, unknown>,
): BrainPageDetailState => {
  if (state.status === "ready") return state;
  if (transientQueryStatuses.has(state.status))
    return state as BrainPageDetailState;
  return { status: "failure", message: "The Brain page request failed." };
};

export const toBrainReviewQueueState = (
  state: TemplateDataState<BrainReviewQueueData, unknown>,
): BrainReviewQueueState => {
  if (state.status === "ready")
    return { status: "ready", items: state.data.items };
  return transientQueryStatuses.has(state.status)
    ? { status: "loading" }
    : { status: "failure", message: "Unable to load the Brain review queue." };
};

export const toCallMaintenanceReviewState = (
  role: "viewer" | "editor" | "admin" | "owner",
  state: TemplateDataState<BrainCallMaintenanceQueueData, unknown>,
  mutation?: CallMaintenanceMutationState,
): CallMaintenanceReviewState => {
  if (role === "viewer") return { status: "empty" };
  if (state.status === "ready")
    return readyCallMaintenanceState(state, mutation);
  if (state.status === "empty") return emptyCallMaintenanceState(mutation);
  return callMaintenanceQueryStates[state.status];
};

const readyCallMaintenanceState = (
  state: Extract<
    TemplateDataState<BrainCallMaintenanceQueueData, unknown>,
    { readonly status: "ready" }
  >,
  mutation?: CallMaintenanceMutationState,
): CallMaintenanceReviewState => ({
  status: "ready",
  items: state.data.items,
  ...(mutation ? { mutation } : {}),
});

const failedCallMaintenanceState = {
  status: "failure",
  message: "Unable to load call-backed Brain updates.",
} as const satisfies CallMaintenanceReviewState;

const callMaintenanceQueryStates = {
  loading: { status: "loading" },
  skipped: { status: "loading" },
  typed_failure: failedCallMaintenanceState,
  parse_failure: failedCallMaintenanceState,
  transport_failure: failedCallMaintenanceState,
  defect: failedCallMaintenanceState,
} as const satisfies Record<
  Exclude<TemplateDataState<unknown, unknown>["status"], "ready" | "empty">,
  CallMaintenanceReviewState
>;

const settledCallMaintenanceStatuses = new Set(["success", "failure"]);

const emptyCallMaintenanceState = (
  mutation?: CallMaintenanceMutationState,
): CallMaintenanceReviewState => {
  const settledMutation = mutation as
    | Extract<
        CallMaintenanceMutationState,
        { readonly status: "success" | "failure" }
      >
    | undefined;
  return settledMutation !== undefined &&
    settledCallMaintenanceStatuses.has(settledMutation.status)
    ? {
        status: "settled",
        outcome: settledMutation.status,
        message: settledMutation.message,
      }
    : { status: "empty" };
};

const callMaintenanceSuccessMessages = {
  reject: "Call updates rejected.",
  edit: "Edited call updates published.",
  accept: "Call updates published.",
} as const satisfies Record<CallMaintenanceDecision["action"], string>;

export const submitCallMaintenanceReview = async ({
  action,
  brainKey,
  edits,
  proposal,
  reviewCallMaintenance,
  setCallMaintenanceMutation,
}: CallMaintenanceDecision & {
  readonly brainKey: string;
  readonly reviewCallMaintenance: ReturnType<
    typeof useTemplateMutation<typeof brainCallReviewRefs.reviewCallMaintenance>
  >;
  readonly setCallMaintenanceMutation: (
    state: CallMaintenanceMutationState,
  ) => void;
}) => {
  setCallMaintenanceMutation({
    status: "pending",
    proposalKey: proposal.proposalKey,
  });
  try {
    await unwrapBrainMutation(
      await reviewCallMaintenance({
        brainKey,
        proposalKey: proposal.proposalKey,
        action,
        attemptKey: `call-review.${crypto.randomUUID()}`,
        expectedRouteGeneration: proposal.routeGeneration,
        expectedSourceLifecycleGeneration: proposal.sourceLifecycleGeneration,
        expectedWorkspaceLifecycleGeneration:
          proposal.workspaceLifecycleGeneration,
        edits,
      }),
    );
    setCallMaintenanceMutation({
      status: "success",
      message: callMaintenanceSuccessMessages[action],
    });
  } catch {
    setCallMaintenanceMutation({
      status: "failure",
      message: "Unable to publish call updates. Reload and try again.",
    });
  }
};

type UnavailableWorkspace = Exclude<
  ReturnType<typeof useWorkspace>,
  { readonly status: "ready" }
>;

export const UnavailableBrainWorkspaceRoute = ({
  signOut,
  workspace,
}: {
  readonly signOut: Parameters<typeof restartWorkspaceSession>[0];
  readonly workspace: UnavailableWorkspace;
}) => {
  const description = unavailableWorkspaceDescriptions[workspace.status];
  const recoveryMessage = workspaceRecoveryMessage(workspace);
  return (
    <Page.Root>
      <Page.Header title="Agency Brain" description={description} />
      <Page.Body px={{ base: "4", md: "6" }} pb="8">
        {recoveryMessage === null ? (
          <Text role="status">
            Brain will load automatically when setup completes.
          </Text>
        ) : (
          <Stack gap="3" align="flex-start">
            <Text role="alert">{recoveryMessage}</Text>
            <Button
              type="button"
              onClick={() => void restartWorkspaceSession(signOut)}
            >
              Sign in again
            </Button>
          </Stack>
        )}
      </Page.Body>
    </Page.Root>
  );
};

const unavailableWorkspaceDescriptions = {
  loading: "Loading your workspace.",
  provisioning: "Setting up your Agency Brain workspace.",
  failure: "Your workspace session needs attention.",
  empty: "Your workspace session needs attention.",
} as const;

const workspaceRecoveryMessage = (
  workspace: UnavailableWorkspace,
): string | null => {
  if (workspace.status === "failure") return workspace.message;
  return workspace.status === "empty"
    ? "Workspace setup did not finish."
    : null;
};
