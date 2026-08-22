import { useState } from "react";
import { useWorkosAuth } from "../../auth/workos-client-runtime";
import {
  useTemplateMutation,
  useTemplateQuery,
} from "../../adapters/confect-state";
import type { TemplateDataState } from "../../adapters/confect-state";
import { useWorkspace } from "../../providers/workspace";
import { Page } from "@saas-ui/react";
import type {
  BrainPageDetail,
  BrainPageListData,
  BrainCallMaintenanceQueueData,
  BrainReviewQueueData,
  BrainRevisionHistoryData,
} from "./brain-surface";
import type { CallMaintenanceMutationState } from "./call-maintenance-review";
import { type BrainRevisionHistoryState } from "./revision-history";
import {
  brainReadApiRefs,
  brainPilotRefs,
  brainCallReviewRefs,
  brainWorkspaceRefs,
  createBrainWorkspaceAdapter,
  toBrainContextState,
  toBrainSourceState,
  unwrapBrainMutation,
} from "./brain-surface";
import { BrainWorkspace } from "./brain-workspace-view";
import {
  UnavailableBrainWorkspaceRoute,
  exactSourceQueryArgs,
  firstExactCandidate,
  presentRouteSearchState,
  requiredQueryArgs,
  routeWorkspaceContext,
  selectedBrainPageKey,
  submitCallMaintenanceReview,
  toBrainPageDetailState,
  toBrainPageListState,
  toBrainReviewQueueState,
  toCallMaintenanceReviewState,
} from "./brain-workspace-route-support";

export { createBrainWorkspaceActions } from "./brain-workspace-actions";
export type {
  BrainPageDetailState,
  BrainPageListState,
  BrainReviewNotice,
  BrainWorkspaceActionState,
} from "./brain-workspace-types";
export { BrainWorkspace } from "./brain-workspace-view";

const toRevisionHistoryState = (
  state: TemplateDataState<BrainRevisionHistoryData, unknown>,
): BrainRevisionHistoryState => {
  if (state.status === "ready") return { status: "ready", data: state.data };
  if (state.status === "loading" || state.status === "skipped")
    return { status: "loading" };
  return { status: "failure", message: "Unable to load revision history." };
};

export const recoverWorkspaceSession = (
  signOut: (input: { readonly returnTo: string }) => unknown,
) => signOut({ returnTo: "/brain" });

