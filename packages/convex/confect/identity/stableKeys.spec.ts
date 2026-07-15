import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  Forbidden,
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../errors";
import {
  AgencyNotFound,
  BrainNotFound,
  StableKeyConflict,
  TenantMismatch,
} from "./stableKeys";

export const ResolveBrainKeyArgs = Schema.Struct({
  agencyKey: Schema.String,
  brainKey: Schema.String,
});

export const ResolveBrainKeyReturns = Schema.Struct({
  organizationId: Id("organizations"),
  workspaceId: Id("workspaces"),
});

const resolveBrainKey = FunctionSpec.internalQuery({
  name: "resolveBrainKey",
  args: () => ResolveBrainKeyArgs,
  returns: () => ResolveBrainKeyReturns,
  error: () =>
    Schema.Union(
      Unauthorized,
      ValidationFailed,
      Forbidden,
      AgencyNotFound,
      BrainNotFound,
      StableKeyConflict,
      TenantMismatch,
      ProvisioningConflict,
    ),
});

export default GroupSpec.make().addFunction(resolveBrainKey);
