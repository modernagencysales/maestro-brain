import type { WorkspaceMemberLifecycleRef } from "./lifecycle";

export const isLiveWorkspaceMember = (
  member: WorkspaceMemberLifecycleRef,
  workspaceId: string,
): boolean =>
  [
    member.workspaceId === workspaceId,
    member.status === "active",
    member.acceptedAt !== null,
    member.revokedAt === null,
    member.deletedAt === null,
  ].every(Boolean);

export const liveWorkspaceMembersForWorkspace = (
  workspaceId: string,
  members: readonly WorkspaceMemberLifecycleRef[],
): readonly WorkspaceMemberLifecycleRef[] =>
  members.filter((member) => isLiveWorkspaceMember(member, workspaceId));

export const liveWorkspaceOwnersForWorkspace = (
  workspaceId: string,
  members: readonly WorkspaceMemberLifecycleRef[],
): readonly WorkspaceMemberLifecycleRef[] =>
  liveWorkspaceMembersForWorkspace(workspaceId, members).filter(
    (member) => member.role === "owner",
  );
