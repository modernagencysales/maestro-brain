import type { ClientAuthSnapshot } from "../auth/authkit-server";
import type { WorkspaceOperations, WorkspaceSummary } from "./workspace";

const demoWorkspace: WorkspaceSummary = {
  workspaceId: "workspace_template_demo",
  organizationId: "org_template_demo",
  name: "Template Demo Workspace",
  slug: "template-demo",
  role: "owner",
  status: "active",
};

export const createFakeWorkspaceOperations = (): WorkspaceOperations => ({
  loadWorkspaces: async () => [demoWorkspace],
  ensureProvisioned: async () => ({
    workspaceId: demoWorkspace.workspaceId,
  }),
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

export const createRuntimeWorkspaceOperations = (
  authSnapshot: ClientAuthSnapshot,
): WorkspaceOperations =>
  authSnapshot.status === "signedOut"
    ? createFakeWorkspaceOperations()
    : createFailClosedWorkspaceOperations();
