import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
  type ContractFunctionKind,
  type ContractSpecManifest,
} from "../capabilities/_kit/capability";
import { SystemPrincipal } from "../capabilities/_kit/principal";
import {
  ClassificationAuthority,
  ClassificationRequest,
} from "../capabilities/classifySourceUnit.spec";
import {
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { WorkflowStatusResult } from "../workflows/_kit/status";
import type { run } from "./sourceClassification.impl";

const errorNames = [
  "Unauthorized",
  "MemberNotInWorkspace",
  "WorkspaceNotFound",
  "NotFound",
  "ValidationFailed",
  "MalformedModelOutput",
  "TargetNotAllowed",
  "EvidenceMismatch",
  "ReviewForbidden",
  "StaleGeneration",
  "DuplicateEffect",
] as const;
const WorkflowErrors = Schema.Union(
  Unauthorized,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  NotFound,
  ValidationFailed,
  Schema.TaggedStruct("MalformedModelOutput", { message: Schema.String }),
  Schema.TaggedStruct("TargetNotAllowed", { targetBrainKey: Schema.String }),
  Schema.TaggedStruct("EvidenceMismatch", {}),
  Schema.TaggedStruct("ReviewForbidden", {}),
  Schema.TaggedStruct("StaleGeneration", {}),
  Schema.TaggedStruct("DuplicateEffect", { effectKey: Schema.String }),
);
const StartArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  idempotencyKey: Schema.String,
  sourceUnitRevisionKey: Schema.String,
  caller: SystemPrincipal,
});
const StartReturns = Schema.Struct({
  status: Schema.Literal("queued"),
  workflow: Schema.Literal("sourceClassification"),
  componentWorkflowId: Schema.String,
});
const GatherArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  sourceUnitRevisionKey: Schema.String,
  caller: SystemPrincipal,
});
const CurrentAuthorityArgs = GatherArgs;
const StatusArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  componentWorkflowId: Schema.String,
  caller: SystemPrincipal,
});
const ApproveArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  componentWorkflowId: Schema.String,
  nodeId: Schema.String,
  review: Schema.Struct({
    action: Schema.Literal(
      "accept",
      "change_to_allowed",
      "no_route",
      "mixed_client_no_route",
      "reject",
    ),
    reviewerPrincipalKey: Schema.String,
    reviewerAuthority: Schema.Struct({
      workspaceId: Schema.String,
      organizationId: Schema.String,
      role: Schema.Literal("viewer", "editor", "admin", "owner"),
    }),
    targetBrainKey: Schema.optional(Schema.String),
  }),
  caller: SystemPrincipal,
});
const ApproveReturns = Schema.Struct({ eventId: Schema.String });
const GatherReturns = ClassificationRequest;
const CurrentAuthorityReturns = ClassificationAuthority;
const metadata = (
  name: string,
  kind: ContractFunctionKind,
  idempotent: boolean,
  argsSchema: Schema.Schema.AnyNoContext,
  returnsSchema: Schema.Schema.AnyNoContext,
): ContractSpecManifest => ({
  namespace: "workflows.sourceClassification",
  name,
  operationId: `workflows.sourceClassification.${name}`,
  kind,
  surfaces: [],
  typedErrors: errorNames,
  idempotent,
  argsSchemaName: `workflows.sourceClassification.${name}.args`,
  returnsSchemaName: `workflows.sourceClassification.${name}.returns`,
  argsSchema,
  returnsSchema,
});
export const runWorkflow =
  FunctionSpec.convexInternalMutation<typeof run>()("run");
export const gather = defineContractFunction(
  FunctionSpec.internalQuery({
    name: "gather",
    args: () => GatherArgs,
    returns: () => GatherReturns,
    error: () => WorkflowErrors,
  }),
  metadata("gather", "query", true, GatherArgs, GatherReturns),
);
export const currentAuthority = defineContractFunction(
  FunctionSpec.internalQuery({
    name: "currentAuthority",
    args: () => CurrentAuthorityArgs,
    returns: () => CurrentAuthorityReturns,
    error: () => WorkflowErrors,
  }),
  metadata(
    "currentAuthority",
    "query",
    true,
    CurrentAuthorityArgs,
    CurrentAuthorityReturns,
  ),
);
export const start = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "start",
    args: () => StartArgs,
    returns: () => StartReturns,
    error: () => WorkflowErrors,
  }),
  metadata("start", "mutation", false, StartArgs, StartReturns),
);
export const status = defineContractFunction(
  FunctionSpec.internalQuery({
    name: "status",
    args: () => StatusArgs,
    returns: () => WorkflowStatusResult,
    error: () => WorkflowErrors,
  }),
  metadata("status", "query", true, StatusArgs, WorkflowStatusResult),
);
export const approve = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "approve",
    args: () => ApproveArgs,
    returns: () => ApproveReturns,
    error: () => WorkflowErrors,
  }),
  metadata("approve", "mutation", false, ApproveArgs, ApproveReturns),
);
const contractFunctions = [
  gather,
  currentAuthority,
  start,
  status,
  approve,
] as const;
export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);
export default GroupSpec.make()
  .addFunction(runWorkflow)
  .addFunction(gather.spec)
  .addFunction(currentAuthority.spec)
  .addFunction(start.spec)
  .addFunction(status.spec)
  .addFunction(approve.spec);
