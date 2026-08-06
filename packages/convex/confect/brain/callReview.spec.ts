import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import {
  Forbidden,
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import {
  BrainNotFound,
  LifecycleRevoked,
  PageNotFound,
  StaleRevision,
} from "./pageTree";

const BrainSelector = Schema.Struct({ brainKey: Schema.String });
const errors = Schema.Union(
  Unauthorized,
  Forbidden,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  BrainNotFound,
  LifecycleRevoked,
  PageNotFound,
  StaleRevision,
  NotFound,
  ValidationFailed,
);
const typedErrors = [
  "Unauthorized",
  "Forbidden",
  "MemberNotInWorkspace",
  "WorkspaceNotFound",
  "BrainNotFound",
  "LifecycleRevoked",
  "PageNotFound",
  "StaleRevision",
  "NotFound",
  "ValidationFailed",
] as const;

const RouteQueueItem = Schema.Struct({
  proposalKey: Schema.String,
  unitKey: Schema.String,
  unitRevisionKey: Schema.String,
  title: Schema.String,
  sourceUrl: Schema.String,
  outcome: Schema.Literal("awaiting_review", "mixed_client", "no_match"),
  brainKey: Schema.NullOr(Schema.String),
  candidateBrainKeys: Schema.Array(Schema.String),
  reason: Schema.String,
  routeGeneration: Schema.Number,
  sourceLifecycleGeneration: Schema.Number,
  createdAt: Schema.Number,
});
const ListRoutingArgs = BrainSelector;
const ListRoutingReturns = Schema.Struct({
  brainKey: Schema.String,
  items: Schema.Array(RouteQueueItem),
});
const ReviewRouteArgs = Schema.Struct({
  brainKey: Schema.String,
  proposalKey: Schema.String,
  action: Schema.Literal("confirm", "change_brain", "no_route", "reject"),
  targetBrainKey: Schema.optional(Schema.String),
  learnScope: Schema.optional(
    Schema.Literal("recurring_meeting", "email", "domain"),
  ),
  learnValue: Schema.optional(Schema.String),
  attemptKey: Schema.String,
  expectedUnitRevisionKey: Schema.String,
  expectedRouteGeneration: Schema.Number,
  expectedSourceLifecycleGeneration: Schema.Number,
});
const ReviewRouteReturns = Schema.Struct({
  proposalKey: Schema.String,
  status: Schema.Literal("accepted", "rejected"),
  outcome: Schema.Literal("routed", "no_match"),
  brainKey: Schema.NullOr(Schema.String),
  routeGeneration: Schema.Number,
  maintenanceQueued: Schema.Boolean,
});

const MaintenanceCitation = Schema.Struct({
  citationKey: Schema.String,
  quote: Schema.String,
  speakerLabel: Schema.String,
  startMs: Schema.NullOr(Schema.Number),
  endMs: Schema.NullOr(Schema.Number),
});
const MaintenanceItem = Schema.Struct({
  itemKey: Schema.String,
  pageKey: Schema.String,
  title: Schema.String,
  expectedRevisionKey: Schema.String,
  markdown: Schema.String,
  citations: Schema.Array(MaintenanceCitation),
});
const MaintenanceQueueItem = Schema.Struct({
  proposalKey: Schema.String,
  unitRevisionKey: Schema.String,
  sourceTitle: Schema.String,
  sourceUrl: Schema.String,
  summary: Schema.String,
  routeGeneration: Schema.Number,
  sourceLifecycleGeneration: Schema.Number,
  workspaceLifecycleGeneration: Schema.Number,
  createdAt: Schema.Number,
  items: Schema.Array(MaintenanceItem),
});
const ListMaintenanceReturns = Schema.Struct({
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  items: Schema.Array(MaintenanceQueueItem),
});
const ReviewMaintenanceArgs = Schema.extend(
  BrainSelector,
  Schema.Struct({
    proposalKey: Schema.String,
    action: Schema.Literal("accept", "edit", "reject"),
    attemptKey: Schema.String,
    expectedRouteGeneration: Schema.Number,
    expectedSourceLifecycleGeneration: Schema.Number,
    expectedWorkspaceLifecycleGeneration: Schema.Number,
    edits: Schema.Array(
      Schema.Struct({ itemKey: Schema.String, markdown: Schema.String }),
    ),
  }),
);
const ReviewMaintenanceReturns = Schema.Struct({
  proposalKey: Schema.String,
  status: Schema.Literal("published", "edited_and_published", "rejected"),
  publishedItemCount: Schema.Number,
});

const contract = (
  name: string,
  kind: "query" | "mutation",
  argsSchema: Schema.Schema.AnyNoContext,
  returnsSchema: Schema.Schema.AnyNoContext,
) => ({
  namespace: "brain.callReview",
  name,
  operationId: `brain.callReview.${name}`,
  kind,
  surfaces: ["web" as const],
  typedErrors,
  idempotent: kind === "query",
  argsSchemaName: `brain.callReview.${name}.args`,
  returnsSchemaName: `brain.callReview.${name}.returns`,
  argsSchema,
  returnsSchema,
});

export const listCallRoutingQueue = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "listCallRoutingQueue",
    args: () => ListRoutingArgs,
    returns: () => ListRoutingReturns,
    error: () => errors,
  }),
  contract(
    "listCallRoutingQueue",
    "query",
    ListRoutingArgs,
    ListRoutingReturns,
  ),
);
export const reviewCallRoute = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "reviewCallRoute",
    args: () => ReviewRouteArgs,
    returns: () => ReviewRouteReturns,
    error: () => errors,
  }),
  {
    ...contract(
      "reviewCallRoute",
      "mutation",
      ReviewRouteArgs,
      ReviewRouteReturns,
    ),
    idempotent: true,
  },
);
export const listCallMaintenanceQueue = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "listCallMaintenanceQueue",
    args: () => BrainSelector,
    returns: () => ListMaintenanceReturns,
    error: () => errors,
  }),
  contract(
    "listCallMaintenanceQueue",
    "query",
    BrainSelector,
    ListMaintenanceReturns,
  ),
);
export const reviewCallMaintenance = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "reviewCallMaintenance",
    args: () => ReviewMaintenanceArgs,
    returns: () => ReviewMaintenanceReturns,
    error: () => errors,
  }),
  {
    ...contract(
      "reviewCallMaintenance",
      "mutation",
      ReviewMaintenanceArgs,
      ReviewMaintenanceReturns,
    ),
    idempotent: true,
  },
);

const functions = [
  listCallRoutingQueue,
  reviewCallRoute,
  listCallMaintenanceQueue,
  reviewCallMaintenance,
] as const;
export const manifest = collectContractManifest(functions);
export const schemaRegistry = collectContractSchemas(functions);

export default GroupSpec.make()
  .addFunction(listCallRoutingQueue.spec)
  .addFunction(reviewCallRoute.spec)
  .addFunction(listCallMaintenanceQueue.spec)
  .addFunction(reviewCallMaintenance.spec);
