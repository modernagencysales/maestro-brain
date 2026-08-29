import { FunctionSpec, GroupSpec } from "@confect/core";
import * as S from "effect/Schema";
import { Id } from "../_generated/id";
import {
  Forbidden,
  MemberNotInWorkspace,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";

const ErrorSchema = S.Union([
  Unauthorized,
  ValidationFailed,
  Forbidden,
  MemberNotInWorkspace,
  WorkspaceNotFound,
]);
const Proposal = S.Struct({
  body: S.String,
  quote: S.String,
  epistemics: S.Literals(["factual", "subjective"]),
  quotability: S.Number,
  confidence: S.Number,
  tags: S.Array(S.String),
  validAt: S.optional(S.NullOr(S.Number)),
  expiresAt: S.optional(S.NullOr(S.Number)),
});

export const extractBrainKnowledgeCandidatesArgs = S.Struct({
  workspaceId: Id("workspaces"),
  sourceKey: S.String,
  revisionKey: S.String,
  extractionWindowKey: S.String,
  extractionPolicyVersion: S.String,
  idempotencyKey: S.String,
});
export const extractBrainKnowledgeCandidatesReturns = S.Struct({
  status: S.Literal("completed"),
  proposedCount: S.Number,
  candidateCount: S.Number,
  groundingFailureCount: S.Number,
  estimatedSpendCents: S.Number,
  extractionPolicyVersion: S.String,
  projectedAt: S.Number,
});
export const queueBrainKnowledgeExtractionArgs = S.Struct({
  workspaceId: Id("workspaces"),
  limit: S.optional(S.Number),
});
export const queueBrainKnowledgeExtractionReturns = S.Struct({
  scheduledCount: S.Number,
  skippedCount: S.Number,
  extractionPolicyVersion: S.String,
});

export const extractBrainKnowledgeCandidates = FunctionSpec.publicAction({
  name: "extractBrainKnowledgeCandidates",
  args: () => extractBrainKnowledgeCandidatesArgs,
  returns: () => extractBrainKnowledgeCandidatesReturns,
  error: () => ErrorSchema,
});
const resolveAccess = FunctionSpec.internalQuery({
  name: "resolveAccess",
  args: () => S.Struct({ workspaceId: Id("workspaces") }),
  returns: () => S.Struct({ userId: Id("users") }),
  error: () => ErrorSchema,
});
const beginExtraction = FunctionSpec.internalMutation({
  name: "beginExtraction",
  args: () =>
    S.Struct({
      ...extractBrainKnowledgeCandidatesArgs.fields,
      userId: S.optional(Id("users")),
      requireLiveGeneration: S.Boolean,
      killSwitchEnabled: S.Boolean,
      dailySpendLimitCents: S.Number,
      estimatedCostPerMillionTokensCents: S.Number,
    }),
  returns: () =>
    S.Struct({
      title: S.String,
      markdown: S.String,
      contentHash: S.String,
      locator: S.optional(S.String),
      acceptedTags: S.Array(S.String),
      alreadyCompleted: S.Boolean,
      existingProposedCount: S.Number,
      existingCandidateCount: S.Number,
      existingGroundingFailureCount: S.Number,
      existingEstimatedSpendCents: S.Number,
      existingProjectedAt: S.Number,
    }),
  error: () => ErrorSchema,
});
const extractBrainKnowledgeCandidatesScheduled = FunctionSpec.internalAction({
  name: "extractBrainKnowledgeCandidatesScheduled",
  args: () => extractBrainKnowledgeCandidatesArgs,
  returns: () => extractBrainKnowledgeCandidatesReturns,
  error: () => ErrorSchema,
});
export const queueBrainKnowledgeExtraction = FunctionSpec.publicMutation({
  name: "queueBrainKnowledgeExtraction",
  args: () => queueBrainKnowledgeExtractionArgs,
  returns: () => queueBrainKnowledgeExtractionReturns,
  error: () => ErrorSchema,
});
const queueBrainKnowledgeExtractionForActor = FunctionSpec.internalMutation({
  name: "queueBrainKnowledgeExtractionForActor",
  args: () =>
    S.Struct({
      ...queueBrainKnowledgeExtractionArgs.fields,
      userId: Id("users"),
    }),
  returns: () => queueBrainKnowledgeExtractionReturns,
  error: () => ErrorSchema,
});
const commitExtraction = FunctionSpec.internalMutation({
  name: "commitExtraction",
  args: () =>
    S.Struct({
      ...extractBrainKnowledgeCandidatesArgs.fields,
      userId: S.optional(Id("users")),
      proposals: S.Array(Proposal),
      inputTokens: S.Number,
      outputTokens: S.Number,
      projectedAt: S.Number,
    }),
  returns: () => extractBrainKnowledgeCandidatesReturns,
  error: () => ErrorSchema,
});
const failExtraction = FunctionSpec.internalMutation({
  name: "failExtraction",
  args: () =>
    S.Struct({
      workspaceId: Id("workspaces"),
      sourceKey: S.String,
      revisionKey: S.String,
      extractionPolicyVersion: S.String,
      idempotencyKey: S.String,
      failureCode: S.String,
      failedAt: S.Number,
    }),
  returns: () => S.Null,
  error: () => ErrorSchema,
});

export default GroupSpec.make()
  .addFunction(extractBrainKnowledgeCandidates)
  .addFunction(extractBrainKnowledgeCandidatesScheduled)
  .addFunction(queueBrainKnowledgeExtraction)
  .addFunction(queueBrainKnowledgeExtractionForActor)
  .addFunction(resolveAccess)
  .addFunction(beginExtraction)
  .addFunction(commitExtraction)
  .addFunction(failExtraction);
