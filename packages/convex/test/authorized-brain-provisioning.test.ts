import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  BrainAlreadyExists,
  Forbidden,
  OrganizationNotFound,
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../confect/errors";
import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
  BrainNotFound,
  StableKeyConflict,
  TenantMismatch,
} from "../confect/identity/stableKeys";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("authorized Brain provisioning", () => {
  it("rejects signed-out list and create without leaking public workspace ids", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );

      const listError = yield* confect
        .query(refs.public.auth.workspaces.list, {})
        .pipe(Effect.flip);
      const provisionError = yield* confect
        .mutation(refs.public.access.provisioning.ensureProvisioned, {})
        .pipe(Effect.flip);

      return { listError, provisionError };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.listError).toBeInstanceOf(Unauthorized);
    expect(result.provisionError).toBeInstanceOf(Unauthorized);
  });

  it("lists only active Brains authorized for the signed-in organization/member", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(seedAuthorizedBrains(), SeedRows);

      const adminList = yield* confect
        .withIdentity({
          subject: "admin-subject",
          email: "admin@example.com",
          emailVerified: true,
          organizationId: "org_workos_acme",
        })
        .query(refs.public.auth.workspaces.list, {});
      const clientList = yield* confect
        .withIdentity({
          subject: "client-subject",
          email: "client@example.com",
          emailVerified: true,
          organizationId: "org_workos_acme",
        })
        .query(refs.public.auth.workspaces.list, {});
      const outsiderList = yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
          emailVerified: true,
          organizationId: "org_workos_acme",
        })
        .query(refs.public.auth.workspaces.list, {});

      return { seeded, adminList, clientList, outsiderList };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.adminList.map((row) => row.brainKey).sort()).toEqual([
      result.seeded.agencyBrainKey,
      result.seeded.clientBrainKey,
    ]);
    expect(result.clientList).toEqual([
      expect.objectContaining({
        agencyKey: result.seeded.agencyKey,
        brainKey: result.seeded.clientBrainKey,
        kind: "client",
        effectiveRole: "viewer",
        status: "active",
      }),
    ]);
    expect(result.outsiderList).toEqual([]);
    expect(JSON.stringify(result.adminList)).not.toContain("workspaces_");
    expect(JSON.stringify(result.adminList)).not.toContain("organizations_");
  });

  it("returns a typed organization-not-found error when the session switches WorkOS organization", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedAuthorizedBrains(), SeedRows);

      return yield* confect
        .withIdentity({
          subject: "admin-subject",
          email: "admin@example.com",
          emailVerified: true,
          organizationId: "org_workos_unrelated",
        })
        .query(refs.public.auth.workspaces.list, {})
        .pipe(Effect.flip);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toBeInstanceOf(OrganizationNotFound);
  });

  it("rejects suspended users before listing otherwise authorized Brains", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedSuspendedAuthorizedUser(), Schema.Any);

      return yield* confect
        .withIdentity({
          subject: "suspended-subject",
          email: "suspended@example.com",
          emailVerified: true,
          organizationId: "org_workos_suspended",
        })
        .query(refs.public.auth.workspaces.list, {})
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(error).toBeInstanceOf(Unauthorized);
  });

  it("creates client Brain membership and audit event for the authorized admin", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const identity = {
        subject: "workos|client-admin",
        name: "Client Admin",
        email: "client-admin@example.com",
        emailVerified: true,
        organizationId: "org_workos_client_admin",
      };

      yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      const created = yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Northwind",
          clientSlug: "northwind",
        });
      const sideEffects = yield* confect.run(
        readClientProvisioningSideEffects(
          identity.subject,
          identity.organizationId,
          created.brainKey,
        ),
        Schema.Any,
      );

      return { created, sideEffects };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.sideEffects.workspace).toEqual(
      expect.objectContaining({
        brainKey: result.created.brainKey,
        clientSlug: "northwind",
        kind: "client",
        status: "active",
      }),
    );
    expect(result.sideEffects.membership).toEqual(
      expect.objectContaining({
        role: "owner",
        status: "active",
        revokedAt: null,
        deletedAt: null,
      }),
    );
    expect(result.sideEffects.auditEvent).toEqual(
      expect.objectContaining({
        action: "member.ownershipTransferred",
        actorUserId: result.sideEffects.user._id,
        subjectKind: "workspaceMember",
        subjectId: result.sideEffects.membership._id,
      }),
    );
    expect(JSON.parse(result.sideEffects.auditEvent.metadataJson)).toEqual({
      role: "owner",
    });
  });

  it("returns stable brainKey from provisioning instead of a Convex workspace id", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const result = yield* confect
        .withIdentity({
          subject: "workos|stable-return",
          name: "Stable Return",
          email: "stable@example.com",
          emailVerified: true,
          organizationId: "org_workos_stable",
        })
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      const listed = yield* confect
        .withIdentity({
          subject: "workos|stable-return",
          name: "Stable Return",
          email: "stable@example.com",
          emailVerified: true,
          organizationId: "org_workos_stable",
        })
        .query(refs.public.auth.workspaces.list, {});
      return { result, listed };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.result).toEqual({
      brainKey: expect.stringMatching(/^br_[0-9A-HJKMNP-TV-Z]{26}$/),
    });
    expect(JSON.stringify(result.result)).not.toContain("workspaceId");
    expect(result.listed[0]?.brainKey).toBe(result.result.brainKey);
  });

  it("fails closed on duplicate active agency Brain keys", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedDuplicateAgencyBrains(), Schema.Any);
      return yield* confect
        .withIdentity({
          subject: "admin-subject",
          email: "admin@example.com",
          emailVerified: true,
          organizationId: "org_workos_dupe",
        })
        .query(refs.public.auth.workspaces.list, {})
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(error).toBeInstanceOf(ProvisioningConflict);
    expect(error).toMatchObject({ resource: "workspaces.organizationId.kind" });
  });

  it("denies viewer and editor client Brain creation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedClientBrainCreatorRoles(), Schema.Any);

      const viewerError = yield* confect
        .withIdentity({
          subject: "viewer-subject",
          email: "viewer@example.com",
          emailVerified: true,
          organizationId: "org_workos_roles",
        })
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Viewer Client",
          clientSlug: "viewer-client",
        })
        .pipe(Effect.flip);
      const editorError = yield* confect
        .withIdentity({
          subject: "editor-subject",
          email: "editor@example.com",
          emailVerified: true,
          organizationId: "org_workos_roles",
        })
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Editor Client",
          clientSlug: "editor-client",
        })
        .pipe(Effect.flip);

      return { viewerError, editorError };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.viewerError).toBeInstanceOf(Forbidden);
    expect(result.editorError).toBeInstanceOf(Forbidden);
  });

  it("rejects duplicate client slugs during client Brain creation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedClientBrainCreatorRoles(), Schema.Any);

      return yield* confect
        .withIdentity({
          subject: "admin-subject",
          email: "admin@example.com",
          emailVerified: true,
          organizationId: "org_workos_roles",
        })
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Existing Client",
          clientSlug: "existing-client",
        })
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(error).toBeInstanceOf(BrainAlreadyExists);
    expect(error).toMatchObject({ brainKey: "existing-client" });
  });

  it("omits caller-supplied tenant ids from public operation specs", async () => {
    const workspaceSpec = JSON.stringify(refs.public.auth.workspaces.list);
    const createSpec = JSON.stringify(
      refs.public.access.provisioning.createClientBrain,
    );

    expect(workspaceSpec).not.toContain("organizationId");
    expect(workspaceSpec).not.toContain("workspaceId");
    expect(createSpec).not.toContain("organizationId");
    expect(createSpec).not.toContain("workspaceId");
  });

  it("allows org admins to resolve active workspace keys without direct membership", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedStableKeyResolutionCases(),
        StableKeyRows,
      );

      return yield* confect
        .withIdentity({
          subject: "org-admin-subject",
          email: "org-admin@example.com",
          emailVerified: true,
          organizationId: "org_workos_resolve",
        })
        .query(refs.internal.identity.stableKeys.resolveBrainKey, {
          agencyKey: seeded.agencyKey,
          brainKey: seeded.brainKey,
        });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.workspaceId).toBeDefined();
  });

  it("translates duplicate direct workspace memberships during key resolution", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedStableKeyResolutionCases(),
        StableKeyRows,
      );
      yield* confect.run(
        seedDuplicateWorkspaceMembership(seeded.workspaceId),
        Schema.Any,
      );

      return yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
          emailVerified: true,
          organizationId: "org_workos_resolve",
        })
        .query(refs.internal.identity.stableKeys.resolveBrainKey, {
          agencyKey: seeded.agencyKey,
          brainKey: seeded.brainKey,
        })
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(error).toBeInstanceOf(ProvisioningConflict);
    expect(error).toMatchObject({
      resource: "workspaceMembers.workspaceId.userId",
    });
  });

  it("resolves stable keys only for live current organization members", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedStableKeyResolutionCases(),
        StableKeyRows,
      );

      const resolved = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
          emailVerified: true,
          organizationId: "org_workos_resolve",
        })
        .query(refs.internal.identity.stableKeys.resolveBrainKey, {
          agencyKey: seeded.agencyKey,
          brainKey: seeded.brainKey,
        });
      const invalidAgency = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
          emailVerified: true,
          organizationId: "org_workos_resolve",
        })
        .query(refs.internal.identity.stableKeys.resolveBrainKey, {
          agencyKey: "not-an-agency-key",
          brainKey: seeded.brainKey,
        })
        .pipe(Effect.flip);
      const invalidBrain = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
          emailVerified: true,
          organizationId: "org_workos_resolve",
        })
        .query(refs.internal.identity.stableKeys.resolveBrainKey, {
          agencyKey: seeded.agencyKey,
          brainKey: "not-a-brain-key",
        })
        .pipe(Effect.flip);
      const crossOrg = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
          emailVerified: true,
          organizationId: "org_workos_resolve",
        })
        .query(refs.internal.identity.stableKeys.resolveBrainKey, {
          agencyKey: seeded.otherAgencyKey,
          brainKey: seeded.otherBrainKey,
        })
        .pipe(Effect.flip);
      const duplicateBrainKey = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
          emailVerified: true,
          organizationId: "org_workos_resolve",
        })
        .query(refs.internal.identity.stableKeys.resolveBrainKey, {
          agencyKey: seeded.agencyKey,
          brainKey: seeded.duplicateBrainKey,
        })
        .pipe(Effect.flip);
      const archivedBrain = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
          emailVerified: true,
          organizationId: "org_workos_resolve",
        })
        .query(refs.internal.identity.stableKeys.resolveBrainKey, {
          agencyKey: seeded.agencyKey,
          brainKey: seeded.archivedBrainKey,
        })
        .pipe(Effect.flip);
      const missingMembership = yield* confect
        .withIdentity({
          subject: "nonmember-subject",
          email: "nonmember@example.com",
          emailVerified: true,
          organizationId: "org_workos_resolve",
        })
        .query(refs.internal.identity.stableKeys.resolveBrainKey, {
          agencyKey: seeded.agencyKey,
          brainKey: seeded.brainKey,
        })
        .pipe(Effect.flip);

      return {
        seeded,
        resolved,
        invalidAgency,
        invalidBrain,
        crossOrg,
        duplicateBrainKey,
        archivedBrain,
        missingMembership,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.resolved).toEqual({
      organizationId: result.seeded.organizationId,
      workspaceId: result.seeded.workspaceId,
    });
    expect(result.invalidAgency).toBeInstanceOf(ValidationFailed);
    expect(result.invalidBrain).toBeInstanceOf(ValidationFailed);
    expect(result.crossOrg).toBeInstanceOf(TenantMismatch);
    expect(result.duplicateBrainKey).toBeInstanceOf(StableKeyConflict);
    expect(result.archivedBrain).toBeInstanceOf(BrainNotFound);
    expect(result.missingMembership).toBeInstanceOf(Forbidden);
  });

  it("declares stable-key resolver Confect specs without public visibility", async () => {
    const stableKeys = await import("../confect/identity/stableKeys.spec");
    expect(JSON.stringify(stableKeys.default)).toContain("resolveBrainKey");
    expect(JSON.stringify(stableKeys.default)).not.toContain(
      '"functionVisibility":"public"',
    );
  });
});

