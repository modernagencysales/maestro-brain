import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import {
  CapacityExceeded,
  ClientBrainAlreadyExists,
  Forbidden,
  OrganizationNotFound,
  ProvisioningConflict,
  Unauthorized,
  ValidationFailed,
} from "../errors";

const ClientBriefPage = Schema.Struct({
  pageKey: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  sortKey: Schema.String,
});

const ClientBrainCapacity = Schema.Struct({
  clientBrains: Schema.Number,
  clientBrainLimit: Schema.Number,
  remainingClientBrains: Schema.Number,
});

const ClientBrainProvisioningResult = Schema.Struct({
  brainKey: Schema.String,
  initialPageKey: Schema.String,
  pages: Schema.Array(ClientBriefPage),
  capacity: ClientBrainCapacity,
});

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

const ensureProvisionedFromWorkos = FunctionSpec.publicAction({
  name: "ensureProvisionedFromWorkos",
  args: () => Schema.Struct({}),
  returns: () => Schema.Struct({ brainKey: Schema.String }),
  error: () =>
    Schema.Union(Unauthorized, ValidationFailed, ProvisioningConflict),
});

const seedVerifiedWorkosUser = FunctionSpec.internalMutation({
  name: "seedVerifiedWorkosUser",
  args: () =>
    Schema.Struct({
      subject: Schema.String,
      email: Schema.String,
      emailVerified: Schema.Boolean,
      name: Schema.optional(Schema.String),
    }),
  returns: () => Schema.Null,
  error: () =>
    Schema.Union(Unauthorized, ValidationFailed, ProvisioningConflict),
});

const createClientBrain = FunctionSpec.publicMutation({
  name: "createClientBrain",
  args: () =>
    Schema.Struct({
      name: Schema.String,
      clientSlug: Schema.String,
      idempotencyKey: Schema.String,
    }),
  returns: () => ClientBrainProvisioningResult,
  error: () =>
    Schema.Union(
      Unauthorized,
      Forbidden,
      ValidationFailed,
      OrganizationNotFound,
      ClientBrainAlreadyExists,
      CapacityExceeded,
      ProvisioningConflict,
    ),
});

export default GroupSpec.make()
  .addFunction(ensureProvisioned)
  .addFunction(ensureProvisionedFromWorkos)
  .addFunction(seedVerifiedWorkosUser)
  .addFunction(createClientBrain);
