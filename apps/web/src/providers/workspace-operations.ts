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
    switch (refs.listResult.status) {
      case "ready":
      case "empty":
        return refs.listResult.data.map(toWorkspaceSummary);
      case "loading":
      case "skipped":
        throw new Error("Workspace list query is still loading.");
      case "typed_failure":
      case "parse_failure":
      case "transport_failure":
      case "defect":
        throw workspaceListFailure(refs.listResult);
    }
  },
  ensureProvisioned: async () => {
    const provisioned = await refs.ensureProvisioned({});
    if (Either.isLeft(provisioned)) {
      throw provisioned.left;
    }
    return { workspaceId: provisioned.right.brainKey };
  },
});

export const isWorkspaceListPending = (
  result: LiveWorkspaceRefs["listResult"],
): boolean => result.status === "loading" || result.status === "skipped";

const toWorkspaceSummary = (
  workspace: Ref.Returns<WorkspaceListRef>[number],
): WorkspaceSummary => ({
  workspaceId: workspace.brainKey,
  organizationId: workspace.agencyKey,
  kind: workspace.kind,
  name: workspace.name,
  slug: workspace.clientSlug ?? workspace.brainKey,
  role: workspace.effectiveRole,
  status: workspace.status,
});

const workspaceListFailure = (
  result: Extract<
    LiveWorkspaceRefs["listResult"],
    {
      readonly status:
        "typed_failure" | "parse_failure" | "transport_failure" | "defect";
    }
  >,
): Error => {
  const error: unknown = result.error;
  if (error instanceof Error) return error;
  if (result.status !== "typed_failure") return new Error(result.message);
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return new Error(error.message);
  }
  return new Error("Workspace list query failed.");
};

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

export type RuntimeWorkspaceOperationsCache = {
  readonly runtime: SafeWorkspaceRuntime;
  readonly operations: WorkspaceOperations;
};

export const reuseRuntimeWorkspaceOperations = (
  previous: RuntimeWorkspaceOperationsCache | undefined,
  runtime: SafeWorkspaceRuntime,
): RuntimeWorkspaceOperationsCache => {
  if (previous && sameWorkspaceRuntime(previous.runtime, runtime)) {
    return previous;
  }

  return {
    runtime,
    operations: createRuntimeWorkspaceOperations(runtime),
  };
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

const sameWorkspaceRuntime = (
  left: SafeWorkspaceRuntime,
  right: SafeWorkspaceRuntime,
): boolean => {
  if (left.mode !== right.mode) return false;
  if (left.mode === "fake") return true;
  if (left.authSnapshot.status !== right.authSnapshot.status) return false;
  if (left.authSnapshot.status !== "authenticated") return true;

  return sameLiveWorkspaceRefs(left.liveRefs, right.liveRefs);
};

const sameLiveWorkspaceRefs = (
  left: LiveWorkspaceRefs | undefined,
  right: LiveWorkspaceRefs | undefined,
): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;

  return (
    left.ensureProvisioned === right.ensureProvisioned &&
    left.listResult.status === right.listResult.status &&
    workspaceListResultValue(left.listResult) ===
      workspaceListResultValue(right.listResult)
  );
};

const workspaceListResultValue = (
  result: LiveWorkspaceRefs["listResult"],
): unknown => {
  switch (result.status) {
    case "empty":
    case "ready":
      return result.data;
    case "typed_failure":
    case "parse_failure":
    case "transport_failure":
    case "defect":
      return result.error;
    case "loading":
    case "skipped":
      return null;
  }
};
