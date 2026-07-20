import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
  type ContractFunctionKind,
  type ContractSpecManifest,
} from "../capabilities/_kit/capability";
import { SystemPrincipal } from "../capabilities/_kit/principal";
import { Id } from "../_generated/id";
import {
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { WorkflowStatusResult } from "../workflows/_kit/status";

const errorNames = [
  "Unauthorized",
  "MemberNotInWorkspace",
  "WorkspaceNotFound",
  "NotFound",
  "ValidationFailed",
] as const;
const WorkflowErrors = Schema.Union(
  Unauthorized,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  NotFound,
  ValidationFailed,
);
const StartArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  idempotencyKey: Schema.String,
  caller: SystemPrincipal,
});
const StartReturns = Schema.Struct({
  status: Schema.Literal("queued"),
  workflow: Schema.Literal("sourceClassification"),
  componentWorkflowId: Schema.String,
});
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
    reviewerRole: Schema.Literal("admin", "owner"),
    targetBrainKey: Schema.optional(Schema.String),
  }),
  caller: SystemPrincipal,
});
const ApproveReturns = Schema.Struct({ eventId: Schema.String });

const metadata = (
  name: string,
  kind: ContractFunctionKind,
  idempotent: boolean,
  argsSchema: Schema.Schema.Any,
  returnsSchema: Schema.Schema.Any,
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

const contractFunctions = [start, status, approve] as const;
export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(start.spec)
  .addFunction(status.spec)
  .addFunction(approve.spec);
