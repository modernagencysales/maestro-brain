import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { templateConfectRefs } from "@maestro-template/convex/refs";
import type { Ref } from "@confect/core";

import {
  useTemplateMutation,
  useTemplateQuery,
  type TemplateDataState,
} from "../adapters/confect-state";
import { unwrapBrainMutation } from "../features/brain/brain-surface";
import {
  type CallRoutingMutationState,
  type CallRoutingQueueState,
  type CallRoutingReview,
} from "../features/connections/call-routing-queue";
import { ConnectionsScreen } from "../features/connections/connections-screen";
import { useWorkspace } from "../providers/workspace";
import { BusinessAppShell, BusinessPageRoot } from "../saas-ui/business-shell";

export const Route = createFileRoute("/_workspace/connections")({
  component: ConnectionsRoute,
});

const callReviewRefs = templateConfectRefs.public.brain.callReview;
type RoutingQueueData = Ref.Returns<typeof callReviewRefs.listCallRoutingQueue>;

function ConnectionsRoute() {
  const workspace = useWorkspace();
  const [mutationState, setMutationState] =
    useState<CallRoutingMutationState>();
  const canReview =
    workspace.status === "ready" &&
    (workspace.activeWorkspace.role === "admin" ||
      workspace.activeWorkspace.role === "owner");
  const brainKey =
    workspace.status === "ready" ? workspace.activeWorkspace.workspaceId : null;
  const queue = useTemplateQuery(
    callReviewRefs.listCallRoutingQueue,
    canReview && brainKey !== null ? { brainKey } : "skip",
    { isEmpty: (data) => data.items.length === 0 },
  ) as TemplateDataState<RoutingQueueData, unknown>;
  const reviewRoute = useTemplateMutation(callReviewRefs.reviewCallRoute);
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
    setMutationState({ status: "pending", proposalKey: item.proposalKey });
    try {
      await unwrapBrainMutation(
        await reviewRoute({
          brainKey: brainKey!,
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
          state={{ status: "empty" }}
          onRoutingReview={review}
        />
      </BusinessPageRoot>
    </BusinessAppShell>
  );
}

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
