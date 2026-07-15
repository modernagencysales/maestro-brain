import { TestConfect } from "@confect/test";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseWriter } from "../confect/_generated/services";
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
    workspaceId,
    otherWorkspaceId,
    pendingInvitationId,
    acceptedInvitationId,
    deletedInvitationId,
  };
});

const PrivilegedMutationSetup = Schema.Struct({
  deletedMembershipId: Schema.String,
  ownerMembershipId: Schema.String,
  targetMembershipId: Schema.String,
  workspaceId: Schema.String,
  otherWorkspaceId: Schema.String,
  pendingInvitationId: Schema.String,
  acceptedInvitationId: Schema.String,
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
        confect.mutation(refs.public.access.members.changeRole, {
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
        outsider.mutation(refs.public.access.members.remove, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          membershipId: asGenericId<"workspaceMembers">(
            seeded.ownerMembershipId,
          ),
        }),
      );
      const missingTarget = yield* Effect.either(
        outsider.mutation(refs.public.access.members.remove, {
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
          .mutation(refs.public.access.invitations.create, {
            workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
            email: "new-owner@example.com",
            role: "owner",
          }),
      );
      const ownerGrant = yield* Effect.either(
        confect
          .withIdentity({ subject: "owner-subject" })
          .mutation(refs.public.access.invitations.create, {
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
        owner.mutation(refs.public.access.invitations.cancel, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          invitationId: asGenericId<"invitations">(seeded.deletedInvitationId),
        }),
      );
      const crossBrain = yield* Effect.either(
        owner.mutation(refs.public.access.invitations.cancel, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          invitationId: asGenericId<"invitations">(seeded.pendingInvitationId),
        }),
      );
      const nonPending = yield* Effect.either(
        owner.mutation(refs.public.access.invitations.cancel, {
          workspaceId: asGenericId<"workspaces">(seeded.workspaceId),
          invitationId: asGenericId<"invitations">(seeded.acceptedInvitationId),
        }),
      );
      return { missing, crossBrain, nonPending };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    for (const cancellation of [
      result.missing,
      result.crossBrain,
      result.nonPending,
    ]) {
      expect(Either.isLeft(cancellation)).toBe(true);
      if (Either.isLeft(cancellation)) {
        expect(cancellation.left).toBeInstanceOf(Forbidden);
      }
    }
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
