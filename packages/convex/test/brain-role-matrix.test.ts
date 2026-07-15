import { TestConfect } from "@confect/test";
import { describe, expect, it } from "vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  accessAuditEventInsert,
  denialAuditReason,
  deniedPrivilegedAccessAuditEvent,
  privilegedAccessAuditActions,
} from "../confect/access/audit";
import { resolveEffectiveWorkspaceRole } from "../confect/access/auth";
import { asGenericId } from "../confect/access/handlerContext";
import {
  changeMemberRole,
  removeMember,
  transferOwnership,
  type WorkspaceMemberLifecycleRef,
} from "../confect/access/lifecycle";
import { INVITATION_TTL_MS } from "../confect/access/lifecycleInvitations";
import { canManageWorkspaceMembers } from "../confect/access/members.impl";
import { testConfectLayer } from "./support/confect";
import {
  Forbidden,
  LastOwnerProtected,
  MemberNotInWorkspace,
  MembershipNotLive,
  Unauthorized,
} from "../confect/errors";

const now = 1_782_924_800_000;
const roles = ["viewer", "editor", "admin", "owner"] as const;

const privilegedMutationSetup = Effect.gen(function* () {
  const writer = yield* DatabaseWriter;
  const ownerUserId = yield* writer
    .table("users")
    .insert({
      subject: "owner-subject",
      email: "owner@example.com",
      displayName: "Owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const outsiderUserId = yield* writer
    .table("users")
    .insert({
      subject: "outsider-subject",
      email: "outsider@example.com",
      displayName: "Outsider",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const adminUserId = yield* writer
    .table("users")
    .insert({
      subject: "admin-subject",
      email: "admin@example.com",
      displayName: "Admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("users")
    .insert({
      subject: "attacker-subject",
      email: "attacker@example.com",
      displayName: "Attacker",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const organizationId = yield* writer
    .table("organizations")
    .insert({
      ownerUserId,
      name: "Acme",
      slug: "acme",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const workspaceId = yield* writer
    .table("workspaces")
    .insert({
      organizationId,
      ownerUserId,
      name: "Acme Workspace",
      slug: "acme-demo",
      status: "active",
      dataClassification: "internal",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const otherWorkspaceId = yield* writer
    .table("workspaces")
    .insert({
      organizationId,
      ownerUserId,
      name: "Other Workspace",
      slug: "other-demo",
      status: "active",
      dataClassification: "internal",
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const ownerMembershipId = yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId,
      userId: ownerUserId,
      role: "owner",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const deletedMembershipId = yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId,
      userId: outsiderUserId,
      role: "editor",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId,
      userId: adminUserId,
      role: "admin",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const targetMembershipId = yield* writer
    .table("workspaceMembers")
    .insert({
      workspaceId,
      userId: outsiderUserId,
      role: "viewer",
      status: "active",
      acceptedAt: now,
      revokedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("workspaceMembers")
    .delete(deletedMembershipId)
    .pipe(Effect.orDie);
  const pendingInvitationId = yield* writer
    .table("invitations")
    .insert({
      workspaceId: otherWorkspaceId,
      organizationId,
      email: "pending@example.com",
      role: "viewer",
      status: "pending",
      tokenHash: "pending-token-hash",
      invitedByUserId: ownerUserId,
      acceptedAt: null,
      revokedAt: null,
      declinedAt: null,
      expiresAt: now + 1_000,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const acceptedInvitationId = yield* writer
    .table("invitations")
    .insert({
      workspaceId,
      organizationId,
      email: "accepted@example.com",
      role: "viewer",
      status: "accepted",
      tokenHash: "accepted-token-hash",
      invitedByUserId: ownerUserId,
      acceptedAt: now,
      revokedAt: null,
      declinedAt: null,
      expiresAt: now + 1_000,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  const expiredInvitationId = yield* writer
    .table("invitations")
    .insert({
      workspaceId,
      organizationId,
      email: "expired@example.com",
      role: "viewer",
      status: "pending",
      tokenHash: "expired-token-hash",
      invitedByUserId: ownerUserId,
      acceptedAt: null,
      revokedAt: null,
      declinedAt: null,
      expiresAt: now - 1,
      createdAt: now - 2_000,
      updatedAt: now - 2_000,
    })
    .pipe(Effect.orDie);
  const deletedInvitationId = yield* writer
    .table("invitations")
    .insert({
      workspaceId,
      organizationId,
      email: "deleted@example.com",
      role: "viewer",
      status: "pending",
      tokenHash: "deleted-token-hash",
      invitedByUserId: ownerUserId,
      acceptedAt: null,
      revokedAt: null,
      declinedAt: null,
      expiresAt: now + 1_000,
      createdAt: now,
      updatedAt: now,
    })
    .pipe(Effect.orDie);
  yield* writer
    .table("invitations")
    .delete(deletedInvitationId)
    .pipe(Effect.orDie);

  return {
    deletedMembershipId,
    ownerMembershipId,
    targetMembershipId,
    ownerUserId,
    organizationId,
    workspaceId,
    otherWorkspaceId,
    pendingInvitationId,
    acceptedInvitationId,
    expiredInvitationId,
    deletedInvitationId,
  };
});

const PrivilegedMutationSetup = Schema.Struct({
  deletedMembershipId: Schema.String,
  ownerMembershipId: Schema.String,
  targetMembershipId: Schema.String,
  ownerUserId: Schema.String,
  organizationId: Schema.String,
  workspaceId: Schema.String,
  otherWorkspaceId: Schema.String,
  pendingInvitationId: Schema.String,
  acceptedInvitationId: Schema.String,
  expiredInvitationId: Schema.String,
  deletedInvitationId: Schema.String,
});

const member = (
  overrides: Partial<WorkspaceMemberLifecycleRef>,
): WorkspaceMemberLifecycleRef => ({
  id: "workspaceMembers_target",
  workspaceId: "workspaces_brain",
  userId: "users_target",
  role: "editor",
  status: "active",
  acceptedAt: now - 100,
  revokedAt: null,
  deletedAt: null,
  ...overrides,
});

const liveOwners = [
  member({
    id: "workspaceMembers_owner_1",
    userId: "users_owner_1",
    role: "owner",
  }),
  member({
    id: "workspaceMembers_owner_2",
    userId: "users_owner_2",
    role: "owner",
  }),
];

const productStateSnapshot = (workspaceId: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const memberships = yield* reader
      .table("workspaceMembers")
      .index("by_workspace_status", (q) => q.eq("workspaceId", workspaceId))
      .collect()
      .pipe(Effect.orDie);
    const invitations = yield* reader
      .table("invitations")
      .index("by_workspace_status", (q) => q.eq("workspaceId", workspaceId))
      .collect()
      .pipe(Effect.orDie);

    return {
      memberships: memberships.map((row) => ({
        id: row._id,
        role: row.role,
        status: row.status,
        revokedAt: row.revokedAt,
        deletedAt: row.deletedAt,
      })),
      invitations: invitations.map((row) => ({
        id: row._id,
        status: row.status,
        revokedAt: row.revokedAt,
      })),
    };
  });

const seedPrivilegedMatrixCase = (actorRole: (typeof roles)[number]) =>
  Effect.gen(function* () {
    const seeded = yield* privilegedMutationSetup;
    const seedNow = yield* Clock.currentTimeMillis;
    const writer = yield* DatabaseWriter;
    const actorUserId = yield* writer
      .table("users")
      .insert({
        subject: `${actorRole}-matrix-subject`,
        email: `${actorRole}-matrix@example.com`,
        displayName: `${actorRole} matrix actor`,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId: seeded.workspaceId,
        userId: actorUserId,
        role: actorRole,
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const viewerInvitationId = yield* writer
      .table("invitations")
      .insert({
        workspaceId: seeded.workspaceId,
        organizationId: seeded.organizationId,
        email: `${actorRole}-matrix-pending-viewer@example.com`,
        role: "viewer",
        status: "pending",
        tokenHash: `${actorRole}-matrix-pending-viewer-token-hash`,
        invitedByUserId: seeded.ownerUserId,
        acceptedAt: null,
        revokedAt: null,
        declinedAt: null,
        expiresAt: seedNow + INVITATION_TTL_MS,
        createdAt: seedNow,
        updatedAt: seedNow,
      })
      .pipe(Effect.orDie);
    const ownerInvitationId = yield* writer
      .table("invitations")
      .insert({
        workspaceId: seeded.workspaceId,
        organizationId: seeded.organizationId,
        email: `${actorRole}-matrix-pending-owner@example.com`,
        role: "owner",
        status: "pending",
        tokenHash: `${actorRole}-matrix-pending-owner-token-hash`,
        invitedByUserId: seeded.ownerUserId,
        acceptedAt: null,
        revokedAt: null,
        declinedAt: null,
        expiresAt: seedNow + INVITATION_TTL_MS,
        createdAt: seedNow,
        updatedAt: seedNow,
      })
      .pipe(Effect.orDie);

    return { ...seeded, viewerInvitationId, ownerInvitationId };
  });

const PrivilegedMatrixCase = Schema.Struct({
  ...PrivilegedMutationSetup.fields,
  viewerInvitationId: Schema.String,
  ownerInvitationId: Schema.String,
});

type PrivilegedMatrixSeed = Schema.Schema.Type<typeof PrivilegedMatrixCase>;
type PrivilegedMatrixCaller = TestConfect.TestConfectWithoutIdentity<
  typeof databaseSchema
>;
type PrivilegedMatrixRun = (
  caller: PrivilegedMatrixCaller,
  seeded: PrivilegedMatrixSeed,
) => Effect.Effect<unknown, unknown, never>;

const accessAuditRows = (workspaceId: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader
      .table("accessAuditEvents")
      .index("by_workspace_created", (q) => q.eq("workspaceId", workspaceId))
      .collect()
      .pipe(Effect.orDie);
  });

const userMembershipGenerations = (input: {
  readonly workspaceId: string;
  readonly userId: string;
}) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("workspaceMembers")
      .index("by_workspace_user", (q) =>
        q.eq("workspaceId", input.workspaceId).eq("userId", input.userId),
      )
      .collect()
      .pipe(Effect.orDie);
    return rows.map((row) => ({
      id: row._id,
      role: row.role,
      status: row.status,
      acceptedAt: row.acceptedAt,
      revokedAt: row.revokedAt,
      deletedAt: row.deletedAt,
    }));
  });

describe("Brain role matrix", () => {
  it.each(roles)(
    "allows member administration only for admin and owner at the server boundary for %s",
    (role) => {
      expect(canManageWorkspaceMembers(role)).toBe(
        role === "admin" || role === "owner",
      );
    },
  );

  it.each(roles)(
    "allows ownership transfer only for owner, not %s",
    (actorRole) => {
      const result = transferOwnership({
        actorUserId: `users_${actorRole}`,
        workspaceId: "workspaces_brain",
        target: member({ userId: "users_target", role: "admin" }),
        actorMembership: member({
          userId: `users_${actorRole}`,
          role: actorRole,
        }),
        now,
      });

      if (actorRole === "owner") {
        expect(Either.isRight(result)).toBe(true);
      } else {
        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result))
          expect(result.left).toBeInstanceOf(Forbidden);
      }
    },
  );

  it("denies revoked direct membership and cross-Brain targets before planning writes", () => {
    const revoked = removeMember({
      actorUserId: "users_admin",
      actorRole: "admin",
      workspaceId: "workspaces_brain",
      target: member({ status: "revoked", revokedAt: now - 1 }),
      liveWorkspaceMembers: liveOwners,
      now,
    });
    expect(Either.isLeft(revoked)).toBe(true);
    if (Either.isLeft(revoked)) {
      expect(revoked.left).toBeInstanceOf(MembershipNotLive);
    }

    const crossBrain = changeMemberRole({
      actorUserId: "users_owner",
      actorRole: "owner",
      workspaceId: "workspaces_brain",
      target: member({ workspaceId: "workspaces_other" }),
      liveWorkspaceMembers: liveOwners,
      newRole: "viewer",
      now,
    });
    expect(Either.isLeft(crossBrain)).toBe(true);
    if (Either.isLeft(crossBrain)) {
      expect(crossBrain.left).toBeInstanceOf(MemberNotInWorkspace);
    }
  });

  it("grants organization admins the capped member-management baseline", () => {
    const resolution = resolveEffectiveWorkspaceRole({
      nowMs: now,
      userId: "users_org_owner",
      workspace: {
        id: "workspaces_brain",
        organizationId: "organizations_agency",
        status: "active",
      },
      organization: { id: "organizations_agency", status: "active" },
      workspaceMembers: [],
      organizationMembers: [
        {
          organizationId: "organizations_agency",
          userId: "users_org_owner",
          role: "owner",
          status: "active",
          acceptedAt: now - 100,
          revokedAt: null,
        },
      ],
      guestGrants: [],
    });

    expect(resolution).toMatchObject({
      ok: true,
      role: "admin",
      source: "organization",
    });
    expect(resolution.ok && canManageWorkspaceMembers(resolution.role)).toBe(
      true,
    );
  });

  it("lets direct workspace membership restrict org-admin baseline while revoked direct falls back", () => {
    const baseline = {
      nowMs: now,
      userId: "users_org_admin",
      workspace: {
        id: "workspaces_brain",
        organizationId: "organizations_agency",
        status: "active" as const,
      },
      organization: { id: "organizations_agency", status: "active" as const },
      organizationMembers: [
        {
          organizationId: "organizations_agency",
          userId: "users_org_admin",
          role: "admin" as const,
          status: "active" as const,
          acceptedAt: now - 100,
          revokedAt: null,
        },
      ],
      guestGrants: [],
    };

    const directViewer = resolveEffectiveWorkspaceRole({
      ...baseline,
      workspaceMembers: [
        {
          workspaceId: "workspaces_brain",
          userId: "users_org_admin",
          role: "viewer",
          status: "active",
          acceptedAt: now - 100,
          revokedAt: null,
          deletedAt: null,
        },
      ],
    });
    const revokedDirect = resolveEffectiveWorkspaceRole({
      ...baseline,
      workspaceMembers: [
        {
          workspaceId: "workspaces_brain",
          userId: "users_org_admin",
          role: "viewer",
          status: "revoked",
          acceptedAt: now - 100,
          revokedAt: now - 1,
          deletedAt: null,
        },
      ],
    });

    expect(directViewer).toMatchObject({
      ok: true,
      role: "viewer",
      source: "direct",
    });
    expect(revokedDirect).toMatchObject({
      ok: true,
      role: "admin",
      source: "organization",
    });
  });

  it("denies revoked organization baseline and cross-Brain organization members", () => {
    const revoked = resolveEffectiveWorkspaceRole({
      nowMs: now,
      userId: "users_org_admin",
      workspace: {
        id: "workspaces_brain",
        organizationId: "organizations_agency",
        status: "active",
      },
      organization: { id: "organizations_agency", status: "active" },
      workspaceMembers: [],
      organizationMembers: [
        {
          organizationId: "organizations_agency",
          userId: "users_org_admin",
          role: "admin",
          status: "revoked",
          acceptedAt: now - 100,
          revokedAt: now - 1,
        },
      ],
      guestGrants: [],
    });
    const crossBrain = resolveEffectiveWorkspaceRole({
      nowMs: now,
      userId: "users_org_admin",
      workspace: {
        id: "workspaces_brain",
        organizationId: "organizations_agency",
        status: "active",
      },
      organization: { id: "organizations_agency", status: "active" },
      workspaceMembers: [],
      organizationMembers: [
        {
          organizationId: "organizations_other",
          userId: "users_org_admin",
          role: "admin",
          status: "active",
          acceptedAt: now - 100,
          revokedAt: null,
        },
      ],
      guestGrants: [],
    });

    expect(revoked).toEqual({ ok: false, reason: "NO_WORKSPACE_ACCESS" });
    expect(crossBrain).toEqual({ ok: false, reason: "NO_WORKSPACE_ACCESS" });
  });

  it("preserves last-owner protection for demotion and removal", () => {
    const onlyOwner = member({ role: "owner", userId: "users_owner" });
    const demotion = changeMemberRole({
      actorUserId: "users_owner",
      actorRole: "owner",
      workspaceId: "workspaces_brain",
      target: onlyOwner,
      liveWorkspaceMembers: [onlyOwner],
      newRole: "admin",
      now,
    });
    const removal = removeMember({
      actorUserId: "users_owner",
      actorRole: "owner",
      workspaceId: "workspaces_brain",
      target: onlyOwner,
      liveWorkspaceMembers: [onlyOwner],
      now,
    });

    expect(Either.isLeft(demotion)).toBe(true);
    if (Either.isLeft(demotion)) {
      expect(demotion.left).toBeInstanceOf(LastOwnerProtected);
    }
    expect(Either.isLeft(removal)).toBe(true);
    if (Either.isLeft(removal)) {
      expect(removal.left).toBeInstanceOf(LastOwnerProtected);
    }
  });

  it("does not reveal arbitrary membership IDs to unauthenticated callers", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );

      return yield* Effect.either(
        confect.action(refs.public.access.members.changeRole, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          membershipId: asGenericId<"workspaceMembers">(
            seeded.targetMembershipId,
          ),
          newRole: "viewer",
        }),
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(Unauthorized);
    }
  });

  it("does not reveal arbitrary membership IDs to unauthorized callers", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );

      const outsider = confect.withIdentity({ subject: "attacker-subject" });
      const validTarget = yield* Effect.either(
        outsider.action(refs.public.access.members.remove, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          membershipId: asGenericId<"workspaceMembers">(
            seeded.ownerMembershipId,
          ),
        }),
      );
      const missingTarget = yield* Effect.either(
        outsider.action(refs.public.access.members.remove, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          membershipId: asGenericId<"workspaceMembers">(
            seeded.deletedMembershipId,
          ),
        }),
      );

      return { validTarget, missingTarget };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(Either.isLeft(result.validTarget)).toBe(true);
    expect(Either.isLeft(result.missingTarget)).toBe(true);
    if (Either.isLeft(result.validTarget)) {
      expect(result.validTarget.left).toBeInstanceOf(Forbidden);
    }
    if (Either.isLeft(result.missingTarget)) {
      expect(result.missingTarget.left).toBeInstanceOf(Forbidden);
    }
  });

  it.each(["viewer", "editor"] as const)(
    "denies %s member mutations before target lookup",
    async (role) => {
      const program = Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          privilegedMutationSetup,
          PrivilegedMutationSetup,
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const userId = yield* writer
              .table("users")
              .insert({
                subject: `${role}-subject`,
                email: `${role}@example.com`,
                displayName: role,
                status: "active",
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("workspaceMembers")
              .insert({
                workspaceId: seeded.workspaceId,
                userId,
                role,
                status: "active",
                acceptedAt: now,
                revokedAt: null,
                deletedAt: null,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }),
          Schema.Any,
        );
        const caller = confect.withIdentity({ subject: `${role}-subject` });
        const validChange = yield* Effect.either(
          caller.action(refs.public.access.members.changeRole, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            membershipId: asGenericId<"workspaceMembers">(
              seeded.targetMembershipId,
            ),
            newRole: "viewer",
          }),
        );
        const missingChange = yield* Effect.either(
          caller.action(refs.public.access.members.changeRole, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            membershipId: asGenericId<"workspaceMembers">(
              seeded.deletedMembershipId,
            ),
            newRole: "viewer",
          }),
        );
        const remove = yield* Effect.either(
          caller.action(refs.public.access.members.remove, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            membershipId: asGenericId<"workspaceMembers">(
              seeded.targetMembershipId,
            ),
          }),
        );
        const transfer = yield* Effect.either(
          caller.action(refs.public.access.members.transferOwnership, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            membershipId: asGenericId<"workspaceMembers">(
              seeded.targetMembershipId,
            ),
          }),
        );

        return { validChange, missingChange, remove, transfer };
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testConfectLayer())),
      );
      for (const mutation of Object.values(result)) {
        expect(Either.isLeft(mutation)).toBe(true);
        if (Either.isLeft(mutation)) {
          expect(mutation.left).toBeInstanceOf(Forbidden);
        }
      }
    },
  );

  it.each(
    roles.flatMap((actorRole) =>
      [
        {
          operation: "change non-owner member role",
          expectAllowed: actorRole === "admin" || actorRole === "owner",
          run: ((
            caller: PrivilegedMatrixCaller,
            seeded: PrivilegedMatrixSeed,
          ) =>
            caller.action(refs.public.access.members.changeRole, {
              workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
              membershipId: asGenericId<"workspaceMembers">(
                seeded.targetMembershipId,
              ),
              newRole: "editor",
            })) satisfies PrivilegedMatrixRun,
        },
        {
          operation: "remove non-owner member",
          expectAllowed: actorRole === "admin" || actorRole === "owner",
          run: ((
            caller: PrivilegedMatrixCaller,
            seeded: PrivilegedMatrixSeed,
          ) =>
            caller.action(refs.public.access.members.remove, {
              workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
              membershipId: asGenericId<"workspaceMembers">(
                seeded.targetMembershipId,
              ),
            })) satisfies PrivilegedMatrixRun,
        },
        {
          operation: "transfer ownership",
          expectAllowed: actorRole === "owner",
          run: ((
            caller: PrivilegedMatrixCaller,
            seeded: PrivilegedMatrixSeed,
          ) =>
            caller.action(refs.public.access.members.transferOwnership, {
              workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
              membershipId: asGenericId<"workspaceMembers">(
                seeded.targetMembershipId,
              ),
            })) satisfies PrivilegedMatrixRun,
        },
        {
          operation: "invite non-owner member",
          expectAllowed: actorRole === "admin" || actorRole === "owner",
          run: ((
            caller: PrivilegedMatrixCaller,
            seeded: PrivilegedMatrixSeed,
          ) =>
            caller.action(refs.public.access.invitations.create, {
              workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
              email: `${actorRole}-matrix-viewer@example.com`,
              role: "viewer",
            })) satisfies PrivilegedMatrixRun,
        },
        {
          operation: "invite owner member",
          expectAllowed: actorRole === "owner",
          run: ((
            caller: PrivilegedMatrixCaller,
            seeded: PrivilegedMatrixSeed,
          ) =>
            caller.action(refs.public.access.invitations.create, {
              workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
              email: `${actorRole}-matrix-owner@example.com`,
              role: "owner",
            })) satisfies PrivilegedMatrixRun,
        },
        {
          operation: "cancel non-owner invitation",
          expectAllowed: actorRole === "admin" || actorRole === "owner",
          run: ((
            caller: PrivilegedMatrixCaller,
            seeded: PrivilegedMatrixSeed,
          ) =>
            caller.action(refs.public.access.invitations.cancel, {
              workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
              invitationId: asGenericId<"invitations">(
                seeded.viewerInvitationId,
              ),
            })) satisfies PrivilegedMatrixRun,
        },
        {
          operation: "cancel owner invitation",
          expectAllowed: actorRole === "owner",
          run: ((
            caller: PrivilegedMatrixCaller,
            seeded: PrivilegedMatrixSeed,
          ) =>
            caller.action(refs.public.access.invitations.cancel, {
              workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
              invitationId: asGenericId<"invitations">(
                seeded.ownerInvitationId,
              ),
            })) satisfies PrivilegedMatrixRun,
        },
      ].map((testCase) => ({ actorRole, ...testCase })),
    ),
  )(
    "enforces %s for %s at the handler boundary",
    async ({ actorRole, expectAllowed, run }) => {
      const program = Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        const seeded = yield* confect.run(
          seedPrivilegedMatrixCase(actorRole),
          PrivilegedMatrixCase,
        );
        const matrixRun: PrivilegedMatrixRun = run;
        const result = yield* Effect.either(
          matrixRun(
            confect.withIdentity({ subject: `${actorRole}-matrix-subject` }),
            seeded,
          ),
        );
        return result;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(testConfectLayer())),
      );

      if (expectAllowed) {
        expect(Either.isRight(result)).toBe(true);
      } else {
        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(Forbidden);
        }
      }
    },
  );

  it("keeps owner invitations owner-only while allowing owner grants", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );

      const adminEscalation = yield* Effect.either(
        confect
          .withIdentity({ subject: "admin-subject" })
          .action(refs.public.access.invitations.create, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            email: "new-owner@example.com",
            role: "owner",
          }),
      );
      const ownerGrant = yield* Effect.either(
        confect
          .withIdentity({ subject: "owner-subject" })
          .action(refs.public.access.invitations.create, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            email: "owner-grant@example.com",
            role: "owner",
          }),
      );

      return { adminEscalation, ownerGrant };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(Either.isLeft(result.adminEscalation)).toBe(true);
    if (Either.isLeft(result.adminEscalation)) {
      expect(result.adminEscalation.left).toBeInstanceOf(Forbidden);
    }
    expect(Either.isRight(result.ownerGrant)).toBe(true);
  });

  it("denies missing cross-Brain and non-pending invitation cancellation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );
      const owner = confect.withIdentity({ subject: "owner-subject" });

      const missing = yield* Effect.either(
        owner.action(refs.public.access.invitations.cancel, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          invitationId: asGenericId<"invitations">(seeded.deletedInvitationId),
        }),
      );
      const crossBrain = yield* Effect.either(
        owner.action(refs.public.access.invitations.cancel, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          invitationId: asGenericId<"invitations">(seeded.pendingInvitationId),
        }),
      );
      const nonPending = yield* Effect.either(
        owner.action(refs.public.access.invitations.cancel, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          invitationId: asGenericId<"invitations">(seeded.acceptedInvitationId),
        }),
      );
      const expired = yield* Effect.either(
        owner.action(refs.public.access.invitations.cancel, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          invitationId: asGenericId<"invitations">(seeded.expiredInvitationId),
        }),
      );
      return { missing, crossBrain, nonPending, expired };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    for (const cancellation of [
      result.missing,
      result.crossBrain,
      result.nonPending,
      result.expired,
    ]) {
      expect(Either.isLeft(cancellation)).toBe(true);
      if (Either.isLeft(cancellation)) {
        expect(cancellation.left).toBeInstanceOf(Forbidden);
      }
    }
  });

  it("durably records redacted denial audit rows outside failed privileged actions", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );
      const viewerUserId = yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const userId = yield* writer
            .table("users")
            .insert({
              subject: "audit-viewer-subject",
              email: "audit-viewer@example.com",
              displayName: "Audit Viewer",
              status: "active",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("workspaceMembers")
            .insert({
              workspaceId: seeded.workspaceId,
              userId,
              role: "viewer",
              status: "active",
              acceptedAt: now,
              revokedAt: null,
              deletedAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          return userId;
        }),
        Schema.String,
      );
      const viewer = confect.withIdentity({ subject: "audit-viewer-subject" });

      const deniedMember = yield* Effect.either(
        viewer.action(refs.public.access.members.changeRole, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          membershipId: asGenericId<"workspaceMembers">(
            seeded.targetMembershipId,
          ),
          newRole: "editor",
        }),
      );
      const deniedInvite = yield* Effect.either(
        viewer.action(refs.public.access.invitations.create, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          email: "blocked@example.com",
          role: "viewer",
        }),
      );
      const rows = yield* confect.run(
        accessAuditRows(seeded.workspaceId),
        Schema.Any,
      );

      return { deniedMember, deniedInvite, rows, viewerUserId };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(Either.isLeft(result.deniedMember)).toBe(true);
    expect(Either.isLeft(result.deniedInvite)).toBe(true);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "member.roleChanged",
          actorUserId: result.viewerUserId,
          metadataJson: '{"outcome":"denied","reason":"Forbidden"}',
        }),
        expect.objectContaining({
          action: "invitation.created",
          actorUserId: result.viewerUserId,
          subjectId: "pending-invitation",
          metadataJson: '{"outcome":"denied","reason":"Forbidden"}',
        }),
      ]),
    );
    expect(JSON.stringify(result.rows)).not.toContain("blocked@example.com");
  });

  it("keeps product membership and invitation state unchanged for denied operations", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );
      const before = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const viewer = confect.withIdentity({ subject: "attacker-subject" });

      yield* Effect.either(
        viewer.action(refs.public.access.members.remove, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          membershipId: asGenericId<"workspaceMembers">(
            seeded.targetMembershipId,
          ),
        }),
      );
      yield* Effect.either(
        viewer.action(refs.public.access.invitations.cancel, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          invitationId: asGenericId<"invitations">(seeded.acceptedInvitationId),
        }),
      );
      const after = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );

      return { before, after };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.after).toEqual(result.before);
  });

  it("denies suspended and deleted principals before privileged product writes", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          for (const status of ["suspended", "deleted"] as const) {
            const userId = yield* writer
              .table("users")
              .insert({
                subject: `${status}-subject`,
                email: `${status}@example.com`,
                displayName: status,
                status,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("workspaceMembers")
              .insert({
                workspaceId: seeded.workspaceId,
                userId,
                role: "owner",
                status: "active",
                acceptedAt: now,
                revokedAt: null,
                deletedAt: null,
                createdAt: now,
                updatedAt: now,
              })
              .pipe(Effect.orDie);
          }
        }),
        Schema.Any,
      );
      const before = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const suspended = yield* Effect.either(
        confect
          .withIdentity({ subject: "suspended-subject" })
          .action(refs.public.access.members.changeRole, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            membershipId: asGenericId<"workspaceMembers">(
              seeded.targetMembershipId,
            ),
            newRole: "admin",
          }),
      );
      const deleted = yield* Effect.either(
        confect
          .withIdentity({ subject: "deleted-subject" })
          .action(refs.public.access.invitations.create, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            email: "deleted-principal@example.com",
            role: "viewer",
          }),
      );
      const after = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      return { suspended, deleted, before, after };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(Either.isLeft(result.suspended)).toBe(true);
    if (Either.isLeft(result.suspended)) {
      expect(result.suspended.left).toBeInstanceOf(Unauthorized);
    }
    expect(Either.isLeft(result.deleted)).toBe(true);
    if (Either.isLeft(result.deleted)) {
      expect(result.deleted.left).toBeInstanceOf(Unauthorized);
    }
    expect(result.after).toEqual(result.before);
  });

  it("accepts invitations using the current live membership generation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );
      const seededInvite = yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const seedNow = yield* Clock.currentTimeMillis;
          const userId = yield* writer
            .table("users")
            .insert({
              subject: "invitee-subject",
              email: "invitee@example.com",
              displayName: "Invitee",
              status: "active",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("workspaceMembers")
            .insert({
              workspaceId: seeded.workspaceId,
              userId,
              role: "viewer",
              status: "revoked",
              acceptedAt: now - 2_000,
              revokedAt: now - 1_000,
              deletedAt: null,
              createdAt: now - 2_000,
              updatedAt: now - 1_000,
            })
            .pipe(Effect.orDie);
          const liveMembershipId = yield* writer
            .table("workspaceMembers")
            .insert({
              workspaceId: seeded.workspaceId,
              userId,
              role: "editor",
              status: "active",
              acceptedAt: now - 500,
              revokedAt: null,
              deletedAt: null,
              createdAt: now - 500,
              updatedAt: now - 500,
            })
            .pipe(Effect.orDie);
          const invitationId = yield* writer
            .table("invitations")
            .insert({
              workspaceId: seeded.workspaceId,
              organizationId: seeded.organizationId,
              email: "invitee@example.com",
              role: "admin",
              status: "pending",
              tokenHash: "current-live-token-hash",
              invitedByUserId: seeded.ownerUserId,
              acceptedAt: null,
              revokedAt: null,
              declinedAt: null,
              expiresAt: seedNow + INVITATION_TTL_MS,
              createdAt: seedNow,
              updatedAt: seedNow,
            })
            .pipe(Effect.orDie);
          return { invitationId, liveMembershipId, userId };
        }),
        Schema.Struct({
          invitationId: Schema.String,
          liveMembershipId: Schema.String,
          userId: Schema.String,
        }),
      );

      const beforeGenerations = yield* confect.run(
        userMembershipGenerations({
          workspaceId: seeded.workspaceId,
          userId: seededInvite.userId,
        }),
        Schema.Any,
      );
      const accepted = yield* Effect.either(
        confect
          .withIdentity({ subject: "invitee-subject" })
          .mutation(refs.public.access.invitations.accept, {
            invitationId: asGenericId<"invitations">(seededInvite.invitationId),
          }),
      );
      const afterGenerations = yield* confect.run(
        userMembershipGenerations({
          workspaceId: seeded.workspaceId,
          userId: seededInvite.userId,
        }),
        Schema.Any,
      );
      const after = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      return {
        accepted,
        beforeGenerations,
        afterGenerations,
        after,
        seededInvite,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(Either.isRight(result.accepted)).toBe(true);
    expect(result.beforeGenerations).toHaveLength(2);
    expect(result.afterGenerations).toHaveLength(2);
    expect(
      result.afterGenerations.filter(
        (row: {
          readonly status: string;
          readonly revokedAt: number | null;
          readonly deletedAt: number | null;
        }) =>
          row.status === "active" &&
          row.revokedAt === null &&
          row.deletedAt === null,
      ),
    ).toEqual([
      expect.objectContaining({
        id: result.seededInvite.liveMembershipId,
        role: "editor",
      }),
    ]);
    expect(result.after.invitations).toContainEqual(
      expect.objectContaining({
        id: result.seededInvite.invitationId,
        status: "accepted",
      }),
    );
  });

  it("denies accept and cancel for archived Brain and non-active organizations without product writes", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );
      const cases = yield* confect.run(
        Effect.gen(function* () {
          const seedNow = yield* Clock.currentTimeMillis;
          const writer = yield* DatabaseWriter;
          const rows: Array<{
            readonly subject: string;
            readonly workspaceId: string;
            readonly invitationId: string;
          }> = [];
          for (const scenario of [
            {
              suffix: "archived-workspace",
              orgStatus: "active" as const,
              workspaceStatus: "archived" as const,
            },
            {
              suffix: "suspended-org",
              orgStatus: "suspended" as const,
              workspaceStatus: "active" as const,
            },
            {
              suffix: "archived-org",
              orgStatus: "archived" as const,
              workspaceStatus: "active" as const,
            },
          ]) {
            const userId = yield* writer
              .table("users")
              .insert({
                subject: `${scenario.suffix}-subject`,
                email: `${scenario.suffix}@example.com`,
                displayName: scenario.suffix,
                status: "active",
                createdAt: seedNow,
                updatedAt: seedNow,
              })
              .pipe(Effect.orDie);
            const organizationId = yield* writer
              .table("organizations")
              .insert({
                ownerUserId: userId,
                name: scenario.suffix,
                slug: scenario.suffix,
                status: scenario.orgStatus,
                createdAt: seedNow,
                updatedAt: seedNow,
              })
              .pipe(Effect.orDie);
            const workspaceId = yield* writer
              .table("workspaces")
              .insert({
                organizationId,
                ownerUserId: userId,
                name: scenario.suffix,
                slug: scenario.suffix,
                status: scenario.workspaceStatus,
                dataClassification: "internal",
                createdAt: seedNow,
                updatedAt: seedNow,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("workspaceMembers")
              .insert({
                workspaceId,
                userId,
                role: "owner",
                status: "active",
                acceptedAt: seedNow,
                revokedAt: null,
                deletedAt: null,
                createdAt: seedNow,
                updatedAt: seedNow,
              })
              .pipe(Effect.orDie);
            const invitationId = yield* writer
              .table("invitations")
              .insert({
                workspaceId,
                organizationId,
                email: `${scenario.suffix}@example.com`,
                role: "viewer",
                status: "pending",
                tokenHash: `${scenario.suffix}-token-hash`,
                invitedByUserId: userId,
                acceptedAt: null,
                revokedAt: null,
                declinedAt: null,
                expiresAt: seedNow + INVITATION_TTL_MS,
                createdAt: seedNow,
                updatedAt: seedNow,
              })
              .pipe(Effect.orDie);
            rows.push({
              subject: `${scenario.suffix}-subject`,
              workspaceId,
              invitationId,
            });
          }
          return rows;
        }),
        Schema.Any,
      );

      const results = [];
      for (const scenario of cases as ReadonlyArray<{
        readonly subject: string;
        readonly workspaceId: string;
        readonly invitationId: string;
      }>) {
        const before = yield* confect.run(
          productStateSnapshot(scenario.workspaceId),
          Schema.Any,
        );
        const caller = confect.withIdentity({ subject: scenario.subject });
        const accept = yield* Effect.either(
          caller.mutation(refs.public.access.invitations.accept, {
            invitationId: asGenericId<"invitations">(scenario.invitationId),
          }),
        );
        const cancel = yield* Effect.either(
          caller.action(refs.public.access.invitations.cancel, {
            workspaceId: asGenericId<"workspaces">(scenario.workspaceId),
            invitationId: asGenericId<"invitations">(scenario.invitationId),
          }),
        );
        const after = yield* confect.run(
          productStateSnapshot(scenario.workspaceId),
          Schema.Any,
        );
        results.push({ accept, cancel, before, after });
      }
      return results;
    });

    const results = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    for (const result of results) {
      expect(Either.isLeft(result.accept)).toBe(true);
      expect(Either.isLeft(result.cancel)).toBe(true);
      expect(result.after).toEqual(result.before);
    }
  });

  it("denies tenant-mismatched invitations for accept cancel and list without product writes", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );
      const mismatch = yield* confect.run(
        Effect.gen(function* () {
          const seedNow = yield* Clock.currentTimeMillis;
          const writer = yield* DatabaseWriter;
          const otherOrganizationId = yield* writer
            .table("organizations")
            .insert({
              ownerUserId: seeded.ownerUserId,
              name: "Mismatch Org",
              slug: "mismatch-org",
              status: "active",
              createdAt: seedNow,
              updatedAt: seedNow,
            })
            .pipe(Effect.orDie);
          const invitationId = yield* writer
            .table("invitations")
            .insert({
              workspaceId: seeded.workspaceId,
              organizationId: otherOrganizationId,
              email: "mismatch@example.com",
              role: "viewer",
              status: "pending",
              tokenHash: "mismatch-token-hash",
              invitedByUserId: seeded.ownerUserId,
              acceptedAt: null,
              revokedAt: null,
              declinedAt: null,
              expiresAt: seedNow + INVITATION_TTL_MS,
              createdAt: seedNow,
              updatedAt: seedNow,
            })
            .pipe(Effect.orDie);
          const expiredInvitationId = yield* writer
            .table("invitations")
            .insert({
              workspaceId: seeded.workspaceId,
              organizationId: seeded.organizationId,
              email: "listed-expired@example.com",
              role: "viewer",
              status: "pending",
              tokenHash: "listed-expired-token-hash",
              invitedByUserId: seeded.ownerUserId,
              acceptedAt: null,
              revokedAt: null,
              declinedAt: null,
              expiresAt: seedNow - 1,
              createdAt: seedNow,
              updatedAt: seedNow,
            })
            .pipe(Effect.orDie);
          return { invitationId, expiredInvitationId };
        }),
        Schema.Struct({
          invitationId: Schema.String,
          expiredInvitationId: Schema.String,
        }),
      );
      const before = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const owner = confect.withIdentity({ subject: "owner-subject" });
      const accept = yield* Effect.either(
        owner.mutation(refs.public.access.invitations.accept, {
          invitationId: asGenericId<"invitations">(mismatch.invitationId),
        }),
      );
      const cancel = yield* Effect.either(
        owner.action(refs.public.access.invitations.cancel, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          invitationId: asGenericId<"invitations">(mismatch.invitationId),
        }),
      );
      const listed = yield* owner.query(refs.public.access.invitations.list, {
        workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
      });
      const after = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      return { accept, cancel, listed, before, after, mismatch };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(Either.isLeft(result.accept)).toBe(true);
    expect(Either.isLeft(result.cancel)).toBe(true);
    expect(result.after).toEqual(result.before);
    expect(result.listed.map((row) => row.invitationId)).not.toContain(
      result.mismatch.invitationId,
    );
    expect(result.listed.map((row) => row.invitationId)).not.toContain(
      result.mismatch.expiredInvitationId,
    );
  });

  it("requires owner role to cancel pending owner invitations and audits admin denial", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        privilegedMutationSetup,
        PrivilegedMutationSetup,
      );
      const ownerInvitationId = yield* confect.run(
        Effect.gen(function* () {
          const seedNow = yield* Clock.currentTimeMillis;
          const writer = yield* DatabaseWriter;
          return yield* writer
            .table("invitations")
            .insert({
              workspaceId: seeded.workspaceId,
              organizationId: seeded.organizationId,
              email: "owner-cancel@example.com",
              role: "owner",
              status: "pending",
              tokenHash: "owner-cancel-token-hash",
              invitedByUserId: seeded.ownerUserId,
              acceptedAt: null,
              revokedAt: null,
              declinedAt: null,
              expiresAt: seedNow + INVITATION_TTL_MS,
              createdAt: seedNow,
              updatedAt: seedNow,
            })
            .pipe(Effect.orDie);
        }),
        Schema.String,
      );
      const beforeAdmin = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const adminDenied = yield* Effect.either(
        confect
          .withIdentity({ subject: "admin-subject" })
          .action(refs.public.access.invitations.cancel, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            invitationId: asGenericId<"invitations">(ownerInvitationId),
          }),
      );
      const afterAdmin = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      const auditRows = yield* confect.run(
        accessAuditRows(seeded.workspaceId),
        Schema.Any,
      );
      const ownerSuccess = yield* Effect.either(
        confect
          .withIdentity({ subject: "owner-subject" })
          .action(refs.public.access.invitations.cancel, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            invitationId: asGenericId<"invitations">(ownerInvitationId),
          }),
      );
      const afterOwner = yield* confect.run(
        productStateSnapshot(seeded.workspaceId),
        Schema.Any,
      );
      return {
        ownerInvitationId,
        adminDenied,
        ownerSuccess,
        beforeAdmin,
        afterAdmin,
        afterOwner,
        auditRows,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(Either.isLeft(result.adminDenied)).toBe(true);
    if (Either.isLeft(result.adminDenied)) {
      expect(result.adminDenied.left).toBeInstanceOf(Forbidden);
    }
    expect(result.afterAdmin).toEqual(result.beforeAdmin);
    expect(result.auditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "invitation.cancelled",
          subjectId: result.ownerInvitationId,
          metadataJson: '{"outcome":"denied","reason":"Forbidden"}',
        }),
      ]),
    );
    expect(JSON.stringify(result.auditRows)).not.toContain(
      "owner-cancel@example.com",
    );
    expect(Either.isRight(result.ownerSuccess)).toBe(true);
    expect(result.afterOwner.invitations).toContainEqual(
      expect.objectContaining({
        id: result.ownerInvitationId,
        status: "cancelled",
      }),
    );
  });

  it("builds redacted member denial audit metadata from typed server errors", () => {
    const row = accessAuditEventInsert(
      deniedPrivilegedAccessAuditEvent({
        action: "member.roleChanged",
        workspaceId: "workspaces_brain",
        actorUserId: "users_viewer",
        subjectKind: "workspaceMember",
        subjectId: "workspaceMembers_target",
        reason: denialAuditReason(
          new Forbidden({ reason: "Member management requires admin." }),
        ),
      }),
      now,
    );

    expect(row).toMatchObject({
      action: "member.roleChanged",
      actorUserId: "users_viewer",
      subjectKind: "workspaceMember",
      subjectId: "workspaceMembers_target",
      metadataJson: '{"outcome":"denied","reason":"Forbidden"}',
    });
    expect(row.metadataJson).not.toContain("viewer@example.com");
  });

  it("builds redacted invitation denial audit metadata from typed server errors", () => {
    const row = accessAuditEventInsert(
      deniedPrivilegedAccessAuditEvent({
        action: "invitation.cancelled",
        workspaceId: "workspaces_brain",
        actorUserId: "users_viewer",
        subjectKind: "invitation",
        subjectId: "invitations_pending",
        reason: denialAuditReason(
          new Forbidden({ reason: "Insufficient workspace role." }),
        ),
      }),
      now,
    );

    expect(row).toMatchObject({
      action: "invitation.cancelled",
      subjectKind: "invitation",
      subjectId: "invitations_pending",
      metadataJson: '{"outcome":"denied","reason":"Forbidden"}',
    });
    expect(row.metadataJson).not.toContain("invitee@example.com");
  });

  it("declares one redacted privileged audit vocabulary for later Brain actions", () => {
    expect(privilegedAccessAuditActions).toEqual([
      "member.roleChanged",
      "member.removed",
      "member.ownershipTransferred",
      "invitation.created",
      "invitation.accepted",
      "invitation.declined",
      "invitation.cancelled",
      "slack.connectionChanged",
      "slack.channelPolicyChanged",
      "retention.policyChanged",
      "model.egressPolicyChanged",
      "autopilot.policyChanged",
      "export.administered",
      "apiKey.administered",
    ]);

    const row = accessAuditEventInsert(
      {
        action: "apiKey.administered",
        workspaceId: "workspaces_brain",
        actorUserId: "users_admin",
        subjectKind: "privilegedAction",
        subjectId: "key_redacted",
        metadata: { outcome: "denied", reason: "insufficient_role" },
      },
      now,
    );

    expect(row).toMatchObject({
      action: "apiKey.administered",
      subjectKind: "privilegedAction",
    });
    expect(row.metadataJson).toBe(
      '{"outcome":"denied","reason":"insufficient_role"}',
    );
    expect(row.metadataJson).not.toContain("secret");
  });
});
