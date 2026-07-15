import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import { ProvisioningConflict, ValidationFailed } from "../errors";
import { asGenericId } from "../access/handlerContext";
import stableKeys from "./stableKeys.spec";
import { isStableAgencyKey, isStableBrainKey } from "./stableKeys";

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

      const reader = yield* DatabaseReader;
      const organizations = yield* reader
        .table("organizations")
        .index("by_agency_key", (q) => q.eq("agencyKey", agencyKey))
        .collect()
        .pipe(Effect.orDie);
      if (organizations.length !== 1 || organizations[0]?.status !== "active") {
        return yield* new ProvisioningConflict({
          resource: "organizations.agencyKey",
          message:
            "Stable agency key did not resolve to exactly one active organization.",
        });
      }

      const organization = organizations[0];
      if (organization === undefined) {
        return yield* new ProvisioningConflict({
          resource: "organizations.agencyKey",
          message:
            "Stable agency key did not resolve to exactly one active organization.",
        });
      }

      const workspaces = yield* reader
        .table("workspaces")
        .index("by_organization_brain_key", (q) =>
          q.eq("organizationId", organization._id).eq("brainKey", brainKey),
        )
        .collect()
        .pipe(Effect.orDie);
      if (workspaces.length !== 1 || workspaces[0]?.status !== "active") {
        return yield* new ProvisioningConflict({
          resource: "workspaces.organizationId.brainKey",
          message:
            "Stable Brain key did not resolve to exactly one active Brain.",
        });
      }

      const workspace = workspaces[0];
      if (workspace === undefined) {
        return yield* new ProvisioningConflict({
          resource: "workspaces.organizationId.brainKey",
          message:
            "Stable Brain key did not resolve to exactly one active Brain.",
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
