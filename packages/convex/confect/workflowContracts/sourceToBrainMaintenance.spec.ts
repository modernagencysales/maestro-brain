import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import { SystemPrincipal } from "../capabilities/_kit/principal";
import {
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { Id } from "../_generated/id";
import { WorkflowStatusResult } from "../workflows/_kit/status";

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
  workflow: Schema.Literal("sourceToBrainMaintenance"),
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
  caller: SystemPrincipal,
});

const ApproveReturns = Schema.Struct({
  eventId: Schema.String,
});

export const start = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "start",
    args: () => StartArgs,
    returns: () => StartReturns,
    error: () => WorkflowErrors,
  }),
  {
    namespace: "workflows.sourceToBrainMaintenance",
    name: "start",
    operationId: "workflows.sourceToBrainMaintenance.start",
    kind: "mutation",
    surfaces: [],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "workflows.sourceToBrainMaintenance.start.args",
    returnsSchemaName: "workflows.sourceToBrainMaintenance.start.returns",
    argsSchema: StartArgs,
    returnsSchema: StartReturns,
  },
);

export const status = defineContractFunction(
  FunctionSpec.internalQuery({
    name: "status",
    args: () => StatusArgs,
    returns: () => WorkflowStatusResult,
    error: () => WorkflowErrors,
  }),
  {
    namespace: "workflows.sourceToBrainMaintenance",
    name: "status",
    operationId: "workflows.sourceToBrainMaintenance.status",
    kind: "query",
    surfaces: [],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "workflows.sourceToBrainMaintenance.status.args",
    returnsSchemaName: "workflows.sourceToBrainMaintenance.status.returns",
    argsSchema: StatusArgs,
    returnsSchema: WorkflowStatusResult,
  },
);

export const approve = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "approve",
    args: () => ApproveArgs,
    returns: () => ApproveReturns,
    error: () => WorkflowErrors,
  }),
  {
    namespace: "workflows.sourceToBrainMaintenance",
    name: "approve",
    operationId: "workflows.sourceToBrainMaintenance.approve",
    kind: "mutation",
    surfaces: [],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "workflows.sourceToBrainMaintenance.approve.args",
    returnsSchemaName: "workflows.sourceToBrainMaintenance.approve.returns",
    argsSchema: ApproveArgs,
    returnsSchema: ApproveReturns,
  },
);

const contractFunctions = [start, status, approve] as const;

export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(start.spec)
  .addFunction(status.spec)
  .addFunction(approve.spec);
