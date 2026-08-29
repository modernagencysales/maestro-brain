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
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "./_kit/capability";

const ErrorSchema = S.Union([
  Unauthorized,
  ValidationFailed,
  Forbidden,
  MemberNotInWorkspace,
  WorkspaceNotFound,
]);
const EvidenceMode = S.Literals(["recent_evidence", "company_truth", "mixed"]);
const AnswerStatus = S.Literals(["answered", "insufficient-context"]);
const Split = S.Literals(["development", "holdout"]);
const AdjudicationState = S.Literals(["pending", "adjudicated"]);
const EvidenceReference = S.Struct({
  sourceKey: S.String,
  revisionKey: S.String,
  contentHash: S.String,
});
const EvaluationExample = S.Struct({
  evaluationExampleId: Id("brainEvaluationExamples"),
  exampleKey: S.String,
  question: S.String,
  purpose: S.String,
  evidenceMode: EvidenceMode,
  surface: S.Literals(["web", "cli", "api", "mcp"]),
  answerStatus: AnswerStatus,
  packHash: S.String,
  maxCitations: S.optional(S.Number),
  capturedAsOf: S.optional(S.Number),
  policyVersion: S.optional(S.String),
  evidenceReferences: S.Array(EvidenceReference),
  captureKind: S.Literals(["feedback", "test"]),
  usefulness: S.Literals(["useful", "needs-work", "unrated"]),
  issueReason: S.optional(
    S.Literals([
      "missing-source",
      "incorrect-answer",
      "stale-context",
      "citation-problem",
      "fallback-required",
      "other",
    ]),
  ),
  adjudicationState: AdjudicationState,
  expectedAnswerStatus: S.optional(AnswerStatus),
  expectedEvidenceReferences: S.Array(EvidenceReference),
  riskLevel: S.optional(S.Literals(["ordinary", "high"])),
  adjudicatedAt: S.optional(S.Number),
  split: Split,
  freezeKey: S.optional(S.String),
  freezePreviewHash: S.optional(S.String),
  freezeCutoffCreatedAt: S.optional(S.Number),
  frozenAt: S.optional(S.Number),
  createdAt: S.Number,
  updatedAt: S.Number,
});

export const listBrainEvaluationExamplesArgs = S.Struct({
  workspaceId: Id("workspaces"),
  split: S.optional(Split),
  adjudicationState: S.optional(AdjudicationState),
  captureKind: S.optional(S.Literals(["feedback", "test"])),
  limit: S.optional(S.Number),
  cursorCreatedAt: S.optional(S.Number),
  cursorExampleKey: S.optional(S.String),
  includeHoldoutGold: S.optional(S.Boolean),
});
export const listBrainEvaluationExamplesReturns = S.Struct({
  examples: S.Array(EvaluationExample),
  nextCursorCreatedAt: S.optional(S.Number),
  nextCursorExampleKey: S.optional(S.String),
});

export const getBrainEvaluationExampleArgs = S.Struct({
  workspaceId: Id("workspaces"),
  exampleKey: S.String,
  includeHoldoutGold: S.optional(S.Boolean),
});
export const getBrainEvaluationExampleReturns = EvaluationExample;

export const adjudicateBrainEvaluationExampleArgs = S.Struct({
  workspaceId: Id("workspaces"),
  exampleKey: S.String,
  expectedUpdatedAt: S.Number,
  expectedAnswerStatus: AnswerStatus,
  expectedEvidenceReferences: S.Array(EvidenceReference),
  riskLevel: S.Literals(["ordinary", "high"]),
});
export const adjudicateBrainEvaluationExampleReturns = EvaluationExample;

export const previewBrainEvaluationFreezeArgs = S.Struct({
  workspaceId: Id("workspaces"),
  cutoffCreatedAt: S.Number,
});
export const BrainEvaluationFreezePreview = S.Struct({
  maturity: S.Literals(["insufficient-sample", "ready"]),
  adjudicatedCount: S.Number,
  selectedExampleKeys: S.Array(S.String),
  excludedForSourceOverlap: S.Number,
  previewHash: S.String,
});

