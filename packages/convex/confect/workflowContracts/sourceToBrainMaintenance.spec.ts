import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import { SystemPrincipal } from "../capabilities/_kit/principal";
import {
  AutopilotNotEligible,
  CitationNotInManifest,
  CitationRequired,
  LifecycleRevoked,
  RevisionBudgetExceeded,
  StaleRevision,
} from "../capabilities/maintainBrainPage.spec";
import { MaintenanceContextUnavailable } from "../capabilities/gatherMaintenanceContext.spec";
import { TranscriptMiningFailed } from "../capabilities/mineCallTranscript.spec";
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
  CitationRequired,
  CitationNotInManifest,
  RevisionBudgetExceeded,
  AutopilotNotEligible,
  StaleRevision,
  LifecycleRevoked,
  MaintenanceContextUnavailable,
  TranscriptMiningFailed,
);
export const workflowTypedErrors = [
  "Unauthorized",
  "MemberNotInWorkspace",
  "WorkspaceNotFound",
  "NotFound",
  "ValidationFailed",
  "CitationRequired",
  "CitationNotInManifest",
  "RevisionBudgetExceeded",
  "AutopilotNotEligible",
  "StaleRevision",
  "LifecycleRevoked",
  "MaintenanceContextUnavailable",
  "TranscriptMiningFailed",
] as const;
const StartArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  idempotencyKey: Schema.String,
  unitRevisionKey: Schema.String,
  caller: SystemPrincipal,
});
const StatusArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  componentWorkflowId: Schema.String,
  caller: SystemPrincipal,
});
const StartReturns = Schema.Struct({
  status: Schema.Literal("queued"),
  workflow: Schema.Literal("sourceToBrainMaintenance"),
  componentWorkflowId: Schema.String,
});
const contract = {
  namespace: "workflows.sourceToBrainMaintenance",
  surfaces: [],
  typedErrors: workflowTypedErrors,
} as const;
export const start = defineContractFunction(
  FunctionSpec.internalMutation({
    name: "start",
    args: () => StartArgs,
    returns: () => StartReturns,
    error: () => WorkflowErrors,
  }),
  {
    ...contract,
    name: "start",
    operationId: "workflows.sourceToBrainMaintenance.start",
    kind: "mutation",
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
    ...contract,
    name: "status",
    operationId: "workflows.sourceToBrainMaintenance.status",
    kind: "query",
    idempotent: true,
    argsSchemaName: "workflows.sourceToBrainMaintenance.status.args",
    returnsSchemaName: "workflows.sourceToBrainMaintenance.status.returns",
    argsSchema: StatusArgs,
    returnsSchema: WorkflowStatusResult,
  },
);
const contractFunctions = [start, status] as const;
export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);
export default GroupSpec.make()
  .addFunction(start.spec)
  .addFunction(status.spec);
