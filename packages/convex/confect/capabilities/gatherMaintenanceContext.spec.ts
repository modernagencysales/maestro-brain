import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NotFound, Unauthorized, ValidationFailed } from "../errors";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "./_kit/capability";
import { SystemPrincipal } from "./_kit/principal";

export class MaintenanceContextUnavailable extends Schema.TaggedError<MaintenanceContextUnavailable>()(
  "MaintenanceContextUnavailable",
  {
    reason: Schema.Literal(
      "stale_route",
      "revoked_source",
      "foreign_workspace",
      "missing_current_page",
      "no_readable_citations",
    ),
  },
) {}

export const GatherMaintenanceContext = Schema.Struct({
  workspaceId: Id("workspaces"),
  organizationId: Schema.String,
  organizationKey: Schema.String,
  brainKey: Schema.String,
  unitKey: Schema.String,
  unitRevisionKey: Schema.String,
  sourceLifecycleGeneration: Schema.Number,
  routeGeneration: Schema.Number,
  policyGeneration: Schema.Number,
  workspaceLifecycleGeneration: Schema.Number,
  source: Schema.Struct({
    title: Schema.String,
    startedAt: Schema.String,
    sourceUrl: Schema.String,
  }),
  pages: Schema.Array(
    Schema.Struct({
      pageKey: Schema.String,
      title: Schema.String,
      currentRevisionKey: Schema.String,
      lifecycleGeneration: Schema.Number,
      markdown: Schema.String,
    }),
  ),
  citations: Schema.Array(
    Schema.Struct({
      citationKey: Schema.String,
      sourceUnitKey: Schema.String,
      revisionKey: Schema.String,
      segmentKey: Schema.String,
      evidenceKind: Schema.Literal("verbatim_transcript", "provider_notes"),
      speakerLabel: Schema.String,
      startMs: Schema.NullOr(Schema.Number),
      endMs: Schema.NullOr(Schema.Number),
      quote: Schema.String,
    }),
  ),
});
export type GatherMaintenanceContext = typeof GatherMaintenanceContext.Type;

export const gatherMaintenanceContextArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  unitRevisionKey: Schema.String,
  caller: SystemPrincipal,
});
const errors = Schema.Union(
  Unauthorized,
  NotFound,
  ValidationFailed,
  MaintenanceContextUnavailable,
);

export const gatherMaintenanceContext = defineContractFunction(
  FunctionSpec.internalQuery({
    name: "gatherMaintenanceContext",
    args: () => gatherMaintenanceContextArgs,
    returns: () => GatherMaintenanceContext,
    error: () => errors,
  }),
  {
    namespace: "capabilities.gatherMaintenanceContext",
    name: "gatherMaintenanceContext",
    operationId:
      "capabilities.gatherMaintenanceContext.gatherMaintenanceContext",
    kind: "query",
    surfaces: ["workflow", "internal"],
    typedErrors: [
      "Unauthorized",
      "NotFound",
      "ValidationFailed",
      "MaintenanceContextUnavailable",
    ],
    idempotent: true,
    argsSchemaName: "gatherMaintenanceContextArgs",
    returnsSchemaName: "GatherMaintenanceContext",
    argsSchema: gatherMaintenanceContextArgs,
    returnsSchema: GatherMaintenanceContext,
  },
);

const functions = [gatherMaintenanceContext] as const;
export const manifest = collectContractManifest(functions);
export const schemaRegistry = collectContractSchemas(functions);

export default GroupSpec.make().addFunction(gatherMaintenanceContext.spec);