export const applyBrainEvaluationFreezeArgs = S.Struct({
  workspaceId: Id("workspaces"),
  cutoffCreatedAt: S.Number,
  expectedPreviewHash: S.String,
  freezeKey: S.String,
});
export const applyBrainEvaluationFreezeReturns = S.Struct({
  freezeKey: S.String,
  frozenAt: S.Number,
  previewHash: S.String,
  selectedExampleKeys: S.Array(S.String),
});

const RedactedEvaluationExample = S.Struct({
  exampleKey: S.String,
  questionHash: S.String,
  purpose: S.String,
  evidenceMode: EvidenceMode,
  surface: S.Literals(["web", "cli", "api", "mcp"]),
  answerStatus: AnswerStatus,
  packHash: S.String,
  maxCitations: S.optional(S.Number),
  capturedAsOf: S.optional(S.Number),
  policyVersion: S.optional(S.String),
  evidenceReferences: S.Array(EvidenceReference),
  captureKind: S.Literals(["feedback", "test"]),
  usefulness: S.Literals(["useful", "needs-work", "unrated"]),
  issueReason: S.optional(S.String),
  adjudicationState: AdjudicationState,
  expectedAnswerStatus: S.optional(AnswerStatus),
  expectedEvidenceReferences: S.Array(EvidenceReference),
  riskLevel: S.optional(S.Literals(["ordinary", "high"])),
  split: Split,
  freezeKey: S.optional(S.String),
  createdAt: S.Number,
  updatedAt: S.Number,
});
export const exportBrainEvaluationExamplesArgs = S.Struct({
  workspaceId: Id("workspaces"),
  split: S.optional(Split),
});
export const exportBrainEvaluationExamplesReturns = S.Struct({
  schemaVersion: S.Literal("1"),
  rows: S.Array(RedactedEvaluationExample),
  rowCount: S.Number,
  exportHash: S.String,
});

const actorArgs = <Fields extends S.Struct.Fields>(fields: Fields) =>
  S.Struct({ ...fields, userId: Id("users") });

const typedErrors = [
  "Unauthorized",
  "ValidationFailed",
  "Forbidden",
  "MemberNotInWorkspace",
  "WorkspaceNotFound",
] as const;
const contract = <Spec, Args extends S.Top, Returns extends S.Top>(
  spec: Spec,
  name:
    "list" | "get" | "adjudicate" | "freezePreview" | "freezeApply" | "export",
  kind: "query" | "mutation",
  argsSchema: Args,
  returnsSchema: Returns,
) =>
  defineContractFunction(spec, {
    namespace: "brain.evaluations",
    name,
    operationId: `brain.evaluations.${name}`,
    kind,
    surfaces: ["api", "cli"],
    typedErrors: [...typedErrors],
    idempotent: kind === "query" || name === "freezeApply",
    argsSchemaName: `brain.evaluations.${name}.args`,
    returnsSchemaName: `brain.evaluations.${name}.returns`,
    argsSchema,
    returnsSchema,
  });

