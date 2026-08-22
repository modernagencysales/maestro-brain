import * as Schema from "effect/Schema";

import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
  RetrievalEntryKey,
  RetrievalPublicationSetKey,
} from "./retrievalSchemas";

export const FeedbackCategory = Schema.Literal(
  "missing_source",
  "stale_source",
  "retrieval_miss",
  "answer_failure",
  "usability_failure",
);
export type FeedbackCategory = Schema.Schema.Type<typeof FeedbackCategory>;

export const FeedbackDisposition = Schema.Literal(
  "untriaged",
  "accepted",
  "dismissed",
  "resolved",
);
export type FeedbackDisposition = Schema.Schema.Type<
  typeof FeedbackDisposition
>;

export const FeedbackCitation = Schema.Struct({
  publicationSetKey: RetrievalPublicationSetKey,
  entryKey: RetrievalEntryKey,
});
export type FeedbackCitation = Schema.Schema.Type<typeof FeedbackCitation>;
export const FeedbackCitations = Schema.Array(FeedbackCitation).pipe(
  Schema.maxItems(64),
);

const FeedbackReadinessGenerations = Schema.Struct({
  connection: Schema.optional(PositiveInteger),
  allowlist: Schema.optional(PositiveInteger),
  policy: Schema.optional(PositiveInteger),
  reconciliation: Schema.optional(PositiveInteger),
});

export const FeedbackReadinessCoverage = Schema.Struct({
  corpusKey: Schema.String.pipe(
    Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/),
  ),
  sourceKind: Schema.String.pipe(
    Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/),
  ),
  connectorScopeKey: Schema.String.pipe(
    Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/),
  ),
  required: Schema.Boolean,
  status: Schema.Literal("complete", "partial", "unavailable", "unknown"),
  freshness: Schema.Literal("current", "stale", "unknown"),
  generations: FeedbackReadinessGenerations,
  lastObservedAt: Schema.optional(NonNegativeInteger),
  lastReconciledAt: Schema.optional(NonNegativeInteger),
  unresolvedFailureCount: NonNegativeInteger,
});
export type FeedbackReadinessCoverage = Schema.Schema.Type<
  typeof FeedbackReadinessCoverage
>;

export const FeedbackReadiness = Schema.Struct({
  asOf: NonNegativeInteger,
  coverage: Schema.Array(FeedbackReadinessCoverage).pipe(Schema.maxItems(128)),
});
export type FeedbackReadiness = Schema.Schema.Type<typeof FeedbackReadiness>;

export const FeedbackSubmitter = Schema.Struct({
  kind: Schema.Literal("user", "service_principal"),
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
});
export type FeedbackSubmitter = Schema.Schema.Type<typeof FeedbackSubmitter>;

export const FeedbackBrainKey = Schema.String.pipe(
  Schema.pattern(/^br_[0-9A-HJKMNP-TV-Z]{26}$/),
);
export const FeedbackIdempotencyKey = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/),
);
export const FeedbackRequestId = Schema.String.pipe(
  Schema.pattern(/^ctx_[a-f0-9]{64}$/),
);
export const FeedbackEvaluationRerunKey = Schema.String.pipe(
  Schema.pattern(/^evalrun_[a-f0-9]{64}$/),
);
export const FeedbackReportKey = Schema.String.pipe(
  Schema.pattern(/^fbr_[a-f0-9]{64}$/),
);

export const FeedbackReportInput = Schema.Struct({
  brainKey: FeedbackBrainKey,
  idempotencyKey: FeedbackIdempotencyKey,
  requestId: FeedbackRequestId,
  candidateManifestHash: ContentHash,
  citations: FeedbackCitations,
  readiness: FeedbackReadiness,
  category: FeedbackCategory,
  disposition: FeedbackDisposition,
  evaluationRerunKey: Schema.optional(FeedbackEvaluationRerunKey),
});
export type FeedbackReportInput = Schema.Schema.Type<
  typeof FeedbackReportInput
>;

export const FeedbackReportResult = Schema.Struct({
  reportKey: FeedbackReportKey,
  duplicate: Schema.Boolean,
  requestId: FeedbackRequestId,
  createdAt: NonNegativeInteger,
});
export type FeedbackReportResult = Schema.Schema.Type<
  typeof FeedbackReportResult
>;
