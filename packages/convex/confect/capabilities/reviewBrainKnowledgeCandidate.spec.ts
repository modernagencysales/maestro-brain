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
const CandidateState = S.Literals([
  "unreviewed",
  "accepted",
  "rejected",
  "stale",
]);
const Evidence = S.Struct({
  sourceKey: S.String,
  revisionKey: S.String,
  contentHash: S.String,
  quote: S.String,
  startOffset: S.Number,
  endOffset: S.Number,
  locator: S.optional(S.String),
});

export const reviewBrainKnowledgeCandidateArgs = S.Struct({
  workspaceId: Id("workspaces"),
  candidateReceiptKey: S.String,
  expectedReviewRevision: S.Number,
  idempotencyKey: S.String,
  action: S.Literals(["accept", "edit_and_accept", "reject"]),
  body: S.optional(S.String),
  reason: S.optional(S.String),
});
export const reviewBrainKnowledgeCandidateReturns = S.Struct({
  status: S.Literals(["accepted", "rejected"]),
  candidateReceiptKey: S.String,
  reviewRevision: S.Number,
  claimId: S.optional(Id("claims")),
  reviewedAt: S.Number,
});
export const reviewBrainKnowledgeCandidate = FunctionSpec.publicMutation({
  name: "reviewBrainKnowledgeCandidate",
  args: () => reviewBrainKnowledgeCandidateArgs,
  returns: () => reviewBrainKnowledgeCandidateReturns,
  error: () => ErrorSchema,
});
const reviewBrainKnowledgeCandidateForActor = FunctionSpec.internalMutation({
  name: "reviewBrainKnowledgeCandidateForActor",
  args: () =>
    S.Struct({
      ...reviewBrainKnowledgeCandidateArgs.fields,
      userId: Id("users"),
    }),
  returns: () => reviewBrainKnowledgeCandidateReturns,
  error: () => ErrorSchema,
});

export const listBrainKnowledgeCandidatesArgs = S.Struct({
  workspaceId: Id("workspaces"),
  state: S.optional(CandidateState),
  limit: S.optional(S.Number),
});
export const listBrainKnowledgeCandidatesReturns = S.Array(
  S.Struct({
    candidateId: Id("brainKnowledgeCandidates"),
    candidateReceiptKey: S.String,
    propositionFingerprint: S.String,
    body: S.String,
    epistemics: S.Literals(["factual", "subjective"]),
    tags: S.Array(S.String),
    extractionConfidence: S.Number,
    currentState: CandidateState,
    reviewRevision: S.Number,
    sourceTitle: S.String,
    sourceProvider: S.Literals([
      "slack",
      "google_drive",
      "brain_page",
      "hubspot",
      "transcript",
    ]),
    evidence: S.Array(Evidence),
    createdAt: S.Number,
    updatedAt: S.Number,
  }),
);
export const listBrainKnowledgeCandidates = FunctionSpec.publicQuery({
  name: "listBrainKnowledgeCandidates",
  args: () => listBrainKnowledgeCandidatesArgs,
  returns: () => listBrainKnowledgeCandidatesReturns,
  error: () => ErrorSchema,
});
const listBrainKnowledgeCandidatesForActor = FunctionSpec.internalQuery({
  name: "listBrainKnowledgeCandidatesForActor",
  args: () =>
    S.Struct({
      ...listBrainKnowledgeCandidatesArgs.fields,
      userId: Id("users"),
    }),
  returns: () => listBrainKnowledgeCandidatesReturns,
  error: () => ErrorSchema,
});

export default GroupSpec.make()
  .addFunction(reviewBrainKnowledgeCandidate)
  .addFunction(reviewBrainKnowledgeCandidateForActor)
  .addFunction(listBrainKnowledgeCandidates)
  .addFunction(listBrainKnowledgeCandidatesForActor);