const listBrainEvaluationExamples = contract(
  FunctionSpec.publicQuery({
    name: "listBrainEvaluationExamples",
    args: () => listBrainEvaluationExamplesArgs,
    returns: () => listBrainEvaluationExamplesReturns,
    error: () => ErrorSchema,
  }),
  "list",
  "query",
  listBrainEvaluationExamplesArgs,
  listBrainEvaluationExamplesReturns,
);
const listBrainEvaluationExamplesForActor = FunctionSpec.internalQuery({
  name: "listBrainEvaluationExamplesForActor",
  args: () => actorArgs(listBrainEvaluationExamplesArgs.fields),
  returns: () => listBrainEvaluationExamplesReturns,
  error: () => ErrorSchema,
});
const getBrainEvaluationExample = contract(
  FunctionSpec.publicQuery({
    name: "getBrainEvaluationExample",
    args: () => getBrainEvaluationExampleArgs,
    returns: () => getBrainEvaluationExampleReturns,
    error: () => ErrorSchema,
  }),
  "get",
  "query",
  getBrainEvaluationExampleArgs,
  getBrainEvaluationExampleReturns,
);
const getBrainEvaluationExampleForActor = FunctionSpec.internalQuery({
  name: "getBrainEvaluationExampleForActor",
  args: () => actorArgs(getBrainEvaluationExampleArgs.fields),
  returns: () => getBrainEvaluationExampleReturns,
  error: () => ErrorSchema,
});
const adjudicateBrainEvaluationExample = contract(
  FunctionSpec.publicMutation({
    name: "adjudicateBrainEvaluationExample",
    args: () => adjudicateBrainEvaluationExampleArgs,
    returns: () => adjudicateBrainEvaluationExampleReturns,
    error: () => ErrorSchema,
  }),
  "adjudicate",
  "mutation",
  adjudicateBrainEvaluationExampleArgs,
  adjudicateBrainEvaluationExampleReturns,
);
const adjudicateBrainEvaluationExampleForActor = FunctionSpec.internalMutation({
  name: "adjudicateBrainEvaluationExampleForActor",
  args: () => actorArgs(adjudicateBrainEvaluationExampleArgs.fields),
  returns: () => adjudicateBrainEvaluationExampleReturns,
  error: () => ErrorSchema,
});
const previewBrainEvaluationFreeze = contract(
  FunctionSpec.publicQuery({
    name: "previewBrainEvaluationFreeze",
    args: () => previewBrainEvaluationFreezeArgs,
    returns: () => BrainEvaluationFreezePreview,
    error: () => ErrorSchema,
  }),
  "freezePreview",
  "query",
  previewBrainEvaluationFreezeArgs,
  BrainEvaluationFreezePreview,
);
const previewBrainEvaluationFreezeForActor = FunctionSpec.internalQuery({
  name: "previewBrainEvaluationFreezeForActor",
  args: () => actorArgs(previewBrainEvaluationFreezeArgs.fields),
  returns: () => BrainEvaluationFreezePreview,
  error: () => ErrorSchema,
});
const applyBrainEvaluationFreeze = contract(
  FunctionSpec.publicMutation({
    name: "applyBrainEvaluationFreeze",
    args: () => applyBrainEvaluationFreezeArgs,
    returns: () => applyBrainEvaluationFreezeReturns,
    error: () => ErrorSchema,
  }),
  "freezeApply",
  "mutation",
  applyBrainEvaluationFreezeArgs,
  applyBrainEvaluationFreezeReturns,
);
const applyBrainEvaluationFreezeForActor = FunctionSpec.internalMutation({
  name: "applyBrainEvaluationFreezeForActor",
  args: () => actorArgs(applyBrainEvaluationFreezeArgs.fields),
  returns: () => applyBrainEvaluationFreezeReturns,
  error: () => ErrorSchema,
});
const exportBrainEvaluationExamples = contract(
  FunctionSpec.publicQuery({
    name: "exportBrainEvaluationExamples",
    args: () => exportBrainEvaluationExamplesArgs,
    returns: () => exportBrainEvaluationExamplesReturns,
    error: () => ErrorSchema,
  }),
  "export",
  "query",
  exportBrainEvaluationExamplesArgs,
  exportBrainEvaluationExamplesReturns,
);
const exportBrainEvaluationExamplesForActor = FunctionSpec.internalQuery({
  name: "exportBrainEvaluationExamplesForActor",
  args: () => actorArgs(exportBrainEvaluationExamplesArgs.fields),
  returns: () => exportBrainEvaluationExamplesReturns,
  error: () => ErrorSchema,
});

const contractFunctions = [
  listBrainEvaluationExamples,
  getBrainEvaluationExample,
  adjudicateBrainEvaluationExample,
  previewBrainEvaluationFreeze,
  applyBrainEvaluationFreeze,
  exportBrainEvaluationExamples,
] as const;
export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(listBrainEvaluationExamples.spec)
  .addFunction(listBrainEvaluationExamplesForActor)
  .addFunction(getBrainEvaluationExample.spec)
  .addFunction(getBrainEvaluationExampleForActor)
  .addFunction(adjudicateBrainEvaluationExample.spec)
  .addFunction(adjudicateBrainEvaluationExampleForActor)
  .addFunction(previewBrainEvaluationFreeze.spec)
  .addFunction(previewBrainEvaluationFreezeForActor)
  .addFunction(applyBrainEvaluationFreeze.spec)
  .addFunction(applyBrainEvaluationFreezeForActor)
  .addFunction(exportBrainEvaluationExamples.spec)
  .addFunction(exportBrainEvaluationExamplesForActor);
