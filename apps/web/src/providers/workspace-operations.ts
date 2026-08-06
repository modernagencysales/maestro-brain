import type { Ref } from "@confect/core";
import type { ReactMutation } from "@confect/react";
import * as Either from "effect/Either";

import type { TemplateDataState } from "../adapters/confect-state";
import {
  templateConfectRefs,
  type TemplateConfectRefs,
} from "@maestro-template/convex/refs";

import type { ClientAuthSnapshot } from "../auth/authkit-server";
import type { WorkspaceOperations, WorkspaceSummary } from "./workspace";

const demoWorkspace: WorkspaceSummary = {
  workspaceId: "br_01J0000000000000000000000B",
  organizationId: "ag_template_demo",
  kind: "agency",
  name: "Template Demo Workspace",
  slug: "template-demo",
  role: "owner",
  status: "active",
};

type WorkspaceListRef =
  TemplateConfectRefs["public"]["auth"]["workspaces"]["list"];
type EnsureProvisionedRef =
  TemplateConfectRefs["public"]["access"]["provisioning"]["ensureProvisioned"];

type WorkspaceLiveRefHooks = {
  readonly useQuery: (
    ref: WorkspaceListRef,
    args: Ref.Args<WorkspaceListRef>,
  ) => TemplateDataState<
    Ref.Returns<WorkspaceListRef>,
    Ref.Error<WorkspaceListRef>
  >;
  readonly useMutation: (
    ref: EnsureProvisionedRef,
  ) => ReactMutation<EnsureProvisionedRef>;
};

type LiveWorkspaceRefs = {
  readonly listResult: TemplateDataState<
    Ref.Returns<WorkspaceListRef>,
    Ref.Error<WorkspaceListRef>
  >;
  readonly ensureProvisioned: ReactMutation<EnsureProvisionedRef>;
};

export const workspaceOperationRefs: {
  readonly list: WorkspaceListRef;
  readonly ensureProvisioned: EnsureProvisionedRef;
} = {
  list: templateConfectRefs.public.auth.workspaces.list,
  ensureProvisioned:
    templateConfectRefs.public.access.provisioning.ensureProvisioned,
};

export const createWorkspaceLiveRefs = (
  hooks: WorkspaceLiveRefHooks,
): LiveWorkspaceRefs => ({
  listResult: hooks.useQuery(workspaceOperationRefs.list, {}),
  ensureProvisioned: hooks.useMutation(
    workspaceOperationRefs.ensureProvisioned,
  ),
});

export const createFakeWorkspaceOperations = (): WorkspaceOperations => ({
  loadWorkspaces: async () => [demoWorkspace],
  ensureProvisioned: async () => ({
    workspaceId: demoWorkspace.workspaceId,
  }),
});

export const createLiveWorkspaceOperations = (
  refs: LiveWorkspaceRefs,
): WorkspaceOperations => ({
  loadWorkspaces: async () => {
    if (refs.listResult.status !== "ready") {
      throw new Error("Authorized workspace list is not ready.");
    }
    return refs.listResult.data.map((workspace) => ({
      workspaceId: workspace.brainKey,
      organizationId: workspace.agencyKey,
      kind: workspace.kind,
      name: workspace.name,
      slug: workspace.clientSlug ?? workspace.brainKey,
      role: workspace.effectiveRole,
      status: workspace.status,
    }));
  },
  ensureProvisioned: async () => {
    const provisioned = await refs.ensureProvisioned({});
    if (Either.isLeft(provisioned)) {
      throw provisioned.left;
    }
    return { workspaceId: provisioned.right.brainKey };
  },
});

export const createFailClosedWorkspaceOperations = (): WorkspaceOperations => ({
  loadWorkspaces: async () => {
    throw new Error(
      "Live workspace operations require authorized Confect workspace refs.",
    );
  },
  ensureProvisioned: async () => {
    throw new Error(
      "Live workspace provisioning requires authorized Confect workspace refs.",
    );
  },
});

export type SafeWorkspaceRuntime = {
  readonly mode: "fake" | "live" | "test";
  readonly authSnapshot: ClientAuthSnapshot;
  readonly liveRefs?: LiveWorkspaceRefs;
};

export const createRuntimeWorkspaceOperations = (
  runtime: SafeWorkspaceRuntime,
): WorkspaceOperations => {
  if (runtime.mode === "fake") return createFakeWorkspaceOperations();
  if (runtime.authSnapshot.status !== "authenticated") {
    return createFailClosedWorkspaceOperations();
  }
  return runtime.liveRefs === undefined
    ? createFailClosedWorkspaceOperations()
    : createLiveWorkspaceOperations(runtime.liveRefs);
};
