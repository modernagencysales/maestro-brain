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
import { BrainEvidenceProvider } from "../tables/brainEvidenceSources";

const ErrorSchema = S.Union([
  Unauthorized,
  ValidationFailed,
  Forbidden,
  MemberNotInWorkspace,
  WorkspaceNotFound,
]);
export const EvidenceMode = S.Literals([
  "recent_evidence",
  "company_truth",
  "mixed",
]);
export const AskCompanyBrainArgs = S.Struct({
  workspaceId: Id("workspaces"),
  question: S.String,
  evidenceMode: S.optional(EvidenceMode),
  maxCitations: S.optional(S.Number),
  asOf: S.optional(S.Number),
  riskLevel: S.optional(S.Literals(["ordinary", "high"])),
});
const AskCompanyBrainForActorArgs = S.Struct({
  ...AskCompanyBrainArgs.fields,
  userId: Id("users"),
});
export const BrainPackCitationV4 = S.Struct({
  citationKey: S.String,
  supportKind: S.Literals(["claim", "page", "recent_evidence"]),
  claimId: S.optional(Id("claims")),
  sourceKey: S.String,
  revisionKey: S.String,
  provider: BrainEvidenceProvider,
  title: S.String,
  excerpt: S.String,
  startOffset: S.Number,
  endOffset: S.Number,
  contentHash: S.String,
  locator: S.optional(S.String),
  sourceModifiedAt: S.Number,
  observedAt: S.Number,
  freshness: S.Literals(["current", "review-due", "stale"]),
});
export const ContextPackV4 = S.Struct({
  schemaVersion: S.Literal("4"),
  policyVersion: S.String,
  evidenceMode: EvidenceMode,
  packHash: S.String,
  workspaceId: Id("workspaces"),
  question: S.String,
  asOf: S.Number,
  freshness: S.Literals(["current", "review-due", "stale", "unknown"]),
  claims: S.Array(
    S.Struct({
      claimId: Id("claims"),
      body: S.String,
      epistemics: S.Literals(["factual", "subjective"]),
      tags: S.Array(S.String),
      verifiedAt: S.Number,
      nextReviewAt: S.Number,
      freshness: S.Literals(["current", "review-due", "stale", "unknown"]),
      citationKeys: S.Array(S.String),
    }),
  ),
  citations: S.Array(BrainPackCitationV4),
  conflicts: S.Array(
    S.Struct({
      propositionFingerprint: S.String,
      claimIds: S.Array(Id("claims")),
      reason: S.Literal("possible-contradiction"),
    }),
  ),
  omissions: S.Array(
    S.Struct({
      reason: S.Literals([
        "archived",
        "revision-mismatch",
        "not-relevant",
        "citation-inaccessible",
        "stale-high-risk",
        "possible-conflict",
        "capacity",
      ]),
      count: S.Number,
    }),
  ),
});
export const AskCompanyBrainReturn = S.Union([
  S.Struct({
    status: S.Literal("answered"),
    answerMarkdown: S.String,
    contextPack: ContextPackV4,
  }),
  S.Struct({
    status: S.Literal("insufficient-context"),
    reason: S.Literals([
      "no-eligible-evidence",
      "stale-high-risk",
      "possible-conflict",
    ]),
    answerMarkdown: S.Null,
    contextPack: ContextPackV4,
  }),
]);

export const askCompanyBrain = FunctionSpec.publicQuery({
  name: "askCompanyBrain",
  args: () => AskCompanyBrainArgs,
  returns: () => AskCompanyBrainReturn,
  error: () => ErrorSchema,
});
export const askCompanyBrainForActor = FunctionSpec.internalQuery({
  name: "askCompanyBrainForActor",
  args: () => AskCompanyBrainForActorArgs,
  returns: () => AskCompanyBrainReturn,
  error: () => ErrorSchema,
});

export default GroupSpec.make()
  .addFunction(askCompanyBrain)
  .addFunction(askCompanyBrainForActor);
