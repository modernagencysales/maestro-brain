import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  Forbidden,
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../errors";
import { asGenericId } from "./handlerContext";
import provisioning from "./provisioning.spec";
import {
  buildProvisioningPlan,
  extractIdentityProfile,
  requireInsertValue,
  selectLiveOwnedOrganization,
  selectLiveOwnedWorkspace,
  type UserProvisioningRow,
} from "./provisioning";
import {
  deriveStableAgencyKey,
  deriveStableBrainKey,
  isStableAgencyKey,
  isStableBrainKey,
} from "../identity/stableKeys";
import { roleAtLeast } from "./roles";

const conflict = (resource: string, message: string) =>
  new ProvisioningConflict({ resource, message });

const assertNoOtherWorkosBinding = (input: {
  readonly workosOrganizationId: string | undefined;
  readonly organizationId: GenericId<"organizations"> | null;
}) =>
  Effect.gen(function* () {
    if (input.workosOrganizationId === undefined) return;
    const rows = yield* (yield* DatabaseReader)
      .table("organizations")
      .index("by_workos_organization", (q) =>
        q.eq("workosOrganizationId", input.workosOrganizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    if (rows.some((row) => row._id !== input.organizationId)) {
      return yield* Effect.fail(
        conflict(
          "organizations.workosOrganizationId",
          "Authenticated WorkOS organization is already bound.",
        ),
      );
    }
  });

const assertUniqueAgencyKey = (input: {
  readonly organizationId: GenericId<"organizations">;
  readonly agencyKey: string;
}) =>
  Effect.gen(function* () {
    if (!isStableAgencyKey(input.agencyKey)) {
      return yield* Effect.fail(
        conflict(
          "organizations.agencyKey",
          "Persisted agency key syntax is invalid.",
        ),
      );
    }
    const rows = yield* (yield* DatabaseReader)
      .table("organizations")
      .index("by_agency_key", (q) => q.eq("agencyKey", input.agencyKey))
      .collect()
      .pipe(Effect.orDie);
    if (rows.some((row) => row._id !== input.organizationId)) {
      return yield* Effect.fail(
        conflict(
          "organizations.agencyKey",
          "Persisted agency key is duplicated.",
        ),
      );
    }
  });

const assertUniqueBrainKey = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly organizationId: GenericId<"organizations">;
  readonly brainKey: string;
}) =>
  Effect.gen(function* () {
    if (!isStableBrainKey(input.brainKey)) {
      return yield* Effect.fail(
        conflict(
          "workspaces.brainKey",
          "Persisted Brain key syntax is invalid.",
        ),
      );
    }
    const rows = yield* (yield* DatabaseReader)
      .table("workspaces")
      .index("by_organization_brain_key", (q) =>
        q
          .eq("organizationId", input.organizationId)
          .eq("brainKey", input.brainKey),
      )
      .collect()
      .pipe(Effect.orDie);
    if (rows.some((row) => row._id !== input.workspaceId)) {
      return yield* Effect.fail(
        conflict(
          "workspaces.organizationId.brainKey",
          "Persisted Brain key is duplicated inside organization.",
        ),
      );
    }
  });

