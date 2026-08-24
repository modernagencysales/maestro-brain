export function selectInitialWorkspace<Workspace extends { slug: string }>(
  workspaces: readonly Workspace[],
  lastUsedWorkspace: string | undefined,
): Workspace | undefined {
  return (
    workspaces.find(({ slug }) => slug === lastUsedWorkspace) ?? workspaces[0]
  );
}
