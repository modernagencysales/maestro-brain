import * as Schema from "effect/Schema";

import { sha256Hex } from "../shared/sha256";

export const NonEmptyStructuredString = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(2_048),
);
export const EligibilityFenceKey = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(512),
);
export const StructuredNonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);
export const StructuredPositiveInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThan(0),
);
export const StructuredDigest = Schema.String.pipe(
  Schema.pattern(/^sha256:[a-f0-9]{64}$/),
);
export const StructuredEntityKey = Schema.String.pipe(
  Schema.pattern(/^sent_[a-f0-9]{64}$/),
);
export const StructuredRevisionKey = Schema.String.pipe(
  Schema.pattern(/^srev_[a-f0-9]{64}$/),
);
export const StructuredObservationKey = Schema.String.pipe(
  Schema.pattern(/^sobs_[a-f0-9]{64}$/),
);
export const StructuredFieldKey = Schema.String.pipe(
  Schema.pattern(/^sfld_[a-f0-9]{64}$/),
);
export const StructuredRouteKey = Schema.String.pipe(
  Schema.pattern(/^sroute_[a-f0-9]{64}$/),
);

export const StructuredValue = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("string"),
    value: Schema.String.pipe(Schema.maxLength(2_048)),
  }),
  Schema.Struct({ type: Schema.Literal("number"), value: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("boolean"), value: Schema.Boolean }),
  Schema.Struct({
    type: Schema.Literal("timestamp"),
    value: StructuredNonNegativeInteger,
  }),
);
export type StructuredValue = typeof StructuredValue.Type;
export const StructuredValueType = Schema.Literal(
  "string",
  "number",
  "boolean",
  "timestamp",
);
export type StructuredValueType = typeof StructuredValueType.Type;

export const StructuredAuthority = Schema.Literal(
  "authoritative",
  "derived",
  "advisory",
);
export type StructuredAuthority = typeof StructuredAuthority.Type;

export const EligibilityFence = Schema.Struct({
  key: EligibilityFenceKey,
  eligibilityGeneration: StructuredPositiveInteger,
});
export const StructuredEligibilityManifest = Schema.Struct({
  entityLifecycle: EligibilityFence,
  connectorScope: EligibilityFence,
  allowlist: EligibilityFence,
  connection: EligibilityFence,
  fieldMappingPolicy: EligibilityFence,
});
export type StructuredEligibilityManifest =
  typeof StructuredEligibilityManifest.Type;

export const StructuredInputField = Schema.Struct({
  fieldPath: NonEmptyStructuredString,
  value: StructuredValue,
  authority: StructuredAuthority,
});
export type StructuredInputField = typeof StructuredInputField.Type;

export const StructuredCanonicalObservation = Schema.Struct({
  providerKey: NonEmptyStructuredString,
  entityKind: NonEmptyStructuredString,
  providerEntityId: NonEmptyStructuredString,
  providerRevision: NonEmptyStructuredString,
  observationOrder: StructuredNonNegativeInteger,
  connectorScopeKey: NonEmptyStructuredString,
  connectionKey: NonEmptyStructuredString,
  connectionGeneration: StructuredPositiveInteger,
  allowlistGeneration: StructuredPositiveInteger,
  fieldMappingPolicyKey: NonEmptyStructuredString,
  fieldMappingPolicyGeneration: StructuredPositiveInteger,
  sourceModifiedAt: StructuredNonNegativeInteger,
  observedAt: StructuredNonNegativeInteger,
  locator: NonEmptyStructuredString,
  tombstone: Schema.Boolean,
  fields: Schema.Array(StructuredInputField).pipe(Schema.maxItems(64)),
  eligibilityManifest: StructuredEligibilityManifest,
});
export type StructuredCanonicalObservation =
  typeof StructuredCanonicalObservation.Type;

export const CommitStructuredObservationArgs = Schema.Struct({
  organizationKey: NonEmptyStructuredString,
  workspaceId: NonEmptyStructuredString,
  brainKey: NonEmptyStructuredString,
  expectedIncarnation: Schema.NullOr(StructuredPositiveInteger),
  observation: StructuredCanonicalObservation,
});
export type CommitStructuredObservationArgs =
  typeof CommitStructuredObservationArgs.Type;

export const StructuredLedgerClassification = Schema.Literal(
  "created",
  "newer",
  "duplicate",
  "stale",
  "conflict",
  "tombstone",
  "recreated",
  "superseded",
);
export type StructuredLedgerClassification =
  typeof StructuredLedgerClassification.Type;

