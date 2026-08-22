import * as Schema from "effect/Schema";

import {
  NonEmptyStructuredString,
  StructuredDigest,
  StructuredFact,
  StructuredNonNegativeInteger,
  type StructuredFact as StructuredFactType,
  structuredCanonicalJson,
} from "../integrations/structuredLedgerSchemas";
import { sha256Hex } from "../shared/sha256";

export const CandidateManifestV2 = Schema.Struct({
  version: Schema.Literal("2"),
  hash: StructuredDigest,
});
export type CandidateManifestV2 = typeof CandidateManifestV2.Type;

export const ContextPackV2Entry = Schema.Struct({
  kind: Schema.Literal("source", "page", "projection"),
  brainKey: NonEmptyStructuredString,
  title: Schema.String,
  excerpt: Schema.String,
  sourceKey: NonEmptyStructuredString,
  revisionKey: NonEmptyStructuredString,
  publicationSetKey: NonEmptyStructuredString,
  entryKey: NonEmptyStructuredString,
  passageKey: NonEmptyStructuredString,
  unitKey: Schema.optional(NonEmptyStructuredString),
  segmentKey: Schema.optional(NonEmptyStructuredString),
  startOffset: StructuredNonNegativeInteger,
  endOffset: StructuredNonNegativeInteger,
  locator: Schema.optional(Schema.String),
  contentHash: Schema.optional(StructuredDigest),
  authority: Schema.Literal("authoritative", "derived", "advisory"),
  sourceModifiedAt: Schema.optional(StructuredNonNegativeInteger),
  observedAt: Schema.optional(StructuredNonNegativeInteger),
  indexedAt: Schema.optional(StructuredNonNegativeInteger),
  freshness: Schema.Literal("current", "stale", "unknown"),
  truncated: Schema.Boolean,
});

export const ContextPackV2 = Schema.Struct({
  schemaVersion: Schema.Literal("2"),
  candidateManifest: CandidateManifestV2,
  requestId: NonEmptyStructuredString,
  organizationKey: NonEmptyStructuredString,
  brainKey: NonEmptyStructuredString,
  question: Schema.String,
  asOf: StructuredNonNegativeInteger,
  coverage: Schema.Array(
    Schema.Struct({
      corpusKey: NonEmptyStructuredString,
      sourceKind: NonEmptyStructuredString,
      connectorScopeKey: NonEmptyStructuredString,
      required: Schema.Boolean,
      status: Schema.Literal("complete", "partial", "unavailable", "unknown"),
      freshness: Schema.Literal("current", "stale", "unknown"),
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
    }),
  ),
  entries: Schema.Array(ContextPackV2Entry),
  structuredFacts: Schema.Array(StructuredFact).pipe(Schema.maxItems(400)),
  conflicts: Schema.Array(
    Schema.Struct({
      subject: NonEmptyStructuredString,
      revisionKeys: Schema.Array(NonEmptyStructuredString),
    }),
  ),
  structuredConflicts: Schema.Array(
    Schema.Struct({
      subject: NonEmptyStructuredString,
      narrativeRevisionKeys: Schema.Array(NonEmptyStructuredString),
      structuredRevisionKeys: Schema.Array(NonEmptyStructuredString),
      reason: Schema.Literal("narrative_typed_disagreement"),
      behavior: Schema.Literal("expose_both"),
    }),
  ),
  omissions: Schema.Array(
    Schema.Struct({
      reason: NonEmptyStructuredString,
      count: StructuredNonNegativeInteger,
    }),
  ),
});
export type ContextPackV2 = typeof ContextPackV2.Type;

type CandidateManifestEntry = {
  readonly kind: "source" | "page" | "projection";
  readonly publicationSetKey: string;
  readonly entryKey: string;
  readonly revisionKey: string;
  readonly contentHash: string;
};

const manifestFact = (fact: StructuredFactType) => ({
  origin: fact.origin,
  entity: fact.entity,
  fieldPath: fact.fieldPath,
  value: fact.value,
  revision: fact.revision,
  valueHash: fact.valueHash,
  authority: fact.authority,
  sourceModifiedAt: fact.sourceModifiedAt,
  observedAt: fact.observedAt,
  locator: fact.locator,
  actionRef: fact.actionRef ?? null,
});

export const buildCandidateManifestV2 = (input: {
  readonly entries: readonly CandidateManifestEntry[];
  readonly structuredFacts: readonly StructuredFactType[];
}): CandidateManifestV2 => ({
  version: "2",
  hash: `sha256:${sha256Hex(
    structuredCanonicalJson({
      entries: input.entries,
      structuredFacts: input.structuredFacts.map(manifestFact),
    }),
  )}`,
});

export const classifyNarrativeStructuredConflict = (input: {
  readonly subject: string;
  readonly narrativeRevisionKey: string;
  readonly narrativeValueHash: string;
  readonly structuredFact: StructuredFactType;
}) =>
  input.narrativeValueHash === input.structuredFact.valueHash
    ? ({
        status: "consistent" as const,
        behavior: "no_conflict" as const,
        subject: input.subject,
        narrativeRevisionKey: input.narrativeRevisionKey,
        structuredRevisionKey:
          input.structuredFact.revision.structuredRevisionKey,
        authoritativeValueHash:
          input.structuredFact.authority === "authoritative"
            ? input.structuredFact.valueHash
            : null,
      } as const)
    : ({
        status: "conflict" as const,
        behavior: "expose_both" as const,
        subject: input.subject,
        narrativeRevisionKey: input.narrativeRevisionKey,
        structuredRevisionKey:
          input.structuredFact.revision.structuredRevisionKey,
        authoritativeValueHash:
          input.structuredFact.authority === "authoritative"
            ? input.structuredFact.valueHash
            : null,
      } as const);
