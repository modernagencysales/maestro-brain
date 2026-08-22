import { TestConfect } from "@confect/test";
import type { Ref } from "@confect/core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  CapacityExceeded,
  ClientBrainAlreadyExists,
  Forbidden,
  OrganizationNotFound,
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../confect/errors";
import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
  AgencyNotFound,
  BrainNotFound,
  StableKeyConflict,
  TenantMismatch,
} from "../confect/identity/stableKeys";
import {
  ResolveBrainKeyArgs,
  ResolveBrainKeyReturns,
} from "../confect/identity/stableKeys.spec";
import { standardClientBriefPages } from "../confect/brain/clientBrief";
import { insertStandardClientBriefPages } from "../confect/access/provisioning.impl";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

type ResolveBrainKeyRef = Ref.Ref<
  { readonly runtime: "Convex"; readonly functionType: "query" },
  "internal",
  Schema.Schema.Type<typeof ResolveBrainKeyArgs>,
  Schema.Schema.Type<typeof ResolveBrainKeyReturns>,
  | Unauthorized
  | ValidationFailed
  | Forbidden
  | AgencyNotFound
  | BrainNotFound
  | StableKeyConflict
  | TenantMismatch
  | ProvisioningConflict
>;

type StableKeyResolverRefs = {
  readonly internal: {
    readonly identity: {
      readonly stableKeys: { readonly resolveBrainKey: ResolveBrainKeyRef };
    };
  };
};

// The stable-key resolver wrapper is integration-owned until centralized Confect
// codegen refreshes the checked-in refs; keep the runtime generated refs path.
const generatedRefsWithStableKeyResolver = refs as typeof refs &
  StableKeyResolverRefs;

