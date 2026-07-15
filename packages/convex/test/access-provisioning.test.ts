import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { asGenericId } from "../confect/access/handlerContext";
import {
  buildProvisioningPlan,
  extractIdentityProfile,
  requireInsertValue,
  selectLiveOwnedOrganization,
  selectLiveOwnedWorkspace,
  type ProvisioningState,
} from "../confect/access/provisioning";
import {
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../confect/errors";
import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
} from "../confect/identity/stableKeys";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

const emptyState: ProvisioningState = {
  user: null,
  liveOrganization: null,
  liveWorkspace: null,
  organizationMembership: null,
  workspaceMembership: null,
};

describe("access provisioning", () => {
  it("declares an ensureProvisioned Confect mutation for the web quickstart path", () => {
    expect(refs.public.access.provisioning.ensureProvisioned).toMatchObject({
      functionNamespace: "access/provisioning",
      functionSpec: {
        name: "ensureProvisioned",
        functionVisibility: "public",
      },
    });
  });

  it("extracts a verified identity profile from provider identity claims", () => {
    const profile = Effect.runSync(
      extractIdentityProfile({
        subject: "workos|user_12345678",
        name: "Ada Lovelace",
        email: " ADA@Example.COM ",
        emailVerified: true,
      }),
    );

    expect(profile).toEqual({
      subject: "workos|user_12345678",
      displayName: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("rejects missing identity before any row planning occurs", () => {
    const error = Effect.runSync(Effect.flip(extractIdentityProfile(null)));

    expect(error).toBeInstanceOf(Unauthorized);
  });

  it("rejects unverified or malformed email claims", () => {
    const malformed = Effect.runSync(
      Effect.flip(
        extractIdentityProfile({
          subject: "workos|user_12345678",
          name: "Ada",
          email: "not-an-email",
          emailVerified: true,
        }),
      ),
    );

    const unverified = Effect.runSync(
      Effect.flip(
        extractIdentityProfile({
          subject: "workos|user_12345678",
          name: "Ada",
          email: "ada@example.com",
          emailVerified: false,
        }),
      ),
    );

    expect(malformed).toBeInstanceOf(ValidationFailed);
    expect(unverified).toBeInstanceOf(ValidationFailed);
  });

  it("plans first sign-in rows for user, organization, workspace, and owner memberships", () => {
    const result = buildProvisioningPlan({
      identity: {
        subject: "workos|user_12345678",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
      },
      state: emptyState,
      now,
    });

    expect(Either.isRight(result)).toBe(true);
    const plan = Either.getOrThrow(result);

    expect(plan).toMatchObject({
      user: {
        action: "insert",
        value: {
          subject: "workos|user_12345678",
          email: "ada@example.com",
          displayName: "Ada Lovelace",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      },
      organization: {
        action: "insert",
        value: {
          ownerUserId: "{userId}",
          slug: "ada-lovelace-12345678",
          name: "Ada Lovelace",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      },
      workspace: {
        action: "insert",
        value: {
          slug: "ada-lovelace-12345678",
          name: "Ada Lovelace Workspace",
          status: "active",
          dataClassification: "internal",
          createdAt: now,
          updatedAt: now,
        },
      },
      organizationMembership: {
        action: "insert",
        value: {
          role: "owner",
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      workspaceMembership: {
        action: "insert",
        value: {
          role: "owner",
          status: "active",
          acceptedAt: now,
          revokedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });

  it("is idempotent for an already provisioned active owner", () => {
    const result = buildProvisioningPlan({
      identity: {
        subject: "workos|user_12345678",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
      },
      state: {
        user: {
          _id: "users_1",
          subject: "workos|user_12345678",
          email: "ada@example.com",
          displayName: "Ada Lovelace",
          status: "active",
          createdAt: now - 100,
          updatedAt: now - 100,
        },
        liveOrganization: {
          _id: "organizations_1",
          ownerUserId: "users_1",
          workosOrganizationId: undefined,
          agencyKey: deriveStableAgencyKey({
            _id: "organizations_1",
            createdAt: now - 100,
          }),
          slug: "ada-lovelace-12345678",
          name: "Ada Lovelace",
          status: "active",
          createdAt: now - 100,
          updatedAt: now - 100,
          lifecycleGeneration: 0,
          revocationGeneration: 0,
        },
        liveWorkspace: {
          _id: "workspaces_1",
          organizationId: "organizations_1",
          ownerUserId: "users_1",
          brainKey: deriveStableBrainKey({
            _id: "workspaces_1",
            createdAt: now - 100,
          }),
          slug: "ada-lovelace-12345678",
          name: "Ada Lovelace Workspace",
          status: "active",
          dataClassification: "internal",
          createdAt: now - 100,
          updatedAt: now - 100,
          kind: "agency",
          lifecycleGeneration: 0,
          revocationGeneration: 0,
        },
        organizationMembership: {
          _id: "organizationMembers_1",
          organizationId: "organizations_1",
          userId: "users_1",
          role: "owner",
          status: "active",
          acceptedAt: now - 100,
          revokedAt: null,
          createdAt: now - 100,
          updatedAt: now - 100,
        },
        workspaceMembership: {
          _id: "workspaceMembers_1",
          workspaceId: "workspaces_1",
          userId: "users_1",
          role: "owner",
          status: "active",
          acceptedAt: now - 100,
          revokedAt: null,
          deletedAt: null,
          createdAt: now - 100,
          updatedAt: now - 100,
        },
      },
      now,
    });

    expect(Either.isRight(result)).toBe(true);
    const plan = Either.getOrThrow(result);

    expect(plan.user.action).toBe("none");
    expect(plan.organization.action).toBe("none");
    expect(plan.workspace.action).toBe("none");
    expect(plan.organizationMembership.action).toBe("none");
    expect(plan.workspaceMembership.action).toBe("none");
  });

  it("self-heals changed email and revoked owner memberships without duplicating rows", () => {
    const result = buildProvisioningPlan({
      identity: {
        subject: "workos|user_12345678",
        displayName: "Ada Lovelace",
        email: "new@example.com",
      },
      state: {
        user: {
          _id: "users_1",
          subject: "workos|user_12345678",
          email: "old@example.com",
          displayName: "Ada Lovelace",
          status: "active",
          createdAt: now - 100,
          updatedAt: now - 100,
        },
        liveOrganization: {
          _id: "organizations_1",
          ownerUserId: "users_1",
          workosOrganizationId: undefined,
          agencyKey: deriveStableAgencyKey({
            _id: "organizations_1",
            createdAt: now - 100,
          }),
          slug: "ada-lovelace-12345678",
          name: "Ada Lovelace",
          status: "active",
          createdAt: now - 100,
          updatedAt: now - 100,
        },
        liveWorkspace: {
          _id: "workspaces_1",
          organizationId: "organizations_1",
          ownerUserId: "users_1",
          brainKey: deriveStableBrainKey({
            _id: "workspaces_1",
            createdAt: now - 100,
          }),
          slug: "ada-lovelace-12345678",
          name: "Ada Lovelace Workspace",
          status: "active",
          dataClassification: "internal",
          createdAt: now - 100,
          updatedAt: now - 100,
        },
        organizationMembership: {
          _id: "organizationMembers_1",
          organizationId: "organizations_1",
          userId: "users_1",
          role: "viewer",
          status: "revoked",
          acceptedAt: null,
          revokedAt: now - 50,
          createdAt: now - 100,
          updatedAt: now - 50,
        },
        workspaceMembership: {
          _id: "workspaceMembers_1",
          workspaceId: "workspaces_1",
          userId: "users_1",
          role: "editor",
          status: "revoked",
          acceptedAt: null,
          revokedAt: now - 50,
          deletedAt: null,
          createdAt: now - 100,
          updatedAt: now - 50,
        },
      },
      now,
    });

    expect(Either.isRight(result)).toBe(true);
    const plan = Either.getOrThrow(result);

    expect(plan.user).toMatchObject({
      action: "patch",
      id: "users_1",
      value: { email: "new@example.com", updatedAt: now },
    });
    expect(plan.organizationMembership).toMatchObject({
      action: "patch",
      id: "organizationMembers_1",
      value: {
        role: "owner",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        updatedAt: now,
      },
    });
    expect(plan.workspaceMembership).toMatchObject({
      action: "patch",
      id: "workspaceMembers_1",
      value: {
        role: "owner",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        updatedAt: now,
      },
    });
  });

  it("persists first sign-in stable keys from inserted row ids and is idempotent", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const actor = confect.withIdentity({
        subject: "workos|first-user",
        name: "First User",
        email: "first@example.com",
        emailVerified: true,
        organizationId: "org_workos_first",
      });
      const first = yield* actor.mutation(
        refs.public.access.provisioning.ensureProvisioned,
        {},
      );
      const firstRows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const workspace = yield* reader
            .table("workspaces")
            .index("by_slug")
            .collect()
            .pipe(
              Effect.map(
                (rows) =>
                  rows.find((row) => row.brainKey === first.brainKey) ?? null,
              ),
              Effect.orDie,
            );
          const organization = workspace
            ? yield* reader
                .table("organizations")
                .get(asGenericId<"organizations">(workspace.organizationId))
                .pipe(Effect.orDie)
            : null;
          return { organization, workspace };
        }),
        Schema.Struct({ organization: Schema.Any, workspace: Schema.Any }),
      );
      const second = yield* actor.mutation(
        refs.public.access.provisioning.ensureProvisioned,
        {},
      );
      const secondRows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const workspace = yield* reader
            .table("workspaces")
            .index("by_slug")
            .collect()
            .pipe(
              Effect.map(
                (rows) =>
                  rows.find((row) => row.brainKey === second.brainKey) ?? null,
              ),
              Effect.orDie,
            );
          const organization = workspace
            ? yield* reader
                .table("organizations")
                .get(asGenericId<"organizations">(workspace.organizationId))
                .pipe(Effect.orDie)
            : null;
          return { organization, workspace };
        }),
        Schema.Struct({ organization: Schema.Any, workspace: Schema.Any }),
      );
      return { first, second, firstRows, secondRows };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.second).toEqual(result.first);
    expect(result.firstRows.organization).toBeTruthy();
    expect(result.firstRows.workspace).toBeTruthy();
    expect(result.secondRows.organization?.agencyKey).toBe(
      result.firstRows.organization?.agencyKey,
    );
    expect(result.secondRows.workspace?.brainKey).toBe(
      result.firstRows.workspace?.brainKey,
    );
    expect(result.firstRows.organization?.agencyKey).toBe(
      deriveStableAgencyKey({
        _id: result.firstRows.organization._id,
        createdAt: result.firstRows.organization.createdAt,
        _creationTime: result.firstRows.organization._creationTime,
      }),
    );
    expect(result.firstRows.workspace?.brainKey).toBe(
      deriveStableBrainKey({
        _id: result.firstRows.workspace._id,
        createdAt: result.firstRows.workspace.createdAt,
        _creationTime: result.firstRows.workspace._creationTime,
      }),
    );
  });

  it("fails closed instead of rebinding an existing WorkOS organization", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const userId = yield* writer
            .table("users")
            .insert({
              subject: "workos|bound-user",
              email: "bound@example.com",
              displayName: "Bound User",
              status: "active",
              createdAt: now - 100,
              updatedAt: now - 100,
            })
            .pipe(Effect.orDie);
          const organizationId = yield* writer
            .table("organizations")
            .insert({
              ownerUserId: userId,
              workosOrganizationId: "org_workos_existing",
              slug: "bound-user",
              name: "Bound User",
              status: "active",
              createdAt: now - 90,
              updatedAt: now - 90,
            })
            .pipe(Effect.orDie);
          const workspaceId = yield* writer
            .table("workspaces")
            .insert({
              organizationId,
              ownerUserId: userId,
              slug: "bound-user",
              name: "Bound User Workspace",
              status: "active",
              dataClassification: "internal",
              createdAt: now - 80,
              updatedAt: now - 80,
            })
            .pipe(Effect.orDie);
          return { organizationId, workspaceId };
        }),
        Schema.Struct({
          organizationId: Schema.Any,
          workspaceId: Schema.Any,
        }),
      );

      const error = yield* confect
        .withIdentity({
          subject: "workos|bound-user",
          name: "Bound User",
          email: "bound@example.com",
          emailVerified: true,
          organizationId: "org_workos_other",
        })
        .mutation(refs.public.access.provisioning.ensureProvisioned, {})
        .pipe(Effect.flip);
      const rows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const organization = yield* reader
            .table("organizations")
            .get(seeded.organizationId)
            .pipe(Effect.orDie);
          return { organization };
        }),
        Schema.Struct({ organization: Schema.Any }),
      );
      return { error, rows };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.error).toBeInstanceOf(ProvisioningConflict);
    expect(result.rows.organization).toMatchObject({
      workosOrganizationId: "org_workos_existing",
    });
  });

  it("rejects duplicate WorkOS and persisted stable key conflicts on sign-in", async () => {
    const cases = [
      ["duplicateWorkos", "organizations.workosOrganizationId"],
      ["invalidAgency", "organizations.agencyKey"],
      ["duplicateAgency", "organizations.agencyKey"],
      ["invalidBrain", "workspaces.brainKey"],
      ["duplicateBrain", "workspaces.organizationId.brainKey"],
    ] as const;

    const runCase = async (kind: (typeof cases)[number][0]) => {
      const program = Effect.gen(function* () {
        const confect = yield* Effect.serviceOptional(
          TestConfect.TestConfect<typeof databaseSchema>(),
        );
        yield* confect.run(
          Effect.gen(function* () {
            const writer = yield* DatabaseWriter;
            const owner = yield* writer
              .table("users")
              .insert({
                subject: `workos|${kind}`,
                email: `${kind}@example.com`,
                displayName: kind,
                status: "active",
                createdAt: now - 100,
                updatedAt: now - 100,
              })
              .pipe(Effect.orDie);
            const other = yield* writer
              .table("users")
              .insert({
                subject: `workos|${kind}-other`,
                email: `${kind}-other@example.com`,
                displayName: `${kind} other`,
                status: "active",
                createdAt: now - 99,
                updatedAt: now - 99,
              })
              .pipe(Effect.orDie);
            const organizationId = yield* writer
              .table("organizations")
              .insert({
                ownerUserId: owner,
                workosOrganizationId: `org_workos_${kind}`,
                agencyKey:
                  kind === "invalidAgency"
                    ? "ag_not-valid"
                    : "ag_01J0000000000000000000000A",
                slug: kind,
                name: kind,
                status: "active",
                createdAt: now - 90,
                updatedAt: now - 90,
                lifecycleGeneration: 0,
                revocationGeneration: 0,
              })
              .pipe(Effect.orDie);
            if (kind === "duplicateWorkos" || kind === "duplicateAgency") {
              yield* writer
                .table("organizations")
                .insert({
                  ownerUserId: other,
                  workosOrganizationId:
                    kind === "duplicateWorkos"
                      ? `org_workos_${kind}`
                      : undefined,
                  agencyKey:
                    kind === "duplicateAgency"
                      ? "ag_01J0000000000000000000000A"
                      : undefined,
                  slug: `${kind}-other`,
                  name: `${kind} other`,
                  status: "active",
                  createdAt: now - 89,
                  updatedAt: now - 89,
                })
                .pipe(Effect.orDie);
            }
            const workspaceId = yield* writer
              .table("workspaces")
              .insert({
                organizationId,
                ownerUserId: owner,
                brainKey:
                  kind === "invalidBrain"
                    ? "br_not-valid"
                    : "br_01J0000000000000000000000A",
                slug: `${kind}-workspace`,
                name: `${kind} Workspace`,
                kind: "agency",
                status: "active",
                dataClassification: "internal",
                createdAt: now - 80,
                updatedAt: now - 80,
                lifecycleGeneration: 0,
                revocationGeneration: 0,
              })
              .pipe(Effect.orDie);
            if (kind === "duplicateBrain") {
              yield* writer
                .table("workspaces")
                .insert({
                  organizationId,
                  ownerUserId: other,
                  brainKey: "br_01J0000000000000000000000A",
                  slug: `${kind}-duplicate`,
                  name: `${kind} Duplicate`,
                  kind: "client",
                  status: "active",
                  dataClassification: "internal",
                  createdAt: now - 79,
                  updatedAt: now - 79,
                })
                .pipe(Effect.orDie);
            }
            yield* writer
              .table("organizationMembers")
              .insert({
                organizationId,
                userId: owner,
                role: "owner",
                status: "active",
                acceptedAt: now - 70,
                revokedAt: null,
                createdAt: now - 70,
                updatedAt: now - 70,
              })
              .pipe(Effect.orDie);
            yield* writer
              .table("workspaceMembers")
              .insert({
                workspaceId,
                userId: owner,
                role: "owner",
                status: "active",
                acceptedAt: now - 70,
                revokedAt: null,
                deletedAt: null,
                createdAt: now - 70,
                updatedAt: now - 70,
              })
              .pipe(Effect.orDie);
          }),
          Schema.Any,
        );
        return yield* confect
          .withIdentity({
            subject: `workos|${kind}`,
            name: kind,
            email: `${kind}@example.com`,
            emailVerified: true,
            organizationId: `org_workos_${kind}`,
          })
          .mutation(refs.public.access.provisioning.ensureProvisioned, {})
          .pipe(Effect.flip);
      });
      return await Effect.runPromise(
        program.pipe(Effect.provide(testConfectLayer())),
      );
    };

    for (const [kind, resource] of cases) {
      const error = await runCase(kind);
      expect(error).toBeInstanceOf(ProvisioningConflict);
      expect(error).toMatchObject({ resource });
    }
  });

  it("persists existing organization and workspace patch plans on authenticated sign-in", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const userId = yield* writer
            .table("users")
            .insert({
              subject: "workos|legacy-user",
              email: "legacy@example.com",
              displayName: "Legacy User",
              status: "active",
              createdAt: now - 100,
              updatedAt: now - 100,
            })
            .pipe(Effect.orDie);
          const organizationId = yield* writer
            .table("organizations")
            .insert({
              ownerUserId: userId,
              slug: "legacy-user",
              name: "Legacy User",
              status: "active",
              createdAt: now - 90,
              updatedAt: now - 90,
            })
            .pipe(Effect.orDie);
          const workspaceId = yield* writer
            .table("workspaces")
            .insert({
              organizationId,
              ownerUserId: userId,
              slug: "legacy-user",
              name: "Legacy User Workspace",
              status: "active",
              dataClassification: "internal",
              createdAt: now - 80,
              updatedAt: now - 80,
            })
            .pipe(Effect.orDie);
          return { organizationId, workspaceId };
        }),
        Schema.Struct({
          organizationId: Schema.Any,
          workspaceId: Schema.Any,
        }),
      );

      yield* confect
        .withIdentity({
          subject: "workos|legacy-user",
          name: "Legacy User",
          email: "legacy@example.com",
          emailVerified: true,
          organizationId: "org_workos_legacy",
        })
        .mutation(refs.public.access.provisioning.ensureProvisioned, {});

      return yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const organization = yield* reader
            .table("organizations")
            .get(seeded.organizationId)
            .pipe(Effect.orDie);
          const workspace = yield* reader
            .table("workspaces")
            .get(seeded.workspaceId)
            .pipe(Effect.orDie);
          return { organization, workspace };
        }),
        Schema.Struct({
          organization: Schema.Any,
          workspace: Schema.Any,
        }),
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.organization).toMatchObject({
      workosOrganizationId: "org_workos_legacy",
      agencyKey: expect.stringMatching(/^ag_[0-9A-HJKMNP-TV-Z]{26}$/),
      lifecycleGeneration: 0,
      revocationGeneration: 0,
    });
    expect(result.workspace).toMatchObject({
      brainKey: expect.stringMatching(/^br_[0-9A-HJKMNP-TV-Z]{26}$/),
      kind: "agency",
      lifecycleGeneration: 0,
      revocationGeneration: 0,
    });
  });

  it("refuses to provision suspended or deleted users", () => {
    const result = buildProvisioningPlan({
      identity: {
        subject: "workos|user_12345678",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
      },
      state: {
        ...emptyState,
        user: {
          _id: "users_1",
          subject: "workos|user_12345678",
          email: "ada@example.com",
          displayName: "Ada Lovelace",
          status: "suspended",
          createdAt: now - 100,
          updatedAt: now - 100,
        },
      },
      now,
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(Unauthorized);
    }
  });

  it("fails closed when duplicate live owned organizations or workspaces exist", () => {
    const organizationResult = selectLiveOwnedOrganization(
      [
        {
          _id: "organizations_1",
          ownerUserId: "users_1",
          slug: "ada-one",
          name: "Ada One",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          _id: "organizations_2",
          ownerUserId: "users_1",
          slug: "ada-two",
          name: "Ada Two",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
      "users_1",
    );

    expect(Either.isLeft(organizationResult)).toBe(true);
    if (Either.isLeft(organizationResult)) {
      expect(organizationResult.left).toBeInstanceOf(ProvisioningConflict);
    }

    const workspaceResult = selectLiveOwnedWorkspace(
      [
        {
          _id: "workspaces_1",
          organizationId: "organizations_1",
          ownerUserId: "users_1",
          slug: "ada-one",
          name: "Ada One",
          status: "active",
          dataClassification: "internal",
          createdAt: now,
          updatedAt: now,
        },
        {
          _id: "workspaces_2",
          organizationId: "organizations_1",
          ownerUserId: "users_1",
          slug: "ada-two",
          name: "Ada Two",
          status: "active",
          dataClassification: "internal",
          createdAt: now,
          updatedAt: now,
        },
      ],
      "users_1",
    );

    expect(Either.isLeft(workspaceResult)).toBe(true);
    if (Either.isLeft(workspaceResult)) {
      expect(workspaceResult.left).toBeInstanceOf(ProvisioningConflict);
    }
  });
});

describe("requireInsertValue", () => {
  it("returns the value of an insert plan", () => {
    const value = { name: "acme" };
    expect(requireInsertValue({ action: "insert", value }, "workspace")).toBe(
      value,
    );
  });

  it("throws a plain Error (an intentional defect) on a non-insert plan", () => {
    // The caller already proved the row is absent, so a patch/none plan here is
    // an internal invariant violation, not a client-facing failure.
    expect(() =>
      requireInsertValue({ action: "none" }, "organization"),
    ).toThrow(/Expected organization provisioning insert plan/);
    expect(() => requireInsertValue({ action: "patch" }, "workspace")).toThrow(
      /Expected workspace provisioning insert plan/,
    );
  });
});