const SeedRows = Schema.Struct({
  agencyKey: Schema.String,
  agencyBrainKey: Schema.String,
  clientBrainKey: Schema.String,
});

const seedAuthorizedBrains = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
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
    const clientUserId = yield* writer
      .table("users")
      .insert({
        subject: "client-subject",
        email: "client@example.com",
        displayName: "Client",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
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
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: adminUserId,
        workosOrganizationId: "org_workos_acme",
        slug: "acme",
        name: "Acme",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const agencyKey = deriveStableAgencyKey({
      _id: organizationId,
      createdAt: now,
    });
    yield* writer
      .table("organizations")
      .patch(organizationId, { agencyKey })
      .pipe(Effect.orDie);
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId,
        userId: adminUserId,
        role: "admin",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const agencyId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: adminUserId,
        slug: "agency",
        name: "Agency Brain",
        kind: "agency",
        status: "active",
        dataClassification: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const clientId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: adminUserId,
        slug: "client",
        name: "Client Brain",
        kind: "client",
        clientSlug: "client",
        status: "active",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const archivedId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: adminUserId,
        slug: "archived",
        name: "Archived Brain",
        kind: "client",
        clientSlug: "archived",
        status: "archived",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const agencyBrainKey = deriveStableBrainKey({
      _id: agencyId,
      createdAt: now,
    });
    const clientBrainKey = deriveStableBrainKey({
      _id: clientId,
      createdAt: now,
    });
    const archivedBrainKey = deriveStableBrainKey({
      _id: archivedId,
      createdAt: now,
    });
    yield* writer
      .table("workspaces")
      .patch(agencyId, { brainKey: agencyBrainKey })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaces")
      .patch(clientId, { brainKey: clientBrainKey })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaces")
      .patch(archivedId, { brainKey: archivedBrainKey })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId: clientId,
        userId: clientUserId,
        role: "viewer",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return { agencyKey, agencyBrainKey, clientBrainKey };
  });