const resolveBrainKeyRef = (): ResolveBrainKeyRef =>
  generatedRefsWithStableKeyResolver.internal.identity.stableKeys
    .resolveBrainKey;

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
          idempotencyKey: "idem-northwind-01",
        });
      const sideEffects = yield* confect.run(
        readClientProvisioningSideEffects(
          identity.subject,
          identity.organizationId,
          created.brainKey,
        ),
        ClientProvisioningSideEffects,
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

  it("retries the same client creation key without rewriting durable rows", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const identity = {
        subject: "workos|retry-admin",
        name: "Retry Admin",
        email: "retry-admin@example.com",
        emailVerified: true,
        organizationId: "org_workos_retry_admin",
      };
      yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      const first = yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Retry Client",
          clientSlug: "retry-client",
          idempotencyKey: "idem-retry-client",
        });
      const before = yield* confect.run(
        countClientWorkspaces(identity.organizationId),
        Schema.Number,
      );
      yield* confect.run(
        renameAndReorderClientBrief(identity.organizationId, first.brainKey),
        Schema.Any,
      );
      const retry = yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Retry Client",
          clientSlug: "retry-client",
          idempotencyKey: "idem-retry-client",
        });
      const pages = yield* confect.run(
        readClientBriefPages(identity.organizationId, first.brainKey),
        ClientBriefPageRows,
      );
      const after = yield* confect.run(
        countClientWorkspaces(identity.organizationId),
        Schema.Number,
      );
      return { first, retry, before, after, pages };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.retry).toEqual(result.first);
    expect(result.before).toBe(1);
    expect(result.after).toBe(1);
    expect(result.pages.map((page) => page.pageKey).sort()).toEqual(
      result.first.pages.map((page) => page.pageKey).sort(),
    );
  });

  it("keeps same-slug client Brief page keys tenant scoped", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const firstIdentity = {
        subject: "workos|same-slug-one",
        name: "Same Slug One",
        email: "same-slug-one@example.com",
        emailVerified: true,
        organizationId: "org_workos_same_slug_one",
      };
      const secondIdentity = {
        subject: "workos|same-slug-two",
        name: "Same Slug Two",
        email: "same-slug-two@example.com",
        emailVerified: true,
        organizationId: "org_workos_same_slug_two",
      };
      yield* confect
        .withIdentity(firstIdentity)
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      yield* confect
        .withIdentity(secondIdentity)
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      const first = yield* confect
        .withIdentity(firstIdentity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Shared Slug",
          clientSlug: "shared-slug",
          idempotencyKey: "idem-shared-slug-one",
        });
      const second = yield* confect
        .withIdentity(secondIdentity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Shared Slug",
          clientSlug: "shared-slug",
          idempotencyKey: "idem-shared-slug-two",
        });
      return { first, second };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.first.brainKey).not.toBe(result.second.brainKey);
    expect(result.first.pages.map((page) => page.pageKey)).not.toEqual(
      result.second.pages.map((page) => page.pageKey),
    );
  });

  it("rejects same idempotency key for different payloads", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const identity = {
        subject: "workos|conflict-admin",
        name: "Conflict Admin",
        email: "conflict-admin@example.com",
        emailVerified: true,
        organizationId: "org_workos_conflict_admin",
      };
      yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Conflict Client",
          clientSlug: "conflict-client",
          idempotencyKey: "idem-conflict-client",
        });
      return yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Changed Client",
          clientSlug: "changed-client",
          idempotencyKey: "idem-conflict-client",
        })
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(error).toBeInstanceOf(ProvisioningConflict);
    expect(error).toMatchObject({
      resource: "workspaces.organizationId.clientCreationIdempotencyKey",
    });
  });

  it("rejects duplicate persisted idempotency rows", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const identity = {
        subject: "workos|dupe-idem-admin",
        name: "Dupe Idem Admin",
        email: "dupe-idem-admin@example.com",
        emailVerified: true,
        organizationId: "org_workos_dupe_idem_admin",
      };
      yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Dupe Idem Client",
          clientSlug: "dupe-idem-client",
          idempotencyKey: "idem-dupe-idem-client",
        });
      yield* confect.run(
        insertDuplicateClientIdempotencyRow(
          identity.subject,
          identity.organizationId,
          "idem-dupe-idem-client",
        ),
        Schema.Any,
      );
      return yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Dupe Idem Client",
          clientSlug: "dupe-idem-client",
          idempotencyKey: "idem-dupe-idem-client",
        })
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(error).toBeInstanceOf(ProvisioningConflict);
    expect(error).toMatchObject({
      resource: "workspaces.organizationId.clientCreationIdempotencyKey",
    });
  });

  it("rejects idempotent replay after the created client is archived", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const identity = {
        subject: "workos|archived-replay-admin",
        name: "Archived Replay Admin",
        email: "archived-replay-admin@example.com",
        emailVerified: true,
        organizationId: "org_workos_archived_replay_admin",
      };
      yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      const created = yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Archived Replay Client",
          clientSlug: "archived-replay-client",
          idempotencyKey: "idem-archived-replay-client",
        });
      yield* confect.run(
        archiveClientWorkspace(identity.organizationId, created.brainKey),
        Schema.Any,
      );
      return yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Archived Replay Client",
          clientSlug: "archived-replay-client",
          idempotencyKey: "idem-archived-replay-client",
        })
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(error).toBeInstanceOf(ProvisioningConflict);
    expect(error).toMatchObject({
      resource: "workspaces.organizationId.clientCreationIdempotencyKey",
    });
  });

  it("seeds the six ordinary Client Brief pages for new client Brains", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const identity = {
        subject: "workos|brief-admin",
        name: "Brief Admin",
        email: "brief-admin@example.com",
        emailVerified: true,
        organizationId: "org_workos_brief_admin",
      };

      yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      const created = yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Brief Client",
          clientSlug: "brief-client",
          idempotencyKey: "idem-brief-client-03",
        });

      const pages = yield* confect.run(
        readClientBriefPages(identity.organizationId, created.brainKey),
        ClientBriefPageRows,
      );
      return { created, pages };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.pages).toEqual(
      result.created.pages.map((page) =>
        expect.objectContaining({
          pageKey: page.pageKey,
          title: page.title,
          siblingSlug: page.slug,
          sortKey: page.sortKey,
          status: "active",
          currentRevisionKey: expect.stringMatching(/^rev_/),
        }),
      ),
    );
    expect(result.created.initialPageKey).toBe(
      result.created.pages[0]?.pageKey,
    );
    expect(result.pages).toHaveLength(standardClientBriefPages.length);
  });

  it("rejects existing suspended and deleted users before provisioning durable rows", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedInactiveProvisioningUsers(), Schema.Any);
      const before = yield* confect.run(
        countDurableProvisioningRows("org_workos_inactive_provisioning"),
        ProvisioningRowCounts,
      );

      const suspended = yield* confect
        .withIdentity({
          subject: "suspended-provisioning-subject",
          email: "suspended-provisioning@example.com",
          emailVerified: true,
          organizationId: "org_workos_inactive_provisioning",
        })
        .mutation(refs.public.access.provisioning.ensureProvisioned, {})
        .pipe(Effect.flip);
      const deleted = yield* confect
        .withIdentity({
          subject: "deleted-provisioning-subject",
          email: "deleted-provisioning@example.com",
          emailVerified: true,
          organizationId: "org_workos_inactive_provisioning",
        })
        .mutation(refs.public.access.provisioning.ensureProvisioned, {})
        .pipe(Effect.flip);
      const after = yield* confect.run(
        countDurableProvisioningRows("org_workos_inactive_provisioning"),
        ProvisioningRowCounts,
      );

      return { before, suspended, deleted, after };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.suspended).toBeInstanceOf(Unauthorized);
    expect(result.deleted).toBeInstanceOf(Unauthorized);
    expect(result.after).toEqual(result.before);
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

  it("translates duplicate live workspace memberships during public list", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(seedAuthorizedBrains(), SeedRows);
      yield* confect.run(
        seedDuplicatePublicListWorkspaceMembership(seeded.clientBrainKey),
        Schema.Any,
      );

      return yield* confect
        .withIdentity({
          subject: "client-subject",
          email: "client@example.com",
          emailVerified: true,
          organizationId: "org_workos_acme",
        })
        .query(refs.public.auth.workspaces.list, {})
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

  it("translates duplicate live organization memberships during public list", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedAuthorizedBrains(), SeedRows);
      yield* confect.run(
        seedDuplicatePublicListOrganizationMembership(),
        Schema.Any,
      );

      return yield* confect
        .withIdentity({
          subject: "admin-subject",
          email: "admin@example.com",
          emailVerified: true,
          organizationId: "org_workos_acme",
        })
        .query(refs.public.auth.workspaces.list, {})
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(error).toBeInstanceOf(ProvisioningConflict);
    expect(error).toMatchObject({
      resource: "organizationMembers.organizationId.userId",
    });
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
          idempotencyKey: "idem-viewer-client-04",
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
          idempotencyKey: "idem-editor-client-05",
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
          idempotencyKey: "idem-existing-client-06",
        })
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(error).toBeInstanceOf(ClientBrainAlreadyExists);
    expect(error).toMatchObject({ clientSlug: "existing-client" });
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

  it("rejects signed-out client Brain creation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      return yield* confect
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Signed Out",
          clientSlug: "signed-out",
          idempotencyKey: "idem-signed-out-07",
        })
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(error).toBeInstanceOf(Unauthorized);
  });

  it("rejects suspended and deleted client Brain creators", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedInactiveClientCreators(), Schema.Any);

      const suspended = yield* confect
        .withIdentity({
          subject: "suspended-creator-subject",
          email: "suspended-creator@example.com",
          emailVerified: true,
          organizationId: "org_workos_inactive_creators",
        })
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Suspended",
          clientSlug: "suspended",
          idempotencyKey: "idem-suspended-08",
        })
        .pipe(Effect.flip);
      const deleted = yield* confect
        .withIdentity({
          subject: "deleted-creator-subject",
          email: "deleted-creator@example.com",
          emailVerified: true,
          organizationId: "org_workos_inactive_creators",
        })
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Deleted",
          clientSlug: "deleted",
          idempotencyKey: "idem-deleted-09",
        })
        .pipe(Effect.flip);
      return { suspended, deleted };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.suspended).toBeInstanceOf(Unauthorized);
    expect(result.deleted).toBeInstanceOf(Unauthorized);
  });

  it("rejects missing or duplicate agency keys before client Brain creation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedAgencyKeyIntegrityCases(), Schema.Any);
      const missing = yield* confect
        .withIdentity({
          subject: "missing-agency-subject",
          email: "missing-agency@example.com",
          emailVerified: true,
          organizationId: "org_workos_missing_agency",
        })
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Missing",
          clientSlug: "missing",
          idempotencyKey: "idem-missing-10",
        })
        .pipe(Effect.flip);
      const duplicate = yield* confect
        .withIdentity({
          subject: "duplicate-agency-subject",
          email: "duplicate-agency@example.com",
          emailVerified: true,
          organizationId: "org_workos_duplicate_agency",
        })
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Duplicate",
          clientSlug: "duplicate",
          idempotencyKey: "idem-duplicate-11",
        })
        .pipe(Effect.flip);
      return { missing, duplicate };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.missing).toBeInstanceOf(ProvisioningConflict);
    expect(result.missing).toMatchObject({
      resource: "organizations.agencyKey",
    });
    expect(result.duplicate).toBeInstanceOf(ProvisioningConflict);
    expect(result.duplicate).toMatchObject({
      resource: "organizations.agencyKey",
    });
  });

  it("enforces client capacity at 25 while excluding archived clients", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const identity = {
        subject: "workos|capacity-admin",
        name: "Capacity Admin",
        email: "capacity-admin@example.com",
        emailVerified: true,
        organizationId: "org_workos_capacity_admin",
      };
      yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});
      const archived = yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Archived Capacity Client",
          clientSlug: "archived-capacity-client",
          idempotencyKey: "idem-archived-capacity-client",
        });
      yield* confect.run(
        archiveClientWorkspace(identity.organizationId, archived.brainKey),
        Schema.Any,
      );
      let lastCapacity: (typeof archived)["capacity"] | undefined = undefined;
      for (let index = 0; index < 25; index += 1) {
        const created = yield* confect
          .withIdentity(identity)
          .mutation(refs.public.access.provisioning.createClientBrain, {
            name: `Capacity Client ${index}`,
            clientSlug: `capacity-client-${index}`,
            idempotencyKey: `idem-capacity-client-${index}`,
          });
        lastCapacity = created.capacity;
      }
      const overLimit = yield* confect
        .withIdentity(identity)
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Capacity Overflow",
          clientSlug: "capacity-overflow",
          idempotencyKey: "idem-capacity-overflow",
        })
        .pipe(Effect.flip);
      return { lastCapacity, overLimit };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.lastCapacity).toEqual({
      clientBrains: 25,
      clientBrainLimit: 25,
      remainingClientBrains: 0,
    });
    expect(result.overLimit).toBeInstanceOf(CapacityExceeded);
  });

  it("rolls back workspace, pages, membership, and audit on partial page seed failure", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const before = yield* confect.run(
        countClientProvisioningRows(
          "org_workos_partial_seed",
          "partial-seed-client",
        ),
        ClientProvisioningRowCounts,
      );
      const failureExit = yield* Effect.exit(
        confect.run(seedPartialClientCreationFailure(), Schema.Any),
      );
      const after = yield* confect.run(
        countClientProvisioningRows(
          "org_workos_partial_seed",
          "partial-seed-client",
        ),
        ClientProvisioningRowCounts,
      );
      return { before, failureExit, after };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    if (result.failureExit._tag !== "Failure") {
      throw new Error("expected partial seed failure");
    }
    expect(String(result.failureExit.cause)).toContain("ProvisioningConflict");
    expect(result.before).toEqual(result.after);
    expect(result.after).toEqual({
      workspaces: 0,
      workspaceMembers: 0,
      pages: 0,
      auditEvents: 0,
    });
  });

  it("rejects archived client slug and rolls back failed client creation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      yield* confect.run(seedClientBrainCreatorRoles(), Schema.Any);
      const before = yield* confect.run(
        countClientWorkspaces("org_workos_roles"),
        Schema.Number,
      );
      const error = yield* confect
        .withIdentity({
          subject: "admin-subject",
          email: "admin@example.com",
          emailVerified: true,
          organizationId: "org_workos_roles",
        })
        .mutation(refs.public.access.provisioning.createClientBrain, {
          name: "Archived Client",
          clientSlug: "archived-client",
          idempotencyKey: "idem-archived-client-12",
        })
        .pipe(Effect.flip);
      const after = yield* confect.run(
        countClientWorkspaces("org_workos_roles"),
        Schema.Number,
      );
      return { before, error, after };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.error).toBeInstanceOf(ClientBrainAlreadyExists);
    expect(result.after).toBe(result.before);
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
        .query(resolveBrainKeyRef(), {
          agencyKey: seeded.agencyKey,
          brainKey: seeded.brainKey,
        });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.workspaceId).toBeDefined();
  }, 60_000);

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
        .query(resolveBrainKeyRef(), {
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
        .query(resolveBrainKeyRef(), {
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
        .query(resolveBrainKeyRef(), {
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
        .query(resolveBrainKeyRef(), {
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
        .query(resolveBrainKeyRef(), {
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
        .query(resolveBrainKeyRef(), {
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
        .query(resolveBrainKeyRef(), {
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
        .query(resolveBrainKeyRef(), {
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

const ProvisioningRowCounts = Schema.Struct({
  users: Schema.Number,
  organizations: Schema.Number,
  workspaces: Schema.Number,
  organizationMembers: Schema.Number,
  workspaceMembers: Schema.Number,
});

const ClientBriefPageRows = Schema.mutable(
  Schema.Array(
    Schema.Struct({
      pageKey: Schema.String,
      title: Schema.String,
      siblingSlug: Schema.UndefinedOr(Schema.String),
      sortKey: Schema.UndefinedOr(Schema.String),
      status: Schema.UndefinedOr(
        Schema.Literal("active", "archived", "redacted", "purged"),
      ),
      currentRevisionKey: Schema.NullOr(Schema.String),
    }),
  ),
);

const ClientProvisioningSideEffects = Schema.Struct({
  user: Schema.Struct({ _id: Schema.String }),
  organization: Schema.Struct({ _id: Schema.String }),
  workspace: Schema.Struct({
    brainKey: Schema.UndefinedOr(Schema.String),
    clientSlug: Schema.UndefinedOr(Schema.String),
    kind: Schema.UndefinedOr(Schema.Literal("agency", "client")),
    status: Schema.Literal("provisioning", "active", "archived"),
  }),
  membership: Schema.Struct({
    _id: Schema.String,
    role: Schema.Literal("viewer", "editor", "admin", "owner"),
    status: Schema.Literal("active", "pending", "revoked"),
    revokedAt: Schema.NullOr(Schema.Number),
    deletedAt: Schema.NullOr(Schema.Number),
  }),
  auditEvent: Schema.Struct({
    action: Schema.String,
    actorUserId: Schema.String,
    subjectKind: Schema.String,
    subjectId: Schema.String,
    metadataJson: Schema.String,
  }),
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
        clientCreationIdempotencyKey: "seed-client",
        clientCreationPayloadHash: "client:Client Brain",
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
        clientCreationIdempotencyKey: "seed-archived",
        clientCreationPayloadHash: "archived:Archived Brain",
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

const seedDuplicatePublicListWorkspaceMembership = (brainKey: string) =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const reader = yield* DatabaseReader;
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", "org_workos_acme"),
      )
      .collect()
      .pipe(Effect.orDie);
    const seededOrganizationId = organizations[0]?._id;
    if (seededOrganizationId === undefined)
      throw new Error("expected seeded org");
    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization_brain_key", (q) =>
        q.eq("organizationId", seededOrganizationId).eq("brainKey", brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const workspace = workspaces[0];
    if (workspace === undefined) throw new Error("expected seeded workspace");
    const users = yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", "client-subject"))
      .collect()
      .pipe(Effect.orDie);
    const user = users[0];
    if (user === undefined) throw new Error("expected seeded user");
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId: workspace._id,
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

const seedDuplicatePublicListOrganizationMembership = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const reader = yield* DatabaseReader;
    const users = yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", "admin-subject"))
      .collect()
      .pipe(Effect.orDie);
    const user = users[0];
    if (user === undefined) throw new Error("expected seeded user");
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", "org_workos_acme"),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations[0];
    if (organization === undefined) throw new Error("expected seeded org");
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId: organization._id,
        userId: user._id,
        role: "admin",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
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

const seedInactiveProvisioningUsers = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    for (const [subject, email, status] of [
      [
        "suspended-provisioning-subject",
        "suspended-provisioning@example.com",
        "suspended",
      ],
      [
        "deleted-provisioning-subject",
        "deleted-provisioning@example.com",
        "deleted",
      ],
    ] as const) {
      yield* writer
        .table("users")
        .insert({
          subject,
          email,
          displayName: email,
          status,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
  });

const countDurableProvisioningRows = (workosOrganizationId: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations[0];
    const workspaces =
      organization === undefined
        ? []
        : yield* reader
            .table("workspaces")
            .index("by_organization", (q) =>
              q.eq("organizationId", organization._id),
            )
            .take(100)
            .pipe(Effect.orDie);
    const organizationMembers =
      organization === undefined
        ? []
        : yield* reader
            .table("organizationMembers")
            .index("by_organization_status", (q) =>
              q.eq("organizationId", organization._id),
            )
            .collect()
            .pipe(Effect.orDie);
    const workspace = workspaces[0];
    const workspaceMembers =
      workspace === undefined
        ? []
        : yield* reader
            .table("workspaceMembers")
            .index("by_workspace_status", (q) =>
              q.eq("workspaceId", workspace._id),
            )
            .collect()
            .pipe(Effect.orDie);
    const suspendedUsers = yield* reader
      .table("users")
      .index("by_subject", (q) =>
        q.eq("subject", "suspended-provisioning-subject"),
      )
      .collect()
      .pipe(Effect.orDie);
    const deletedUsers = yield* reader
      .table("users")
      .index("by_subject", (q) =>
        q.eq("subject", "deleted-provisioning-subject"),
      )
      .collect()
      .pipe(Effect.orDie);
    return {
      users: suspendedUsers.length + deletedUsers.length,
      organizations: organizations.length,
      workspaces: workspaces.filter((row) =>
        organizations.some(
          (organization) => organization._id === row.organizationId,
        ),
      ).length,
      organizationMembers: organizationMembers.filter((row) =>
        organizations.some(
          (organization) => organization._id === row.organizationId,
        ),
      ).length,
      workspaceMembers: workspaceMembers.filter((row) =>
        workspaces.some((workspace) => workspace._id === row.workspaceId),
      ).length,
    };
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

const readClientBriefPages = (workosOrganizationId: string, brainKey: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations[0];
    if (organization === undefined) throw new Error("expected organization");
    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization_brain_key", (q) =>
        q.eq("organizationId", organization._id).eq("brainKey", brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const workspace = workspaces[0];
    if (workspace === undefined) throw new Error("expected workspace");
    return yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect()
      .pipe(
        Effect.map((pages) =>
          [...pages]
            .sort((a, b) => (a.sortKey ?? "").localeCompare(b.sortKey ?? ""))
            .map((page) => {
              if (page.pageKey === undefined) {
                throw new Error("expected client Brief page key");
              }
              return {
                pageKey: page.pageKey,
                title: page.title,
                siblingSlug: page.siblingSlug,
                sortKey: page.sortKey,
                status: page.status,
                currentRevisionKey: page.currentRevisionKey ?? null,
              };
            }),
        ),
        Effect.orDie,
      );
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

    return {
      user: { _id: String(user._id) },
      organization: { _id: String(organization._id) },
      workspace: {
        brainKey: workspace.brainKey,
        clientSlug: workspace.clientSlug,
        kind: workspace.kind,
        status: workspace.status,
      },
      membership: {
        _id: String(membership._id),
        role: membership.role,
        status: membership.status,
        revokedAt: membership.revokedAt ?? null,
        deletedAt: membership.deletedAt ?? null,
      },
      auditEvent: {
        action: auditEvent.action,
        actorUserId: String(auditEvent.actorUserId),
        subjectKind: auditEvent.subjectKind,
        subjectId: String(auditEvent.subjectId),
        metadataJson: auditEvent.metadataJson,
      },
    };
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
        clientCreationIdempotencyKey: "seed-existing",
        clientCreationPayloadHash: "existing-client:Existing Client",
        status: "active",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: adminUserId,
        brainKey: "br_01J0000000000000000000000T",
        slug: "archived-client",
        name: "Archived Client",
        kind: "client",
        clientSlug: "archived-client",
        clientCreationIdempotencyKey: "seed-archived-client",
        clientCreationPayloadHash: "archived-client:Archived Client",
        status: "archived",
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

const seedPartialClientCreationFailure = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const nowMs = now + 7;
    const userId = yield* writer
      .table("users")
      .insert({
        subject: "partial-seed-subject",
        email: "partial-seed@example.com",
        displayName: "Partial Seed",
        status: "active",
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: userId,
        workosOrganizationId: "org_workos_partial_seed",
        agencyKey: "ag_01J00000000000000000000PS",
        slug: "partial-seed",
        name: "Partial Seed Org",
        status: "active",
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .pipe(Effect.orDie);
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: userId,
        slug: "partial-seed-client",
        name: "Partial Seed Client",
        kind: "client",
        clientSlug: "partial-seed-client",
        clientCreationIdempotencyKey: "idem-partial-seed-client",
        clientCreationPayloadHash: "partial-seed-client:Partial Seed Client",
        status: "active",
        dataClassification: "confidential",
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .pipe(Effect.orDie);
    const brainKey = deriveStableBrainKey({
      _id: workspaceId,
      createdAt: nowMs,
    });
    yield* writer
      .table("workspaces")
      .patch(workspaceId, { brainKey })
      .pipe(Effect.orDie);
    const membershipId = yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId,
        userId,
        role: "owner",
        status: "active",
        acceptedAt: nowMs,
        revokedAt: null,
        deletedAt: null,
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("accessAuditEvents")
      .insert({
        workspaceId,
        action: "member.ownershipTransferred",
        actorUserId: userId,
        subjectKind: "workspaceMember",
        subjectId: membershipId,
        metadataJson: JSON.stringify({ role: "owner" }),
        createdAt: nowMs,
      })
      .pipe(Effect.orDie);
    let inserted = 0;
    yield* insertStandardClientBriefPages({
      brainKey,
      insertPage: (page) =>
        Effect.gen(function* () {
          inserted += 1;
          yield* writer
            .table("brainPages")
            .insert({
              workspaceId,
              organizationId,
              slug: page.slug,
              title: page.title,
              markdown: page.markdown,
              sourceKind: "markdown",
              updatedAt: nowMs,
              pageKey: page.pageKey,
              parentPageKey: null,
              siblingSlug: page.slug,
              sortKey: page.sortKey,
              favorite: page.favorite,
              status: "active",
              currentRevisionKey: null,
              lifecycle: {
                state: "active",
                generation: 0,
                updatedAt: nowMs,
                purgeAfter: null,
              },
              createdAt: nowMs,
              schemaVersion: 1,
            })
            .pipe(Effect.orDie);
          if (inserted === 3) {
            return yield* new ProvisioningConflict({
              resource: "brainPages.seed",
              message: "Injected partial page seed failure in test helper.",
            });
          }
        }),
    });
  });

const ClientProvisioningRowCounts = Schema.Struct({
  workspaces: Schema.Number,
  workspaceMembers: Schema.Number,
  pages: Schema.Number,
  auditEvents: Schema.Number,
});

const countClientProvisioningRows = (
  workosOrganizationId: string,
  clientSlug: string,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations[0];
    if (organization === undefined) {
      return { workspaces: 0, workspaceMembers: 0, pages: 0, auditEvents: 0 };
    }
    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization_client_slug", (q) =>
        q.eq("organizationId", organization._id).eq("clientSlug", clientSlug),
      )
      .collect()
      .pipe(Effect.orDie);
    let workspaceMembers = 0;
    let pages = 0;
    let auditEvents = 0;
    for (const workspace of workspaces) {
      const members = yield* reader
        .table("workspaceMembers")
        .index("by_workspace_status", (q) => q.eq("workspaceId", workspace._id))
        .collect()
        .pipe(Effect.orDie);
      workspaceMembers += members.length;
      const workspacePages = yield* reader
        .table("brainPages")
        .index("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect()
        .pipe(Effect.orDie);
      pages += workspacePages.length;
      for (const member of members) {
        const events = yield* reader
          .table("accessAuditEvents")
          .index("by_subject", (q) =>
            q.eq("subjectKind", "workspaceMember").eq("subjectId", member._id),
          )
          .collect()
          .pipe(Effect.orDie);
        auditEvents += events.length;
      }
    }
    return {
      workspaces: workspaces.length,
      workspaceMembers,
      pages,
      auditEvents,
    };
  });

const renameAndReorderClientBrief = (
  workosOrganizationId: string,
  brainKey: string,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations[0];
    if (organization === undefined) throw new Error("expected organization");
    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization_brain_key", (q) =>
        q.eq("organizationId", organization._id).eq("brainKey", brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const workspace = workspaces[0];
    if (workspace === undefined) throw new Error("expected workspace");
    const pages = yield* reader
      .table("brainPages")
      .index("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect()
      .pipe(Effect.orDie);
    for (const [index, page] of pages.entries()) {
      yield* writer
        .table("brainPages")
        .patch(page._id, {
          title: `${page.title} renamed`,
          slug: `${page.slug}-renamed`,
          siblingSlug: `${page.slug}-renamed`,
          sortKey: String(pages.length - index).padStart(10, "0"),
        })
        .pipe(Effect.orDie);
    }
  });

const archiveClientWorkspace = (
  workosOrganizationId: string,
  brainKey: string,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations[0];
    if (organization === undefined) throw new Error("expected organization");
    const workspaces = yield* reader
      .table("workspaces")
      .index("by_organization_brain_key", (q) =>
        q.eq("organizationId", organization._id).eq("brainKey", brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    const workspace = workspaces[0];
    if (workspace === undefined) throw new Error("expected workspace");
    yield* writer
      .table("workspaces")
      .patch(workspace._id, { status: "archived", updatedAt: now + 1 })
      .pipe(Effect.orDie);
  });

const insertDuplicateClientIdempotencyRow = (
  subject: string,
  workosOrganizationId: string,
  idempotencyKey: string,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const users = yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", subject))
      .collect()
      .pipe(Effect.orDie);
    const user = users[0];
    if (user === undefined) throw new Error("expected user");
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations[0];
    if (organization === undefined) throw new Error("expected organization");
    yield* writer
      .table("workspaces")
      .insert({
        organizationId: organization._id,
        ownerUserId: user._id,
        brainKey: "br_01J0000000000000000000DUP",
        slug: "dupe-idem-shadow",
        name: "Dupe Idem Shadow",
        kind: "client",
        clientSlug: "dupe-idem-shadow",
        clientCreationIdempotencyKey: idempotencyKey,
        clientCreationPayloadHash: "dupe-idem-client:Dupe Idem Client",
        status: "active",
        dataClassification: "confidential",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
  });

const countClientWorkspaces = (workosOrganizationId: string) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const organizations = yield* reader
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const organization = organizations[0];
    if (organization === undefined) return 0;
    const rows = yield* reader
      .table("workspaces")
      .index("by_organization", (q) => q.eq("organizationId", organization._id))
      .collect()
      .pipe(Effect.orDie);
    return rows.filter((row) => row.kind === "client").length;
  });

const seedInactiveClientCreators = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const suspendedUserId = yield* writer
      .table("users")
      .insert({
        subject: "suspended-creator-subject",
        email: "suspended-creator@example.com",
        displayName: "Suspended",
        status: "suspended",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const deletedUserId = yield* writer
      .table("users")
      .insert({
        subject: "deleted-creator-subject",
        email: "deleted-creator@example.com",
        displayName: "Deleted",
        status: "deleted",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: suspendedUserId,
        workosOrganizationId: "org_workos_inactive_creators",
        agencyKey: "ag_01J0000000000000000000000U",
        slug: "inactive-creators",
        name: "Inactive",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    for (const userId of [suspendedUserId, deletedUserId] as const) {
      yield* writer
        .table("organizationMembers")
        .insert({
          organizationId,
          userId,
          role: "admin",
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
  });

const seedAgencyKeyIntegrityCases = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    for (const [subject, email, workosOrganizationId, agencyKey] of [
      [
        "missing-agency-subject",
        "missing-agency@example.com",
        "org_workos_missing_agency",
        undefined,
      ],
      [
        "duplicate-agency-subject",
        "duplicate-agency@example.com",
        "org_workos_duplicate_agency",
        "ag_01J0000000000000000000000V",
      ],
      [
        "other-duplicate-agency-subject",
        "other-duplicate@example.com",
        "org_workos_other_duplicate_agency",
        "ag_01J0000000000000000000000V",
      ],
    ] as const) {
      const userId = yield* writer
        .table("users")
        .insert({
          subject,
          email,
          displayName: subject,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      const organizationId = yield* writer
        .table("organizations")
        .insert({
          ownerUserId: userId,
          workosOrganizationId,
          ...(agencyKey === undefined ? {} : { agencyKey }),
          slug: subject,
          name: subject,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      yield* writer
        .table("organizationMembers")
        .insert({
          organizationId,
          userId,
          role: "admin",
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      yield* writer
        .table("workspaces")
        .insert({
          organizationId,
          ownerUserId: userId,
          brainKey: `br_01J0000000000000000000000${subject[0] === "m" ? "W" : subject[0] === "d" ? "X" : "Y"}`,
          slug: `${subject}-agency`,
          name: "Agency",
          kind: "agency",
          status: "active",
          dataClassification: "internal",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }
  });