export const StructuredOrigin = Schema.Struct({
  kind: Schema.Literal("structured"),
  organizationKey: NonEmptyStructuredString,
  workspaceId: NonEmptyStructuredString,
  brainKey: NonEmptyStructuredString,
  structuredEntityKey: StructuredEntityKey,
  structuredRevisionKey: StructuredRevisionKey,
  structuredObservationKey: StructuredObservationKey,
  structuredRouteKey: StructuredRouteKey,
  fieldPath: NonEmptyStructuredString,
  valueHash: StructuredDigest,
});
export type StructuredOrigin = typeof StructuredOrigin.Type;

export const StructuredEntityReference = Schema.Struct({
  structuredEntityKey: StructuredEntityKey,
  providerKey: NonEmptyStructuredString,
  entityKind: NonEmptyStructuredString,
  providerEntityId: NonEmptyStructuredString,
  incarnation: StructuredPositiveInteger,
});
export type StructuredEntityReference = typeof StructuredEntityReference.Type;

export const StructuredRevisionReference = Schema.Struct({
  structuredRevisionKey: StructuredRevisionKey,
  providerRevision: NonEmptyStructuredString,
  observationOrder: StructuredNonNegativeInteger,
  incarnation: StructuredPositiveInteger,
});
export type StructuredRevisionReference =
  typeof StructuredRevisionReference.Type;

export const StructuredFact = Schema.Struct({
  origin: StructuredOrigin,
  entity: StructuredEntityReference,
  fieldPath: NonEmptyStructuredString,
  value: StructuredValue,
  revision: StructuredRevisionReference,
  valueHash: StructuredDigest,
  authority: StructuredAuthority,
  sourceModifiedAt: StructuredNonNegativeInteger,
  observedAt: StructuredNonNegativeInteger,
  locator: NonEmptyStructuredString,
  actionRef: Schema.optional(NonEmptyStructuredString),
});
export type StructuredFact = typeof StructuredFact.Type;

export const CommitStructuredObservationResult = Schema.Struct({
  classification: StructuredLedgerClassification,
  entityKey: StructuredEntityKey,
  revisionKey: Schema.NullOr(StructuredRevisionKey),
  observationKey: StructuredObservationKey,
  routeKey: Schema.NullOr(StructuredRouteKey),
  incarnation: StructuredPositiveInteger,
  fieldCount: StructuredNonNegativeInteger,
  origins: Schema.Array(StructuredOrigin).pipe(Schema.maxItems(64)),
});
export type CommitStructuredObservationResult =
  typeof CommitStructuredObservationResult.Type;

export class StructuredOriginIntegrityFailure extends Schema.TaggedError<StructuredOriginIntegrityFailure>()(
  "StructuredOriginIntegrityFailure",
  {
    reason: Schema.Literal(
      "entity_missing",
      "revision_missing",
      "observation_missing",
      "field_missing",
      "identity_mismatch",
      "value_hash_mismatch",
      "field_manifest_mismatch",
      "eligibility_manifest_mismatch",
      "field_capacity_exceeded",
      "field_registry_conflict",
    ),
    revisionKey: Schema.String,
    fieldPath: Schema.String,
  },
) {}

export class StructuredQueryRejected extends Schema.TaggedError<StructuredQueryRejected>()(
  "StructuredQueryRejected",
  {
    reason: Schema.Literal(
      "empty_filters",
      "unsupported_join",
      "unsupported_aggregate",
      "mixed_entity_kind",
      "unregistered_field_operator",
      "value_type_mismatch",
      "invalid_range_value",
      "invalid_cursor",
      "cursor_query_mismatch",
    ),
    fieldPath: Schema.String,
    message: Schema.String,
  },
) {}

export class StructuredQueryCapacityExceeded extends Schema.TaggedError<StructuredQueryCapacityExceeded>()(
  "StructuredQueryCapacityExceeded",
  {
    resource: Schema.Literal(
      "filters",
      "in_values",
      "filter_terms",
      "page_size",
      "index_candidates",
      "resolved_candidates",
      "field_registry",
    ),
    limit: Schema.Number,
    observedAtLeast: Schema.Number,
  },
) {}

const canonicalJson = (value: unknown): string => {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

export const normalizeStructuredValue = (
  value: StructuredValue,
): StructuredValue => {
  switch (value.type) {
    case "string":
      return { type: "string", value: value.value.trim().normalize("NFC") };
    case "number":
      return {
        type: "number",
        value: Object.is(value.value, -0) ? 0 : value.value,
      };
    case "boolean":
      return value;
    case "timestamp":
      return value;
  }
};

export const structuredValueHash = (value: StructuredValue): string =>
  `sha256:${sha256Hex(canonicalJson(normalizeStructuredValue(value)))}`;

export const structuredCanonicalJson = canonicalJson;
