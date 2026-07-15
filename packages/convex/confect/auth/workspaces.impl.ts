import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { Auth, DatabaseReader } from "../_generated/services";
import { resolveEffectiveWorkspaceRole } from "../access/auth";
import { extractIdentityProfile } from "../access/provisioning";
import { loadCurrentUser } from "../access/handlerContext";
import {
  OrganizationNotFound,
  ProvisioningConflict,
  Unauthorized,
} from "../errors";
import workspaces from "./workspaces.spec";

const list = FunctionImpl.make(databaseSchema, workspaces, "list", () =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const identity = yield* extractIdentityProfile(
      yield* auth.getUserIdentity.pipe(
        Effect.mapError(() => new Unauthorized()),
      ),
    ).pipe(Effect.mapError(() => new Unauthorized()));
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
    const organizations = currentOrganizations.filter(
      (organization) => organization.status === "active",
    );
    if (organizations.length > 1) {
      return yield* new ProvisioningConflict({
        resource: "organizations.workosOrganizationId",
        message:
          "Duplicate active organizations found for provider organization.",
      });
    }
    const organization = organizations[0];
    if (organization === undefined) {
      return yield* new OrganizationNotFound({
        workosOrganizationId: identity.workosOrganizationId,
      });
    }

    const organizationMembers = yield* reader
      .table("organizationMembers")
      .index("by_organization_user", (q) =>
        q.eq("organizationId", organization._id).eq("userId", user._id),
      )
      .collect()
      .pipe(Effect.orDie);
    const liveOrganizationMemberships = organizationMembers.filter(
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
    const nowMs = yield* Clock.currentTimeMillis;

    const summaries = [];
    if (organization.agencyKey !== undefined) {
      const rows = yield* reader
        .table("workspaces")
        .index("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .collect()
        .pipe(Effect.orDie);
      const activeRows = rows.filter((row) => row.status === "active");
      const scopedWorkspaceMembers = [];
      for (const workspace of activeRows) {
        const members = yield* reader
          .table("workspaceMembers")
          .index("by_workspace_user", (q) =>
            q.eq("workspaceId", workspace._id).eq("userId", user._id),
          )
          .collect()
          .pipe(Effect.orDie);
        scopedWorkspaceMembers.push(...members);
      }
      const agencyRows = activeRows.filter(
        (row) => (row.kind ?? "agency") === "agency",
      );
      if (agencyRows.length > 1) {
        return yield* new ProvisioningConflict({
          resource: "workspaces.organizationId.kind",
          message: "Organization has more than one active Agency Brain.",
        });
      }
      for (const workspace of activeRows) {
        if (workspace.brainKey === undefined) continue;
        const resolution = resolveEffectiveWorkspaceRole({
          nowMs,
          userId: user._id,
          workspace: {
            id: workspace._id,
            organizationId: workspace.organizationId,
            status: workspace.status,
          },
          organization: { id: organization._id, status: organization.status },
          workspaceMembers: scopedWorkspaceMembers,
          organizationMembers,
          guestGrants: [],
        });
        if (!resolution.ok) continue;
        summaries.push({
          agencyKey: organization.agencyKey,
          brainKey: workspace.brainKey,
          name: workspace.name,
          kind: workspace.kind ?? "agency",
          ...(workspace.clientSlug === undefined
            ? {}
            : { clientSlug: workspace.clientSlug }),
          effectiveRole: resolution.role,
          status: workspace.status,
          freshness: {
            updatedAt: workspace.updatedAt,
            lifecycleGeneration: workspace.lifecycleGeneration ?? 0,
            revocationGeneration: workspace.revocationGeneration ?? 0,
          },
        });
      }
    }
    return summaries;
  }),
);

export default GroupImpl.make(databaseSchema, workspaces).pipe(
  Layer.provide(list),
  GroupImpl.finalize,
);
