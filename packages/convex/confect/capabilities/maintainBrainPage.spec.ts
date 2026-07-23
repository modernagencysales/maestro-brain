import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { Forbidden, Unauthorized, ValidationFailed } from "../errors";

export class CitationRequired extends Schema.TaggedError<CitationRequired>()(
  "CitationRequired",
  {},
) {}
export class CitationNotInManifest extends Schema.TaggedError<CitationNotInManifest>()(
  "CitationNotInManifest",
  { citationKey: Schema.String },
) {}
export class RevisionBudgetExceeded extends Schema.TaggedError<RevisionBudgetExceeded>()(
  "RevisionBudgetExceeded",
  { limit: Schema.Number },
) {}
export class AutopilotNotEligible extends Schema.TaggedError<AutopilotNotEligible>()(
  "AutopilotNotEligible",
  { reason: Schema.String },
) {}
export class StaleRevision extends Schema.TaggedError<StaleRevision>()(
  "StaleRevision",
  { proposalKey: Schema.String },
) {}
export class LifecycleRevoked extends Schema.TaggedError<LifecycleRevoked>()(
  "LifecycleRevoked",
  { lifecycleGeneration: Schema.Number },
) {}

export const MaintenanceCapabilityErrors = Schema.Union(
  Unauthorized,
  ValidationFailed,
  Forbidden,
  CitationRequired,
  CitationNotInManifest,
  RevisionBudgetExceeded,
  AutopilotNotEligible,
  StaleRevision,
  LifecycleRevoked,
);

export const maintainBrainPageArgs = Schema.Struct({
  workspaceSlug: Schema.String,
  contextPackId: Schema.String,
  context: Schema.Any,
  modelOutput: Schema.Any,
  autopilot: Schema.optional(Schema.Any),
});

export const maintainBrainPageReturns = Schema.Struct({
  proposalKey: Schema.String,
  status: Schema.Literal(
    "proposed_noop",
    "accepted_noop",
    "proposed_revision",
    "awaiting_review",
    "published",
    "edited_and_published",
    "rejected",
    "superseded",
    "revoked",
  ),
  citationKeys: Schema.Array(Schema.String),
  revisionEffect: Schema.NullOr(
    Schema.Struct({
      pageKey: Schema.String,
      expectedRevisionKey: Schema.String,
      markdown: Schema.String,
      citationKeys: Schema.Array(Schema.String),
    }),
  ),
});

export const maintainBrainPage = FunctionSpec.publicMutation({
  name: "maintainBrainPage",
  args: () => maintainBrainPageArgs,
  returns: () => maintainBrainPageReturns,
  error: () => MaintenanceCapabilityErrors,
});

export default GroupSpec.make().addFunction(maintainBrainPage);
