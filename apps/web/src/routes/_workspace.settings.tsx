import { templateConfectRefs } from "@maestro-template/convex/refs";
import { createFileRoute } from "@tanstack/react-router";

import { useTemplateMutation } from "../adapters/confect-state";
import { createMemberManagementAdapter } from "../features/settings/member-management-adapter";
import { MemberManagement } from "../features/settings/member-management";
import { useWorkspace } from "../providers/workspace";
import { BusinessSettingsRoute } from "../saas-ui/business-shell";

const accessRefs = {
  members: templateConfectRefs.public.access.members,
  invitations: {
    create: templateConfectRefs.public.access.invitations.create,
    cancel: templateConfectRefs.public.access.invitations.cancel,
  },
} as const;

export const Route = createFileRoute("/_workspace/settings")({
  component: WorkspaceSettingsRoute,
});

function WorkspaceSettingsRoute() {
  const workspace = useWorkspace();
  const createInvitation = useTemplateMutation(accessRefs.invitations.create);
  const cancelInvitation = useTemplateMutation(accessRefs.invitations.cancel);
  const changeRole = useTemplateMutation(accessRefs.members.changeRole);
  const removeMember = useTemplateMutation(accessRefs.members.remove);
  const transferOwnership = useTemplateMutation(
    accessRefs.members.transferOwnership,
  );

  if (workspace.status !== "ready") {
    return <BusinessSettingsRoute />;
  }

  const adapter = createMemberManagementAdapter({
    role: workspace.activeWorkspace.role,
    workspaceId: workspace.activeWorkspace.workspaceId,
    refs: accessRefs,
    runMutation: async (ref, args) => {
      if (ref === accessRefs.invitations.create) {
        return createInvitation(args as Parameters<typeof createInvitation>[0]);
      }
      if (ref === accessRefs.invitations.cancel) {
        return cancelInvitation(args as Parameters<typeof cancelInvitation>[0]);
      }
      if (ref === accessRefs.members.changeRole) {
        return changeRole(args as Parameters<typeof changeRole>[0]);
      }
      if (ref === accessRefs.members.remove) {
        return removeMember(args as Parameters<typeof removeMember>[0]);
      }
      if (ref === accessRefs.members.transferOwnership) {
        return transferOwnership(
          args as Parameters<typeof transferOwnership>[0],
        );
      }
      throw new Error("Unknown member management mutation ref.");
    },
  });

  return (
    <>
      <BusinessSettingsRoute />
      <MemberManagement adapter={adapter} />
    </>
  );
}
