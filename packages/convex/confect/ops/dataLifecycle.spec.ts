import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  Forbidden,
  MemberNotInWorkspace,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { BrainNotFound, LifecycleRevoked } from "../brain/pageTree";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";

export class ExportForbidden extends Schema.TaggedError<ExportForbidden>()(
  "ExportForbidden",
  { reason: Schema.String },
) {}
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
  Forbidden,
  BrainNotFound,
  LifecycleRevoked,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  ValidationFailed,
  ExportForbidden,
);

export const CreateDsarRequestArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  requestId: NonEmptyString,
  kind: DsarRequestKindSchema,
  subjectId: Schema.optional(NonEmptyString),
  confirmationPhrase: Schema.optional(Schema.String),
  legalHold: Schema.optional(LegalHoldSchema),
});

export const ListDsarRequestsArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
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

export const ListDsarRequestsReturn = Schema.Struct({
  requests: Schema.Array(DsarRequestReturn),
});

const BrainExportState = Schema.Literal(
  "requested",
  "running",
  "ready",
  "revoked",
  "failed",
  "expired",
  "purged",
);
const BrainExportJobReturn = Schema.Struct({
  brainKey: Schema.String,
  jobId: Schema.String,
  state: BrainExportState,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  expiresAt: Schema.optional(Schema.Number),
  sizeBytes: Schema.optional(Schema.Number),
  manifestHash: Schema.optional(Schema.String),
  artifactHash: Schema.optional(Schema.String),
});
export const BrainExportRequestArgs = Schema.Struct({
  brainKey: Schema.String,
  idempotencyKey: NonEmptyString,
});
export const BrainExportStatusArgs = Schema.Struct({
  brainKey: Schema.String,
  jobId: NonEmptyString,
});
export const BrainExportDownloadArgs = BrainExportStatusArgs;

const createDsarRequest = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "createDsarRequest",
    args: () => CreateDsarRequestArgs,
    returns: () => DsarRequestReturn,
    error: () => DataLifecycleError,
  }),
  {
    namespace: "ops.dataLifecycle",
    name: "createDsarRequest",
    operationId: "ops.dataLifecycle.createDsarRequest",
    kind: "mutation",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "ops.dataLifecycle.createDsarRequest.args",
    returnsSchemaName: "ops.dataLifecycle.createDsarRequest.returns",
    argsSchema: CreateDsarRequestArgs,
    returnsSchema: DsarRequestReturn,
  },
);

const listDsarRequests = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "listDsarRequests",
    args: () => ListDsarRequestsArgs,
    returns: () => ListDsarRequestsReturn,
    error: () => DataLifecycleError,
  }),
  {
    namespace: "ops.dataLifecycle",
    name: "listDsarRequests",
    operationId: "ops.dataLifecycle.listDsarRequests",
    kind: "query",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "ops.dataLifecycle.listDsarRequests.args",
    returnsSchemaName: "ops.dataLifecycle.listDsarRequests.returns",
    argsSchema: ListDsarRequestsArgs,
    returnsSchema: ListDsarRequestsReturn,
  },
);

const requestBrainExport = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "requestBrainExport",
    args: () => BrainExportRequestArgs,
    returns: () => BrainExportJobReturn,
    error: () => DataLifecycleError,
  }),
  {
    namespace: "ops.dataLifecycle",
    name: "requestBrainExport",
    operationId: "ops.dataLifecycle.requestBrainExport",
    kind: "mutation",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "ops.dataLifecycle.requestBrainExport.args",
    returnsSchemaName: "ops.dataLifecycle.requestBrainExport.returns",
    argsSchema: BrainExportRequestArgs,
    returnsSchema: BrainExportJobReturn,
  },
);
const getBrainExport = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "getBrainExport",
    args: () => BrainExportStatusArgs,
    returns: () => BrainExportJobReturn,
    error: () => DataLifecycleError,
  }),
  {
    namespace: "ops.dataLifecycle",
    name: "getBrainExport",
    operationId: "ops.dataLifecycle.getBrainExport",
    kind: "query",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "ops.dataLifecycle.getBrainExport.args",
    returnsSchemaName: "ops.dataLifecycle.getBrainExport.returns",
    argsSchema: BrainExportStatusArgs,
    returnsSchema: BrainExportJobReturn,
  },
);
const downloadBrainExport = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "downloadBrainExport",
    args: () => BrainExportDownloadArgs,
    returns: () => BrainExportJobReturn,
    error: () => DataLifecycleError,
  }),
  {
    namespace: "ops.dataLifecycle",
    name: "downloadBrainExport",
    operationId: "ops.dataLifecycle.downloadBrainExport",
    kind: "query",
    surfaces: ["web"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "ops.dataLifecycle.downloadBrainExport.args",
    returnsSchemaName: "ops.dataLifecycle.downloadBrainExport.returns",
    argsSchema: BrainExportDownloadArgs,
    returnsSchema: BrainExportJobReturn,
  },
);

const contractFunctions = [
  createDsarRequest,
  listDsarRequests,
  requestBrainExport,
  getBrainExport,
  downloadBrainExport,
] as const;

export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(createDsarRequest.spec)
  .addFunction(listDsarRequests.spec)
  .addFunction(requestBrainExport.spec)
  .addFunction(getBrainExport.spec)
  .addFunction(downloadBrainExport.spec);
