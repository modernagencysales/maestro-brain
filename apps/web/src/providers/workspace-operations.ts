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
