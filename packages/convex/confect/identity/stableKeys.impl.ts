import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader } from "../_generated/services";
import {
  Forbidden,
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../errors";
import { resolveEffectiveWorkspaceRole } from "../access/auth";
import { asGenericId, loadCurrentUser } from "../access/handlerContext";
import { extractIdentityProfile } from "../access/provisioning";
import stableKeys from "./stableKeys.spec";
import {
  AgencyNotFound,
  BrainNotFound,
  StableKeyConflict,
  TenantMismatch,
  isStableAgencyKey,
  isStableBrainKey,
} from "./stableKeys";

const resolveBrainKey = FunctionImpl.make(
  databaseSchema,
  stableKeys,
  "resolveBrainKey",
  ({ agencyKey, brainKey }) =>
    Effect.gen(function* () {
      if (!isStableAgencyKey(agencyKey)) {
        return yield* new ValidationFailed({
          field: "agencyKey",
          message: "Invalid stable agency key syntax.",
        });
      }
      if (!isStableBrainKey(brainKey)) {
        return yield* new ValidationFailed({
          field: "brainKey",
          message: "Invalid stable Brain key syntax.",
        });
      }

      const auth = yield* Auth;
      const identity = yield* extractIdentityProfile(
        yield* auth.getUserIdentity.pipe(
          Effect.mapError(() => new Unauthorized()),
        ),
      );
      if (identity.workosOrganizationId === undefined) {
        return yield* new Unauthorized();
      }

      const reader = yield* DatabaseReader;
      const user = yield* loadCurrentUser(reader);
      if (user.status !== "active") {
        return yield* new Unauthorized();
      }
      const currentOrganizations = yield* reader
        .table("organizations")
        .index("by_workos_organization", (q) =>
          q.eq("workosOrganizationId", identity.workosOrganizationId),
        )
        .collect()
        .pipe(Effect.orDie);
      const activeCurrentOrganizations = currentOrganizations.filter(
        (row) => row.status === "active",
      );
      if (activeCurrentOrganizations.length !== 1) {
        return yield* new AgencyNotFound({ agencyKey });
      }
      const currentOrganization = activeCurrentOrganizations[0];
      if (currentOrganization === undefined) {
        return yield* new AgencyNotFound({ agencyKey });
      }

      const organizations = yield* reader
        .table("organizations")
        .index("by_agency_key", (q) => q.eq("agencyKey", agencyKey))
        .collect()
        .pipe(Effect.orDie);
      if (organizations.length > 1) {
        return yield* new StableKeyConflict({
          resource: "organizations.agencyKey",
          key: agencyKey,
        });
      }
      const organization = organizations[0];
      if (organization === undefined || organization.status !== "active") {
        return yield* new AgencyNotFound({ agencyKey });
      }
      if (organization._id !== currentOrganization._id) {
        return yield* new TenantMismatch({ agencyKey, brainKey });
      }
      const organizationMemberships = yield* reader
        .table("organizationMembers")
        .index("by_organization_user", (q) =>
          q.eq("organizationId", organization._id).eq("userId", user._id),
        )
        .collect()
        .pipe(Effect.orDie);
      const liveOrganizationMemberships = organizationMemberships.filter(
        (member) =>
          member.status === "active" &&
          member.acceptedAt !== null &&
          member.revokedAt === null,
      );
      if (liveOrganizationMemberships.length > 1) {
        return yield* new ProvisioningConflict({
          resource: "organizationMembers.organizationId.userId",
          message: "Duplicate live organization memberships found.",
        });
      }

      const workspaces = yield* reader
        .table("workspaces")
        .index("by_organization_brain_key", (q) =>
          q.eq("organizationId", organization._id).eq("brainKey", brainKey),
        )
        .collect()
        .pipe(Effect.orDie);
      if (workspaces.length > 1) {
        return yield* new StableKeyConflict({
          resource: "workspaces.organizationId.brainKey",
          key: brainKey,
        });
      }
      const workspace = workspaces[0];
      if (workspace === undefined || workspace.status !== "active") {
        return yield* new BrainNotFound({ brainKey });
      }
      const workspaceMemberships = yield* reader
        .table("workspaceMembers")
        .index("by_workspace_user", (q) =>
          q.eq("workspaceId", workspace._id).eq("userId", user._id),
        )
        .collect()
        .pipe(Effect.orDie);
      const liveWorkspaceMemberships = workspaceMemberships.filter(
        (member) =>
          member.status === "active" &&
          member.acceptedAt !== null &&
          member.revokedAt === null &&
          member.deletedAt === null,
      );
      if (liveWorkspaceMemberships.length > 1) {
        return yield* new ProvisioningConflict({
          resource: "workspaceMembers.workspaceId.userId",
          message: "Duplicate live workspace memberships found.",
        });
      }
      const resolution = resolveEffectiveWorkspaceRole({
        nowMs: Date.now(),
        userId: user._id,
        workspace: {
          id: workspace._id,
          organizationId: workspace.organizationId,
          status: workspace.status,
        },
        organization: { id: organization._id, status: organization.status },
        workspaceMembers: liveWorkspaceMemberships,
        organizationMembers: liveOrganizationMemberships,
        guestGrants: [],
      });
      if (!resolution.ok) {
        return yield* new Forbidden({
          reason: "Live workspace or organization admin membership required.",
        });
      }

      return {
        organizationId: asGenericId<"organizations">(organization._id),
        workspaceId: asGenericId<"workspaces">(workspace._id),
      };
    }),
);

export default GroupImpl.make(databaseSchema, stableKeys).pipe(
  Layer.provide(resolveBrainKey),
  GroupImpl.finalize,
);