const ensureProvisioned = FunctionImpl.make(
  databaseSchema,
  provisioning,
  "ensureProvisioned",
  () =>
    Effect.gen(function* () {
      const auth = yield* Auth;
      const identity = yield* extractIdentityProfile(
        yield* auth.getUserIdentity.pipe(
          Effect.mapError(() => new Unauthorized()),
        ),
      );
      const now = yield* Clock.currentTimeMillis;

      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;

      const existingUser = yield* reader
        .table("users")
        .index("by_subject", (q) => q.eq("subject", identity.subject))
        .first()
        .pipe(
          Effect.map(Option.getOrNull),
          Effect.map((user) =>
            user === null ? null : toProvisioningUser(user),
          ),
          Effect.orDie,
        );

      const userPlan = (yield* buildProvisioningPlan({
        identity,
        state: {
          user: existingUser,
          liveOrganization: null,
          liveWorkspace: null,
          organizationMembership: null,
          workspaceMembership: null,
        },
        now,
      })).user;

      const userId: GenericId<"users"> =
        existingUser === null
          ? yield* writer
              .table("users")
              .insert(requireInsertValue(userPlan, "user"))
              .pipe(Effect.orDie)
          : asGenericId<"users">(existingUser._id);

      if (existingUser !== null && userPlan.action === "patch") {
        yield* writer
          .table("users")
          .patch(asGenericId<"users">(existingUser._id), userPlan.value)
          .pipe(Effect.orDie);
      }

      const organizations = yield* reader
        .table("organizations")
        .index("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(100)
        .pipe(Effect.orDie);
      const existingOrganization = yield* selectLiveOwnedOrganization(
        organizations,
        userId,
      );

      const workspaces =
        existingOrganization === null
          ? []
          : yield* reader
              .table("workspaces")
              .index("by_organization", (q) =>
                q.eq("organizationId", existingOrganization._id),
              )
              .take(100)
              .pipe(Effect.orDie);
      const existingWorkspace = yield* selectLiveOwnedWorkspace(
        workspaces,
        userId,
      );

      const organizationMembership =
        existingOrganization === null
          ? null
          : yield* reader
              .table("organizationMembers")
              .index("by_organization_user", (q) =>
                q
                  .eq("organizationId", existingOrganization._id)
                  .eq("userId", userId),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);

      const workspaceMembership =
        existingWorkspace === null
          ? null
          : yield* reader
              .table("workspaceMembers")
              .index("by_workspace_user", (q) =>
                q.eq("workspaceId", existingWorkspace._id).eq("userId", userId),
              )
              .first()
              .pipe(Effect.map(Option.getOrNull), Effect.orDie);

      yield* assertNoOtherWorkosBinding({
        workosOrganizationId: identity.workosOrganizationId,
        organizationId:
          existingOrganization === null
            ? null
            : asGenericId<"organizations">(existingOrganization._id),
      });
      if (existingOrganization?.agencyKey !== undefined) {
        yield* assertUniqueAgencyKey({
          organizationId: asGenericId<"organizations">(
            existingOrganization._id,
          ),
          agencyKey: existingOrganization.agencyKey,
        });
      }
      if (existingWorkspace?.brainKey !== undefined) {
        yield* assertUniqueBrainKey({
          workspaceId: asGenericId<"workspaces">(existingWorkspace._id),
          organizationId: asGenericId<"organizations">(
            existingWorkspace.organizationId,
          ),
          brainKey: existingWorkspace.brainKey,
        });
      }

      const plan = yield* buildProvisioningPlan({
        identity,
        state: {
          user: existingUser,
          liveOrganization: existingOrganization,
          liveWorkspace: existingWorkspace,
          organizationMembership,
          workspaceMembership,
        },
        now,
      });

      const existingOrganizationId =
        existingOrganization === null
          ? null
          : asGenericId<"organizations">(existingOrganization._id);
      const organizationInsert =
        existingOrganizationId === null
          ? requireInsertValue(plan.organization, "organization")
          : null;
      const organizationId: GenericId<"organizations"> =
        existingOrganizationId ??
        (yield* writer
          .table("organizations")
          .insert({
            ...requireInsertValue(plan.organization, "organization"),
            ownerUserId: userId,
          })
          .pipe(Effect.orDie));

      if (organizationInsert !== null) {
        const inserted = yield* reader
          .table("organizations")
          .get(organizationId)
          .pipe(Effect.orDie);
        const agencyKey = deriveStableAgencyKey({
          _id: organizationId,
          createdAt: organizationInsert.createdAt,
          _creationTime: inserted?._creationTime,
        });
        yield* assertUniqueAgencyKey({ organizationId, agencyKey });
        yield* writer
          .table("organizations")
          .patch(organizationId, { agencyKey })
          .pipe(Effect.orDie);
      }

      if (
        existingOrganization !== null &&
        plan.organization.action === "patch"
      ) {
        if (plan.organization.value.agencyKey !== undefined) {
          yield* assertUniqueAgencyKey({
            organizationId: asGenericId<"organizations">(
              existingOrganization._id,
            ),
            agencyKey: plan.organization.value.agencyKey,
          });
        }
        yield* writer
          .table("organizations")
          .patch(
            asGenericId<"organizations">(existingOrganization._id),
            plan.organization.value,
          )
          .pipe(Effect.orDie);
      }

      const existingWorkspaceId =
        existingWorkspace === null
          ? null
          : asGenericId<"workspaces">(existingWorkspace._id);
      const workspaceInsert =
        existingWorkspaceId === null
          ? requireInsertValue(plan.workspace, "workspace")
          : null;
      const workspaceId: GenericId<"workspaces"> =
        existingWorkspaceId ??
        (yield* writer
          .table("workspaces")
          .insert({
            ...requireInsertValue(plan.workspace, "workspace"),
            organizationId,
            ownerUserId: userId,
          })
          .pipe(Effect.orDie));

      if (workspaceInsert !== null) {
        const inserted = yield* reader
          .table("workspaces")
          .get(workspaceId)
          .pipe(Effect.orDie);
        const brainKey = deriveStableBrainKey({
          _id: workspaceId,
          createdAt: workspaceInsert.createdAt,
          _creationTime: inserted?._creationTime,
        });
        yield* assertUniqueBrainKey({ workspaceId, organizationId, brainKey });
        yield* writer
          .table("workspaces")
          .patch(workspaceId, { brainKey })
          .pipe(Effect.orDie);
      }

      if (existingWorkspace !== null && plan.workspace.action === "patch") {
        if (plan.workspace.value.brainKey !== undefined) {
          yield* assertUniqueBrainKey({
            workspaceId: asGenericId<"workspaces">(existingWorkspace._id),
            organizationId,
            brainKey: plan.workspace.value.brainKey,
          });
        }
        yield* writer
          .table("workspaces")
          .patch(
            asGenericId<"workspaces">(existingWorkspace._id),
            plan.workspace.value,
          )
          .pipe(Effect.orDie);
      }

      // The two membership upserts below are deliberately kept inline rather than
      // factored into a shared `upsertMembership<T extends TableNames>` helper.
      // confect's writer types `.insert` against a *concrete* table literal
      // (`WithoutSystemFields<DocumentByName<…, T>>`); inside a helper generic
      // over `T`, TypeScript cannot prove the value matches that mapping, so the
      // helper only compiles with an `as` assertion — which discards the concrete
      // insert-shape check these literal call sites get for free (our first line
      // of defense against schema drift between the provisioning rows and the
      // Convex schema). The parallel structure is the price of that check, and
      // it is worth more than removing the duplication. Never reach for `any`
      // here. See docs/template/coding-standards.md ("Multi-table Convex writes").
      if (organizationMembership === null) {
        yield* writer
          .table("organizationMembers")
          .insert({
            ...requireInsertValue(
              plan.organizationMembership,
              "organizationMembership",
            ),
            organizationId,
            userId,
          })
          .pipe(Effect.orDie);
      } else if (plan.organizationMembership.action === "patch") {
        yield* writer
          .table("organizationMembers")
          .patch(organizationMembership._id, plan.organizationMembership.value)
          .pipe(Effect.orDie);
      }

      if (workspaceMembership === null) {
        yield* writer
          .table("workspaceMembers")
          .insert({
            ...requireInsertValue(
              plan.workspaceMembership,
              "workspaceMembership",
            ),
            workspaceId,
            userId,
          })
          .pipe(Effect.orDie);
      } else if (plan.workspaceMembership.action === "patch") {
        yield* writer
          .table("workspaceMembers")
          .patch(workspaceMembership._id, plan.workspaceMembership.value)
          .pipe(Effect.orDie);
      }

      const persistedWorkspace = yield* reader
        .table("workspaces")
        .get(workspaceId)
        .pipe(Effect.orDie);
      if (persistedWorkspace?.brainKey === undefined) {
        return yield* Effect.fail(
          conflict(
            "workspaces.brainKey",
            "Provisioned Brain key was not persisted.",
          ),
        );
      }

      return { brainKey: persistedWorkspace.brainKey };
    }),
);

const createClientBrain = FunctionImpl.make(
  databaseSchema,
  provisioning,
  "createClientBrain",
  ({ name, clientSlug }) =>
    Effect.gen(function* () {
      const normalizedName = name.trim();
      const normalizedSlug = clientSlug.trim().toLowerCase();
      if (normalizedName.length === 0) {
        return yield* new ValidationFailed({
          field: "name",
          message: "Client Brain name is required.",
        });
      }
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(normalizedSlug)) {
        return yield* new ValidationFailed({
          field: "clientSlug",
          message:
            "Client slug must be lower-case letters, numbers, or dashes.",
        });
      }

      const auth = yield* Auth;
      const identity = yield* extractIdentityProfile(
        yield* auth.getUserIdentity.pipe(
          Effect.mapError(() => new Unauthorized()),
        ),
      );
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const now = yield* Clock.currentTimeMillis;
      const user = yield* reader
        .table("users")
        .index("by_subject", (q) => q.eq("subject", identity.subject))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (user === null || user.status !== "active") {
        return yield* new Unauthorized();
      }

      const orgMemberships = yield* reader
        .table("organizationMembers")
        .index("by_user", (q) => q.eq("userId", user._id))
        .collect()
        .pipe(Effect.orDie);
      const activeAdminMemberships = orgMemberships.filter(
        (member) =>
          member.status === "active" &&
          member.acceptedAt !== null &&
          member.revokedAt === null &&
          roleAtLeast(member.role, "admin"),
      );
      if (activeAdminMemberships.length !== 1) {
        return yield* new Forbidden({
          reason: "Admin organization role required.",
        });
      }
      const activeAdminMembership = activeAdminMemberships[0];
      if (activeAdminMembership === undefined) {
        return yield* new Forbidden({
          reason: "Admin organization role required.",
        });
      }
      const organizationId = asGenericId<"organizations">(
        activeAdminMembership.organizationId,
      );
      const organization = yield* reader
        .table("organizations")
        .get(asGenericId<"organizations">(organizationId))
        .pipe(Effect.orDie);
      if (organization === null || organization.status !== "active") {
        return yield* new ProvisioningConflict({
          resource: "organizations",
          message:
            "Active organization is required for client Brain provisioning.",
        });
      }

      const existing = yield* reader
        .table("workspaces")
        .index("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect()
        .pipe(Effect.orDie);
      if (
        existing.some(
          (row) => row.clientSlug === normalizedSlug && row.status === "active",
        )
      ) {
        return yield* new ProvisioningConflict({
          resource: "workspaces.clientSlug",
          message: "Client Brain slug already exists.",
        });
      }
      const workspaceId = yield* writer
        .table("workspaces")
        .insert({
          organizationId,
          ownerUserId: user._id,
          slug: normalizedSlug,
          name: normalizedName,
          kind: "client",
          clientSlug: normalizedSlug,
          status: "active",
          dataClassification: "confidential",
          createdAt: now,
          updatedAt: now,
          lifecycleGeneration: 0,
          revocationGeneration: 0,
        })
        .pipe(Effect.orDie);
      const inserted = yield* reader
        .table("workspaces")
        .get(workspaceId)
        .pipe(Effect.orDie);
      const brainKey = deriveStableBrainKey({
        _id: workspaceId,
        createdAt: now,
        _creationTime: inserted?._creationTime,
      });
      yield* assertUniqueBrainKey({ workspaceId, organizationId, brainKey });
      yield* writer
        .table("workspaces")
        .patch(workspaceId, { brainKey })
        .pipe(Effect.orDie);
      return { brainKey };
    }),
);

const toProvisioningUser = (user: {
  readonly _id: GenericId<"users">;
  readonly subject: string;
  readonly email: string;
  readonly displayName?: string | undefined;
  readonly status: "active" | "suspended" | "deleted";
  readonly createdAt: number;
  readonly updatedAt: number;
}): UserProvisioningRow => ({
  _id: user._id,
  subject: user.subject,
  email: user.email,
  ...(user.displayName === undefined ? {} : { displayName: user.displayName }),
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export default GroupImpl.make(databaseSchema, provisioning).pipe(
  Layer.provide(ensureProvisioned),
  Layer.provide(createClientBrain),
  GroupImpl.finalize,
);
