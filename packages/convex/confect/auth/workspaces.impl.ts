import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import { resolveEffectiveWorkspaceRole } from "../access/auth";
import { loadCurrentUser } from "../access/handlerContext";
import { ProvisioningConflict } from "../errors";
import workspaces from "./workspaces.spec";

const list = FunctionImpl.make(databaseSchema, workspaces, "list", () =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const user = yield* loadCurrentUser(reader);
    const organizations = yield* reader
      .table("organizations")
      .index("by_status", (q) => q.eq("status", "active"))
      .take(200)
      .pipe(Effect.orDie);
    const organizationMembers = yield* reader
      .table("organizationMembers")
      .index("by_user", (q) => q.eq("userId", user._id))
      .collect()
      .pipe(Effect.orDie);
    const workspaceMembers = yield* reader
      .table("workspaceMembers")
      .index("by_user", (q) => q.eq("userId", user._id))
      .collect()
      .pipe(Effect.orDie);
    const nowMs = yield* Clock.currentTimeMillis;

    const summaries = [];
    for (const organization of organizations) {
      if (organization.agencyKey === undefined) continue;
      const rows = yield* reader
        .table("workspaces")
        .index("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .collect()
        .pipe(Effect.orDie);
      const activeRows = rows.filter((row) => row.status === "active");
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
          workspaceMembers,
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