const seedSuspendedAuthorizedUser = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const suspendedUserId = yield* writer
      .table("users")
      .insert({
        subject: "suspended-subject",
        email: "suspended@example.com",
        displayName: "Suspended",
        status: "suspended",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: suspendedUserId,
        workosOrganizationId: "org_workos_suspended",
        slug: "suspended-org",
        name: "Suspended Org",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const agencyKey = deriveStableAgencyKey({
      _id: organizationId,
      createdAt: now,
    });
    yield* writer
      .table("organizations")
      .patch(organizationId, { agencyKey })
      .pipe(Effect.orDie);
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId,
        userId: suspendedUserId,
        role: "admin",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: suspendedUserId,
        slug: "suspended-agency",
        name: "Suspended Agency",
        kind: "agency",
        status: "active",
        dataClassification: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const brainKey = deriveStableBrainKey({
      _id: workspaceId,
      createdAt: now,
    });
    yield* writer
      .table("workspaces")
      .patch(workspaceId, { brainKey })
      .pipe(Effect.orDie);
  });

const seedDuplicateAgencyBrains = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
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
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: adminUserId,
        workosOrganizationId: "org_workos_dupe",
        agencyKey: "ag_01J0000000000000000000000A",
        slug: "dupe",
        name: "Dupe",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId,
        userId: adminUserId,
        role: "admin",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    for (const slug of ["one", "two"] as const) {
      yield* writer
        .table("workspaces")
        .insert({
          organizationId,
          ownerUserId: adminUserId,
          brainKey: `br_01J0000000000000000000000${slug === "one" ? "A" : "B"}`,
          slug,
          name: slug,
          kind: "agency",
          status: "active",
          dataClassification: "internal",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
  });

const readClientProvisioningSideEffects = (
  subject: string,
  workosOrganizationId: string,
  brainKey: string,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const users = yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", subject))
      .collect()
      .pipe(Effect.orDie);
    const user = users[0];
    if (user === undefined) throw new Error("expected seeded user");

    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations[0];
    if (organization === undefined) {
      throw new Error("expected provisioned organization");
    }

    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization_brain_key", (q) =>
        q.eq("organizationId", organization._id).eq("brainKey", brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const workspace = workspaces[0];
    if (workspace === undefined) throw new Error("expected client workspace");

    const memberships = yield* reader
      .table("workspaceMembers")
      .index("by_workspace_user", (q) =>
        q.eq("workspaceId", workspace._id).eq("userId", user._id),
      )
      .collect()
      .pipe(Effect.orDie);
    const membership = memberships[0];
    if (membership === undefined) {
      throw new Error("expected creator workspace membership");
    }

    const auditEvents = yield* reader
      .table("accessAuditEvents")
      .index("by_subject", (q) =>
        q.eq("subjectKind", "workspaceMember").eq("subjectId", membership._id),
      )
      .collect()
      .pipe(Effect.orDie);
    const auditEvent = auditEvents[0];
    if (auditEvent === undefined) {
      throw new Error("expected creator membership audit event");
    }

    return { user, organization, workspace, membership, auditEvent };
  });

const StableKeyRows = Schema.Struct({
  organizationId: Schema.String,
  workspaceId: Schema.String,
  agencyKey: Schema.String,
  brainKey: Schema.String,
  archivedBrainKey: Schema.String,
  duplicateBrainKey: Schema.String,
  otherAgencyKey: Schema.String,
  otherBrainKey: Schema.String,
});

const seedClientBrainCreatorRoles = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
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
    const viewerUserId = yield* writer
      .table("users")
      .insert({
        subject: "viewer-subject",
        email: "viewer@example.com",
        displayName: "Viewer",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const editorUserId = yield* writer
      .table("users")
      .insert({
        subject: "editor-subject",
        email: "editor@example.com",
        displayName: "Editor",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: adminUserId,
        workosOrganizationId: "org_workos_roles",
        agencyKey: "ag_01J0000000000000000000000R",
        slug: "roles",
        name: "Roles Org",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    for (const [userId, role] of [
      [adminUserId, "admin"],
      [viewerUserId, "viewer"],
      [editorUserId, "editor"],
    ] as const) {
      yield* writer
        .table("organizationMembers")
        .insert({
          organizationId,
          userId,
          role,
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
    const agencyWorkspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: adminUserId,
        brainKey: "br_01J0000000000000000000000R",
        slug: "agency",
        name: "Agency Brain",
        kind: "agency",
        status: "active",
        dataClassification: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: adminUserId,
        brainKey: "br_01J0000000000000000000000S",
        slug: "existing-client",
        name: "Existing Client",
        kind: "client",
        clientSlug: "existing-client",
        status: "active",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    for (const userId of [viewerUserId, editorUserId] as const) {
      yield* writer
        .table("workspaceMembers")
        .insert({
          workspaceId: agencyWorkspaceId,
          userId,
          role: userId === viewerUserId ? "viewer" : "editor",
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
  });

const seedStableKeyResolutionCases = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const memberUserId = yield* writer
      .table("users")
      .insert({
        subject: "member-subject",
        email: "member@example.com",
        displayName: "Member",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const orgAdminUserId = yield* writer
      .table("users")
      .insert({
        subject: "org-admin-subject",
        email: "org-admin@example.com",
        displayName: "Org Admin",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const nonmemberUserId = yield* writer
      .table("users")
      .insert({
        subject: "nonmember-subject",
        email: "nonmember@example.com",
        displayName: "Nonmember",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: memberUserId,
        workosOrganizationId: "org_workos_resolve",
        agencyKey: "ag_01J0000000000000000000000M",
        slug: "resolve",
        name: "Resolve Org",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    for (const [userId, role] of [
      [memberUserId, "viewer"],
      [orgAdminUserId, "admin"],
    ] as const) {
      yield* writer
        .table("organizationMembers")
        .insert({
          organizationId,
          userId,
          role,
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: memberUserId,
        brainKey: "br_01J0000000000000000000000M",
        slug: "client",
        name: "Client Brain",
        kind: "client",
        status: "active",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId,
        userId: memberUserId,
        role: "viewer",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const archivedWorkspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: memberUserId,
        brainKey: "br_01J0000000000000000000000N",
        slug: "archived-resolve",
        name: "Archived Resolve",
        kind: "client",
        status: "archived",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const duplicateBrainKey = "br_01J0000000000000000000000P";
    for (const slug of ["dupe-one", "dupe-two"] as const) {
      yield* writer
        .table("workspaces")
        .insert({
          organizationId,
          ownerUserId: memberUserId,
          brainKey: duplicateBrainKey,
          slug,
          name: slug,
          kind: "client",
          status: "active",
          dataClassification: "confidential",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
    const otherOrganizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: memberUserId,
        workosOrganizationId: "org_workos_other_resolve",
        agencyKey: "ag_01J0000000000000000000000Q",
        slug: "other-resolve",
        name: "Other Resolve Org",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const otherWorkspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId: otherOrganizationId,
        ownerUserId: memberUserId,
        brainKey: "br_01J0000000000000000000000Q",
        slug: "other-client",
        name: "Other Client Brain",
        kind: "client",
        status: "active",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);

    return {
      organizationId,
      workspaceId,
      agencyKey: "ag_01J0000000000000000000000M",
      brainKey: "br_01J0000000000000000000000M",
      archivedBrainKey: "br_01J0000000000000000000000N",
      duplicateBrainKey,
      otherAgencyKey: "ag_01J0000000000000000000000Q",
      otherBrainKey: "br_01J0000000000000000000000Q",
      archivedWorkspaceId,
      otherWorkspaceId,
      nonmemberUserId,
    };
  });

const seedDuplicateWorkspaceMembership = (workspaceId: string) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const reader = yield* DatabaseReader;
    const users = yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", "member-subject"))
      .collect()
      .pipe(Effect.orDie);
    const user = users[0];
    if (user === undefined) throw new Error("expected member user");
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId,
        userId: user._id,
        role: "viewer",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
  });
