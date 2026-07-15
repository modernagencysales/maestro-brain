import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import {
  Forbidden,
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../errors";
import { Role } from "../access/roles";

export const WorkspaceSummary = Schema.Struct({
  agencyKey: Schema.String,
  brainKey: Schema.String,
  name: Schema.String,
  kind: Schema.Literal("agency", "client"),
  clientSlug: Schema.optional(Schema.String),
  effectiveRole: Role,
  status: Schema.Literal("active", "archived"),
  freshness: Schema.Struct({
    updatedAt: Schema.Number,
    lifecycleGeneration: Schema.Number,
    revocationGeneration: Schema.Number,
  }),
});

const list = FunctionSpec.publicQuery({
  name: "list",
  args: () =>
    Schema.Struct({
      organizationId: Schema.optional(Schema.String),
      workspaceId: Schema.optional(Schema.String),
    }),
  returns: () => Schema.Array(WorkspaceSummary),
  error: () =>
    Schema.Union(
      Unauthorized,
      Forbidden,
      ValidationFailed,
      ProvisioningConflict,
    ),
});

export default GroupSpec.make().addFunction(list);
