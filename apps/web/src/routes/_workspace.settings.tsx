import { templateConfectRefs } from "@maestro-template/convex/refs";
import { createFileRoute } from "@tanstack/react-router";

import { useTemplateAction, useTemplateQuery } from "../adapters/confect-state";
import {
  createMemberManagementAdapter,
  type WorkspaceId,
} from "../features/settings/member-management-adapter";
import { MemberManagement } from "../features/settings/member-management";
import { createApiKeySettingsAdapter } from "../features/settings/api-keys-adapter";
import { ApiKeysPanel } from "../features/settings/api-keys-panel";
import { useWorkspace } from "../providers/workspace";
import { BusinessSettingsRoute } from "../saas-ui/business-shell";

const accessRefs = {
  members: templateConfectRefs.public.access.members,
  invitations: {
    list: templateConfectRefs.public.access.invitations.list,
    create: templateConfectRefs.public.access.invitations.create,
    cancel: templateConfectRefs.public.access.invitations.cancel,
  },
} as const;

export const Route = createFileRoute("/_workspace/settings")({
  component: WorkspaceSettingsRoute,
});

function WorkspaceSettingsRoute() {
  const workspace = useWorkspace();
  const createInvitation = useTemplateAction(accessRefs.invitations.create);
  const cancelInvitation = useTemplateAction(accessRefs.invitations.cancel);
  const changeRole = useTemplateAction(accessRefs.members.changeRole);
  const removeMember = useTemplateAction(accessRefs.members.remove);
  const transferOwnership = useTemplateAction(
    accessRefs.members.transferOwnership,
  );
  const workspaceId =
    workspace.status === "ready"
      ? (workspace.activeWorkspace.workspaceId as WorkspaceId)
      : null;
  const members = useTemplateQuery(
    accessRefs.members.list,
    workspaceId === null ? "skip" : { workspaceId },
  );
  const invitations = useTemplateQuery(
    accessRefs.invitations.list,
    workspaceId === null ? "skip" : { workspaceId },
  );

  if (workspace.status !== "ready") {
    return <BusinessSettingsRoute />;
  }

  const apiKeyAdapter = createApiKeySettingsAdapter({
    role: workspace.activeWorkspace.role,
    brainKey: workspace.activeWorkspace.slug,
    mutations: unavailableApiKeyMutations,
  });
  const adapter = createMemberManagementAdapter({
    role: workspace.activeWorkspace.role,
    workspaceId: workspace.activeWorkspace.workspaceId as WorkspaceId,
    mutations: {
      createInvitation,
      cancelInvitation,
      changeRole,
      removeMember,
      transferOwnership,
    },
  });

  return (
    <>
      <BusinessSettingsRoute />
      <MemberManagement
        adapter={adapter}
        members={toRowsState(members, "Member list access denied.")}
        invitations={toRowsState(invitations, "Invitation list access denied.")}
      />
      <ApiKeysPanel adapter={apiKeyAdapter} />
    </>
  );
}

const toRowsState = <T, E>(
  state:
    | { readonly status: "ready"; readonly data: readonly T[] }
    | { readonly status: "loading" }
    | { readonly status: "skipped" }
    | { readonly status: "empty"; readonly data: readonly T[] }
    | {
        readonly status: "parse_failure" | "transport_failure" | "defect";
        readonly message: string;
      }
    | { readonly status: "typed_failure"; readonly error: E },
  deniedMessage: string,
) => {
  switch (state.status) {
    case "ready":
    case "empty":
      return { status: "ready" as const, data: state.data };
    case "loading":
    case "skipped":
      return { status: "loading" as const };
    case "typed_failure":
      return { status: "denied" as const, message: deniedMessage };
    case "parse_failure":
    case "transport_failure":
    case "defect":
      return { status: "error" as const, message: state.message };
  }
};

const unavailableApiKeyMutation = async () => {
  throw new Error(
    "Generated headless API-key refs are unavailable until centralized Confect codegen runs.",
  );
};

const unavailableApiKeyMutations = {
  create: unavailableApiKeyMutation,
  rotate: unavailableApiKeyMutation,
  revoke: unavailableApiKeyMutation,
};
