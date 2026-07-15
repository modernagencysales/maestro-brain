import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import {
  BrainAlreadyExists,
  Forbidden,
  OrganizationNotFound,
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../errors";

const ensureProvisioned = FunctionSpec.publicMutation({
  name: "ensureProvisioned",
  args: () => Schema.Struct({}),
  returns: () =>
    Schema.Struct({
      brainKey: Schema.String,
    }),
  error: () =>
    Schema.Union(Unauthorized, ValidationFailed, ProvisioningConflict),
});

const createClientBrain = FunctionSpec.publicMutation({
  name: "createClientBrain",
  args: () =>
    Schema.Struct({
      name: Schema.String,
      clientSlug: Schema.String,
    }),
  returns: () =>
    Schema.Struct({
      brainKey: Schema.String,
    }),
  error: () =>
    Schema.Union(
      Unauthorized,
      Forbidden,
      ValidationFailed,
      OrganizationNotFound,
      BrainAlreadyExists,
      ProvisioningConflict,
    ),
});

export default GroupSpec.make()
  .addFunction(ensureProvisioned)
  .addFunction(createClientBrain);
