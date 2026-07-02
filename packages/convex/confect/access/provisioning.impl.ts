import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader, DatabaseWriter } from "../_generated/services";
import { ProvisioningConflict, Unauthorized } from "../errors";
import provisioning from "./provisioning.spec";
import {
  buildProvisioningPlan,
  extractIdentityProfile,
  selectLiveOwnedOrganization,
  selectLiveOwnedWorkspace,
  type OrganizationProvisioningRow,
  type UserProvisioningRow,
  type WorkspaceProvisioningRow,
} from "./provisioning";

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
      const now = Date.now();

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

      const userPlan = buildProvisioningPlan({
        identity,
        state: {
          user: existingUser,
          liveOrganization: null,
          liveWorkspace: null,
          organizationMembership: null,
          workspaceMembership: null,
        },
        now,
      }).user;

      const userId: GenericId<"users"> =
        existingUser === null
          ? yield* writer
              .table("users")
              .insert(requireInsertValue(userPlan, "user"))
              .pipe(Effect.orDie)
          : toId<"users">(existingUser._id);

      if (existingUser !== null && userPlan.action === "patch") {
        yield* writer
          .table("users")
          .patch(toId<"users">(existingUser._id), userPlan.value)
          .pipe(Effect.orDie);
      }

      const organizations = yield* reader
        .table("organizations")
        .index("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(100)
        .pipe(Effect.orDie);
      const existingOrganization = yield* selectProvisioningRow(() =>
        selectLiveOwnedOrganization(organizations, userId),
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
      const existingWorkspace = yield* selectProvisioningRow(() =>
        selectLiveOwnedWorkspace(workspaces, userId),
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

      const plan = buildProvisioningPlan({
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

      const organizationId: GenericId<"organizations"> =
        existingOrganization === null
          ? yield* writer
              .table("organizations")
              .insert({
                ...requireInsertValue(plan.organization, "organization"),
                ownerUserId: userId,
              })
              .pipe(Effect.orDie)
          : toId<"organizations">(existingOrganization._id);

      const workspaceId: GenericId<"workspaces"> =
        existingWorkspace === null
          ? yield* writer
              .table("workspaces")
              .insert({
                ...requireInsertValue(plan.workspace, "workspace"),
                organizationId,
                ownerUserId: userId,
              })
              .pipe(Effect.orDie)
          : toId<"workspaces">(existingWorkspace._id);

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

      return { workspaceId };
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

const requireInsertValue = <Value>(
  plan:
    | { readonly action: "insert"; readonly value: Value }
    | { readonly action: "patch" }
    | { readonly action: "none" },
  label: string,
): Value => {
  if (plan.action !== "insert") {
    throw new Error(`Expected ${label} provisioning insert plan.`);
  }
  return plan.value;
};

const toId = <TableName extends string>(id: string): GenericId<TableName> =>
  id as GenericId<TableName>;

const selectProvisioningRow = <
  Row extends OrganizationProvisioningRow | WorkspaceProvisioningRow,
>(
  select: () => Row | null,
): Effect.Effect<Row | null, ProvisioningConflict> =>
  Effect.try({
    try: select,
    catch: (error) =>
      error instanceof ProvisioningConflict
        ? error
        : new ProvisioningConflict({
            resource: "provisioning",
            message: "Unexpected provisioning selection failure.",
          }),
  });

export default GroupImpl.make(databaseSchema, provisioning).pipe(
  Layer.provide(ensureProvisioned),
  GroupImpl.finalize,
);
