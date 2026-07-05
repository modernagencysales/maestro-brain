import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  MemberNotInWorkspace,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import {
  DsarDeletePlanEntrySchema,
  DsarExportManifestEntrySchema,
  DsarRequestKindSchema,
  DsarRequestStatusSchema,
  LegalHoldSchema,
} from "./dataLifecycle";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const DataLifecycleError = Schema.Union(
  Unauthorized,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  ValidationFailed,
);

export const CreateDsarRequestArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  requestId: NonEmptyString,
  kind: DsarRequestKindSchema,
  subjectId: Schema.optional(NonEmptyString),
  confirmationPhrase: Schema.optional(Schema.String),
  legalHold: Schema.optional(LegalHoldSchema),
});

export const DsarConfirmationReturn = Schema.Struct({
  required: Schema.Literal(true),
  phrase: Schema.String,
  reason: Schema.String,
});

export const DsarRequestReturn = Schema.Struct({
  workspaceId: Id("workspaces"),
  requestId: NonEmptyString,
  requestedByUserId: Id("users"),
  subjectId: Schema.optional(NonEmptyString),
  kind: DsarRequestKindSchema,
  status: DsarRequestStatusSchema,
  dryRunOnly: Schema.Literal(true),
  plannedAt: Schema.Number,
  confirmationPhrase: Schema.optional(Schema.String),
  legalHold: Schema.optional(LegalHoldSchema),
  confirmation: DsarConfirmationReturn,
  exportManifest: Schema.Array(DsarExportManifestEntrySchema),
  deletePlan: Schema.Array(DsarDeletePlanEntrySchema),
});

const createDsarRequest = FunctionSpec.publicMutation({
  name: "createDsarRequest",
  args: () => CreateDsarRequestArgs,
  returns: () => DsarRequestReturn,
  error: () => DataLifecycleError,
});

export default GroupSpec.make().addFunction(createDsarRequest);
