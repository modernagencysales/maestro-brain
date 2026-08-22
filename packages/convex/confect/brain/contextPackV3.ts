import * as Schema from "effect/Schema";

import {
  NonEmptyStructuredString,
  StructuredFact,
  StructuredNonNegativeInteger,
} from "../integrations/structuredLedgerSchemas";
import { CandidateManifestV2, ContextPackV2Entry } from "./contextPackV2";

export const ContextPackFreshness = Schema.Literal(
  "current",
  "stale",
  "unknown",
);
export const ContextPackCoverageStatus = Schema.Literal(
  "complete",
  "partial",
  "unavailable",
  "unknown",
);
export const ContextPackReadiness = Schema.Literal("ready", "blocked");

export const ContextPackV3Entry = Schema.extend(
  ContextPackV2Entry,
  Schema.Struct({
    sourceRevisionKey: Schema.optional(NonEmptyStructuredString),
    citationKey: Schema.optional(NonEmptyStructuredString),
    citationLabel: Schema.optional(Schema.String),
    permalink: Schema.optional(Schema.String),
    authorityPolicyKey: Schema.optional(NonEmptyStructuredString),
    state: Schema.optional(Schema.Literal("resolved", "superseded")),
  }),
);

export const ContextPackV3Coverage = Schema.Struct({
  corpusKey: NonEmptyStructuredString,
  sourceKind: NonEmptyStructuredString,
  connectorScopeKey: NonEmptyStructuredString,
  required: Schema.Boolean,
  status: ContextPackCoverageStatus,
  freshness: ContextPackFreshness,
  generations: Schema.Struct({
    connection: Schema.optional(StructuredNonNegativeInteger),
    allowlist: Schema.optional(StructuredNonNegativeInteger),
    policy: Schema.optional(StructuredNonNegativeInteger),
    reconciliation: Schema.optional(StructuredNonNegativeInteger),
  }),
  lastObservedAt: Schema.optional(StructuredNonNegativeInteger),
  lastReconciledAt: Schema.optional(StructuredNonNegativeInteger),
  unresolvedFailureCount: StructuredNonNegativeInteger,
  reason: Schema.optional(Schema.String),
});

export const ContextPackV3 = Schema.Struct({
  schemaVersion: Schema.Literal("3"),
  candidateManifest: CandidateManifestV2,
  requestId: NonEmptyStructuredString,
  organizationKey: NonEmptyStructuredString,
  brainKey: NonEmptyStructuredString,
  question: Schema.String,
  asOf: StructuredNonNegativeInteger,
  freshness: ContextPackFreshness,
  coverageStatus: ContextPackCoverageStatus,
  readiness: ContextPackReadiness,
  coverage: Schema.Array(ContextPackV3Coverage).pipe(Schema.maxItems(200)),
  entries: Schema.Array(ContextPackV3Entry).pipe(Schema.maxItems(40)),
  structuredFacts: Schema.Array(StructuredFact).pipe(Schema.maxItems(400)),
  conflicts: Schema.Array(
    Schema.Struct({
      subject: NonEmptyStructuredString,
      revisionKeys: Schema.Array(NonEmptyStructuredString).pipe(
        Schema.maxItems(100),
      ),
    }),
  ).pipe(Schema.maxItems(100)),
  structuredConflicts: Schema.Array(
    Schema.Struct({
      subject: NonEmptyStructuredString,
      narrativeRevisionKeys: Schema.Array(NonEmptyStructuredString).pipe(
        Schema.maxItems(100),
      ),
      structuredRevisionKeys: Schema.Array(NonEmptyStructuredString).pipe(
        Schema.maxItems(100),
      ),
      reason: Schema.Literal("narrative_typed_disagreement"),
      behavior: Schema.Literal("expose_both"),
    }),
  ).pipe(Schema.maxItems(100)),
  omissions: Schema.Array(
    Schema.Struct({
      reason: NonEmptyStructuredString,
      count: StructuredNonNegativeInteger,
    }),
  ).pipe(Schema.maxItems(100)),
});
export type ContextPackV3 = typeof ContextPackV3.Type;
