import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseWriter } from "../confect/_generated/services";
import { ProvisioningConflict, Unauthorized } from "../confect/errors";
import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
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
        })
        .query(refs.public.auth.workspaces.list, {});
      const clientList = yield* confect
        .withIdentity({
          subject: "client-subject",
          email: "client@example.com",
          emailVerified: true,
        })
        .query(refs.public.auth.workspaces.list, {});
      const outsiderList = yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
          emailVerified: true,
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
