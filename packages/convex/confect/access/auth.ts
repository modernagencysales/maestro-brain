import { capRole, roleAtLeast, type Role } from "./roles";

export type WorkspaceAccessReason =
  "NO_WORKSPACE_ACCESS" | "WORKSPACE_ARCHIVED" | "ORGANIZATION_INACTIVE";

export type WorkspaceRef = {
  readonly id: string;
  readonly organizationId: string;
  readonly status: "active" | "archived";
};

export type OrganizationRef = {
  readonly id: string;
  readonly status: "active" | "suspended" | "archived";
};

export type OrganizationMemberRef = {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: Role;
  readonly status: "pending" | "active" | "revoked";
  readonly acceptedAt: number | null;
  readonly revokedAt: number | null;
};

export type WorkspaceMemberRef = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: Role;
  readonly status: "pending" | "active" | "revoked";
  readonly acceptedAt: number | null;
  readonly revokedAt: number | null;
  readonly deletedAt: number | null;
};

export type GuestGrantRef = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: Role;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
};

export type RoleCandidate = {
  readonly role: Role;
  readonly source: "direct" | "organization" | "guest";
  readonly reason: string;
};

export type WorkspaceRoleResolution =
  | (RoleCandidate & { readonly ok: true })
  | {
      readonly ok: false;
      readonly reason: WorkspaceAccessReason;
    };

export type WorkspaceAccessSnapshot = {
  readonly nowMs: number;
  readonly userId: string;
  readonly workspace: WorkspaceRef;
  readonly organization?: OrganizationRef;
  readonly workspaceMembers: readonly WorkspaceMemberRef[];
  readonly organizationMembers: readonly OrganizationMemberRef[];
  readonly guestGrants: readonly GuestGrantRef[];
};

const sourceRank: Readonly<Record<RoleCandidate["source"], number>> = {
  direct: 3,
  organization: 2,
  guest: 1,
};

const isLiveWorkspaceMembership = (
  member: WorkspaceMemberRef,
  snapshot: WorkspaceAccessSnapshot,
): boolean =>
  member.workspaceId === snapshot.workspace.id &&
  member.userId === snapshot.userId &&
  member.status === "active" &&
  member.acceptedAt !== null &&
  member.revokedAt === null &&
  member.deletedAt === null;

const isLiveOrganizationMembership = (
  member: OrganizationMemberRef,
  snapshot: WorkspaceAccessSnapshot,
): boolean =>
  member.organizationId === snapshot.workspace.organizationId &&
  member.userId === snapshot.userId &&
  member.status === "active" &&
  member.acceptedAt !== null &&
  member.revokedAt === null;

const isLiveGuestGrant = (
  grant: GuestGrantRef,
  snapshot: WorkspaceAccessSnapshot,
): boolean =>
  grant.workspaceId === snapshot.workspace.id &&
  grant.userId === snapshot.userId &&
  grant.revokedAt === null &&
  grant.expiresAt > snapshot.nowMs;

const assertSingleLiveRow = <T>(rows: readonly T[], message: string): void => {
  if (rows.length > 1) {
    throw new Error(message);
  }
};

export const assertOwningSide = (
  workspace: WorkspaceRef,
  organization: OrganizationRef,
): void => {
  if (workspace.organizationId !== organization.id) {
    throw new Error("Workspace does not belong to organization");
  }
};

export const resolveRoleCandidates = (
  snapshot: WorkspaceAccessSnapshot,
): readonly RoleCandidate[] => {
  if (snapshot.workspace.status !== "active") {
    return [];
  }

  const directMemberships = snapshot.workspaceMembers.filter((member) =>
    isLiveWorkspaceMembership(member, snapshot),
  );
  const organizationMemberships = snapshot.organizationMembers.filter(
    (member) => isLiveOrganizationMembership(member, snapshot),
  );
  const guestGrants = snapshot.guestGrants.filter((grant) =>
    isLiveGuestGrant(grant, snapshot),
  );

  assertSingleLiveRow(
    directMemberships,
    "Duplicate live workspace membership rows",
  );
  assertSingleLiveRow(
    organizationMemberships,
    "Duplicate live organization membership rows",
  );
  assertSingleLiveRow(guestGrants, "Duplicate live guest grant rows");

  const candidates: RoleCandidate[] = [];
  const directMembership = directMemberships[0];
  const organizationMembership = organizationMemberships[0];
  const guestGrant = guestGrants[0];

  if (directMembership) {
    candidates.push({
      role: directMembership.role,
      source: "direct",
      reason: "direct workspace membership",
    });
  }

  if (
    snapshot.organization?.status === "active" &&
    organizationMembership &&
    roleAtLeast(organizationMembership.role, "admin")
  ) {
    candidates.push({
      role: capRole(organizationMembership.role, "admin"),
      source: "organization",
      reason: "organization admin baseline",
    });
  }

  if (guestGrant) {
    candidates.push({
      role: guestGrant.role,
      source: "guest",
      reason: "active guest grant",
    });
  }

  return candidates;
};

export const highestCandidate = (
  candidates: readonly RoleCandidate[],
): RoleCandidate | undefined => {
  const direct = candidates.find((candidate) => candidate.source === "direct");
  if (direct) return direct;

  return candidates.reduce<RoleCandidate | undefined>((highest, candidate) => {
    if (!highest) {
      return candidate;
    }

    if (
      roleAtLeast(candidate.role, highest.role) &&
      candidate.role !== highest.role
    ) {
      return candidate;
    }

    if (
      candidate.role === highest.role &&
      sourceRank[candidate.source] > sourceRank[highest.source]
    ) {
      return candidate;
    }

    return highest;
  }, undefined);
};

export const resolveEffectiveWorkspaceRole = (
  snapshot: WorkspaceAccessSnapshot,
): WorkspaceRoleResolution => {
  if (snapshot.workspace.status === "archived") {
    return { ok: false, reason: "WORKSPACE_ARCHIVED" };
  }

  if (snapshot.organization && snapshot.organization.status !== "active") {
    return { ok: false, reason: "ORGANIZATION_INACTIVE" };
  }

  const candidate = highestCandidate(resolveRoleCandidates(snapshot));

  return candidate
    ? { ok: true, ...candidate }
    : { ok: false, reason: "NO_WORKSPACE_ACCESS" };
};

export const requireWorkspaceMember = (
  resolution: WorkspaceRoleResolution,
  minimumRole: Role,
): RoleCandidate => {
  if (!resolution.ok || !roleAtLeast(resolution.role, minimumRole)) {
    throw new Error("NO_WORKSPACE_ACCESS");
  }

  return resolution;
};

export const requireOrganizationMember = (
  member: OrganizationMemberRef | undefined,
  minimumRole: Role,
): OrganizationMemberRef => {
  if (
    !member ||
    member.status !== "active" ||
    member.acceptedAt === null ||
    member.revokedAt !== null ||
    !roleAtLeast(member.role, minimumRole)
  ) {
    throw new Error("NO_ORGANIZATION_ACCESS");
  }

  return member;
};