export const BrainWorkspaceRoute = () => {
  const { signOut } = useWorkosAuth();
  const workspace = useWorkspace();
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [selectedPageKey, setSelectedPageKey] = useState<string | null>(null);
  const [callMaintenanceMutation, setCallMaintenanceMutation] =
    useState<CallMaintenanceMutationState>();
  const { brainKey, workspaceRole } = routeWorkspaceContext(workspace);
  const list = useTemplateQuery(
    brainWorkspaceRefs.list,
    requiredQueryArgs([brainKey], { brainKey: brainKey ?? "" }),
    { isEmpty: (data: BrainPageListData) => data.pages.length === 0 },
  ) as TemplateDataState<BrainPageListData, unknown>;
  const selected = selectedBrainPageKey(list, selectedPageKey);
  const detail = useTemplateQuery(
    brainWorkspaceRefs.get,
    requiredQueryArgs([brainKey, selected], {
      brainKey: brainKey ?? "",
      pageKey: selected ?? "",
    }),
  ) as TemplateDataState<BrainPageDetail, unknown>;
  const history = useTemplateQuery(
    brainWorkspaceRefs.history,
    requiredQueryArgs([brainKey, selected], {
      brainKey: brainKey ?? "",
      pageKey: selected ?? "",
      limit: 50,
    }),
  ) as TemplateDataState<BrainRevisionHistoryData, unknown>;
  const create = useTemplateMutation(brainWorkspaceRefs.create);
  const rename = useTemplateMutation(brainWorkspaceRefs.rename);
  const favorite = useTemplateMutation(brainWorkspaceRefs.favorite);
  const archive = useTemplateMutation(brainWorkspaceRefs.archive);
  const move = useTemplateMutation(brainWorkspaceRefs.move);
  const restore = useTemplateMutation(brainWorkspaceRefs.restore);
  const submitNote = useTemplateMutation(brainPilotRefs.submitNote);
  const reviewNote = useTemplateMutation(brainPilotRefs.reviewNote);
  const reviewCallMaintenance = useTemplateMutation(
    brainCallReviewRefs.reviewCallMaintenance,
  );
  const updatePage = useTemplateMutation(brainPilotRefs.updatePage);
  const sourcesSearch = useTemplateQuery(
    brainReadApiRefs.sourcesSearch,
    requiredQueryArgs([brainKey, searchQuery], {
      brainKey: brainKey ?? "",
      query: searchQuery ?? "",
    }),
  );
  const contextPack = useTemplateQuery(
    brainReadApiRefs.contextGet,
    requiredQueryArgs([brainKey, searchQuery], {
      brainKey: brainKey ?? "",
      question: searchQuery ?? "",
    }),
  );
  const exactCandidate = firstExactCandidate(sourcesSearch);
  const exactSource = useTemplateQuery(
    brainReadApiRefs.sourcesGet,
    brainKey === null || exactCandidate === undefined
      ? "skip"
      : exactSourceQueryArgs(brainKey, exactCandidate),
  );
  const queue = useTemplateQuery(
    brainPilotRefs.listReviewQueue,
    requiredQueryArgs([brainKey], { brainKey: brainKey ?? "" }),
  ) as TemplateDataState<BrainReviewQueueData, unknown>;
  const callMaintenanceQueue = useTemplateQuery(
    brainCallReviewRefs.listCallMaintenanceQueue,
    requiredQueryArgs(
      [brainKey, workspaceRole === "viewer" ? null : workspaceRole],
      { brainKey: brainKey ?? "" },
    ),
    {
      isEmpty: (data: BrainCallMaintenanceQueueData) => data.items.length === 0,
    },
  ) as TemplateDataState<BrainCallMaintenanceQueueData, unknown>;

  if (workspace.status !== "ready") {
    return (
      <UnavailableBrainWorkspaceRoute signOut={signOut} workspace={workspace} />
    );
  }

  const listState = toBrainPageListState(list);
  const detailState = toBrainPageDetailState(detail);
  const reviewQueue = toBrainReviewQueueState(queue);
  const callMaintenanceReview = toCallMaintenanceReviewState(
    workspace.activeWorkspace.role,
    callMaintenanceQueue,
    callMaintenanceMutation,
  );
  const adapter = createBrainWorkspaceAdapter({
    brainKey: workspace.activeWorkspace.workspaceId,
    canEdit: workspace.activeWorkspace.role !== "viewer",
    mutations: { create, rename, favorite, archive, move },
    pilot: {
      submitNote: async (input) =>
        unwrapBrainMutation(
          await submitNote({
            brainKey: workspace.activeWorkspace.workspaceId,
            ...input,
          }),
        ),
      reviewNote: async (input) =>
        unwrapBrainMutation(
          await reviewNote({
            brainKey: workspace.activeWorkspace.workspaceId,
            ...input,
          }),
        ),
    },
    movePage: async ({
      pageKey,
      expectedCurrentRevisionKey,
      parentPageKey,
      sortKey,
    }) =>
      unwrapBrainMutation(
        await move({
          brainKey: workspace.activeWorkspace.workspaceId,
          pageKey,
          expectedCurrentRevisionKey,
          parentPageKey,
          sortKey,
        }),
      ),
    restorePage: async (input) => unwrapBrainMutation(await restore(input)),
    updatePage:
      detail.status === "ready"
        ? async ({ pageKey, expectedCurrentRevisionKey, markdown }) =>
            unwrapBrainMutation(
              await updatePage({
                brainKey: workspace.activeWorkspace.workspaceId,
                pageKey,
                expectedCurrentRevisionKey,
                markdown,
              }),
            )
        : undefined,
  });

  return (
    <Page.Root>
      <Page.Header
        title="Agency Brain"
        description="Review and edit source-grounded workspace knowledge."
      />
      <Page.Body px={{ base: "4", md: "6" }} pb="8">
        <BrainWorkspace
          adapter={adapter}
          detail={detailState}
          list={listState}
          selectedPageKey={selected ?? undefined}
          onSelectPage={setSelectedPageKey}
          history={toRevisionHistoryState(history)}
          reviewQueue={reviewQueue}
          callMaintenanceReview={callMaintenanceReview}
          role={workspace.activeWorkspace.role}
          onCallMaintenanceReview={async ({ proposal, action, edits }) => {
            await submitCallMaintenanceReview({
              action,
              brainKey: workspace.activeWorkspace.workspaceId,
              edits,
              proposal,
              reviewCallMaintenance,
              setCallMaintenanceMutation,
            });
          }}
          onSearch={(query) => {
            setSearchQuery(query);
          }}
          search={presentRouteSearchState(searchQuery, sourcesSearch)}
          context={toBrainContextState(contextPack)}
          source={toBrainSourceState(exactSource)}
        />
      </Page.Body>
    </Page.Root>
  );
};
