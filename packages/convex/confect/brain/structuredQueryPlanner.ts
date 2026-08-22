import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { sha256Hex } from "../shared/sha256";
import {
  NonEmptyStructuredString,
  normalizeStructuredValue,
  StructuredDigest,
  StructuredEntityReference,
  StructuredFact,
  StructuredPositiveInteger,
  StructuredQueryCapacityExceeded,
  StructuredQueryRejected,
  StructuredRevisionReference,
  StructuredValue,
  type StructuredValue as StructuredValueType,
  type StructuredValueType as StructuredValueTag,
  structuredCanonicalJson,
} from "../integrations/structuredLedgerSchemas";

export const STRUCTURED_QUERY_LIMITS = {
  filters: 8,
  inValues: 8,
  filterTerms: 8,
  pageSize: 10,
  indexCandidates: 64,
  resolvedCandidates: 64,
} as const;

export const StructuredQueryOperator = Schema.Literal("eq", "in", "gte", "lte");
export type StructuredQueryOperator = typeof StructuredQueryOperator.Type;

export const StructuredQueryFilter = Schema.Struct({
  entityKind: NonEmptyStructuredString,
  fieldPath: NonEmptyStructuredString,
  op: StructuredQueryOperator,
  value: Schema.Union(
    StructuredValue,
    Schema.Array(StructuredValue).pipe(Schema.maxItems(256)),
  ),
});
export type StructuredQueryFilter = typeof StructuredQueryFilter.Type;

export const StructuredQueryArgs = Schema.Struct({
  brainKey: NonEmptyStructuredString,
  filters: Schema.Array(StructuredQueryFilter).pipe(Schema.maxItems(256)),
  pageSize: StructuredPositiveInteger,
  cursor: Schema.NullOr(Schema.String),
  join: Schema.optional(Schema.Unknown),
  aggregate: Schema.optional(Schema.Unknown),
});
export type StructuredQueryArgs = typeof StructuredQueryArgs.Type;

export const StructuredFieldIndex = Schema.Literal(
  "by_brain_entity_field_string_value_entity",
  "by_brain_entity_field_number_value_entity",
  "by_brain_entity_field_boolean_value_entity",
  "by_brain_entity_field_timestamp_value_entity",
);
export type StructuredFieldIndex = typeof StructuredFieldIndex.Type;

export type StructuredFieldRegistration = {
  readonly entityKind: string;
  readonly fieldPath: string;
  readonly valueType: StructuredValueTag;
  readonly operators: readonly StructuredQueryOperator[];
  readonly index: StructuredFieldIndex;
  readonly fieldMappingPolicyKey: string;
  readonly fieldMappingPolicyGeneration: number;
};

export type NormalizedStructuredFilter = {
  readonly entityKind: string;
  readonly fieldPath: string;
  readonly op: StructuredQueryOperator;
  readonly values: readonly StructuredValueType[];
};

export type StructuredIndexScan = {
  readonly index: StructuredFieldIndex;
  readonly filter: NormalizedStructuredFilter;
  readonly valueType: StructuredValueTag;
  readonly fieldMappingPolicyKey: string;
  readonly fieldMappingPolicyGeneration: number;
};

export type StructuredQueryPlan = {
  readonly entityKind: string;
  readonly scans: readonly StructuredIndexScan[];
  readonly pageSize: number;
  readonly take: number;
  readonly queryHash: string;
  readonly afterCandidateKey: string | null;
};

export const StructuredQueryCandidate = Schema.Struct({
  entity: StructuredEntityReference,
  revision: StructuredRevisionReference,
  facts: Schema.Array(StructuredFact).pipe(Schema.maxItems(64)),
});
export type StructuredQueryCandidate = typeof StructuredQueryCandidate.Type;

export const StructuredQueryResult = Schema.Struct({
  schemaVersion: Schema.Literal("1"),
  candidates: Schema.Array(StructuredQueryCandidate).pipe(
    Schema.maxItems(STRUCTURED_QUERY_LIMITS.pageSize),
  ),
  nextCursor: Schema.NullOr(Schema.String),
  candidateManifestHash: StructuredDigest,
});
export type StructuredQueryResult = typeof StructuredQueryResult.Type;

const expectedIndex: Readonly<
  Record<StructuredValueTag, StructuredFieldIndex>
> = {
  string: "by_brain_entity_field_string_value_entity",
  number: "by_brain_entity_field_number_value_entity",
  boolean: "by_brain_entity_field_boolean_value_entity",
  timestamp: "by_brain_entity_field_timestamp_value_entity",
};

const rejected = (
  reason: StructuredQueryRejected["reason"],
  fieldPath: string,
  message: string,
) => new StructuredQueryRejected({ reason, fieldPath, message });

const capacity = (
  resource: StructuredQueryCapacityExceeded["resource"],
  limit: number,
  observedAtLeast: number,
) => new StructuredQueryCapacityExceeded({ resource, limit, observedAtLeast });

const normalizeFilterValues = (
  filter: StructuredQueryFilter,
): readonly StructuredValueType[] => {
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  return values.map(normalizeStructuredValue);
};

const toHex = (value: string): string =>
  [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (value: string): string | null => {
  if (value.length % 2 !== 0 || !/^[a-f0-9]*$/.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
};

type StructuredCursorPayload = {
  readonly queryHash: string;
  readonly afterCandidateKey: string;
};

export const encodeStructuredQueryCursor = (
  queryHash: string,
  afterCandidateKey: string,
): string =>
  `sqc1_${toHex(structuredCanonicalJson({ queryHash, afterCandidateKey }))}`;

const decodeStructuredQueryCursor = (
  cursor: string,
): StructuredCursorPayload | null => {
  if (!cursor.startsWith("sqc1_")) return null;
  const decoded = fromHex(cursor.slice("sqc1_".length));
  if (decoded === null) return null;
  try {
    const value = JSON.parse(decoded) as Partial<StructuredCursorPayload>;
    return typeof value.queryHash === "string" &&
      typeof value.afterCandidateKey === "string" &&
      value.afterCandidateKey.length > 0
      ? {
          queryHash: value.queryHash,
          afterCandidateKey: value.afterCandidateKey,
        }
      : null;
  } catch {
    return null;
  }
};

const canonicalQueryHash = (
  brainKey: string,
  filters: readonly NormalizedStructuredFilter[],
  registrations: readonly StructuredFieldRegistration[],
): string => {
  const canonicalFilters = [...filters].sort((left, right) =>
    structuredCanonicalJson(left).localeCompare(structuredCanonicalJson(right)),
  );
  return `sha256:${sha256Hex(
    structuredCanonicalJson({
      brainKey,
      filters: canonicalFilters,
      registrations: [...registrations].sort((left, right) =>
        structuredCanonicalJson(left).localeCompare(
          structuredCanonicalJson(right),
        ),
      ),
    }),
  )}`;
};

export const planStructuredQuery = (
  registry: readonly StructuredFieldRegistration[],
  args: StructuredQueryArgs,
): Effect.Effect<
  StructuredQueryPlan,
  StructuredQueryRejected | StructuredQueryCapacityExceeded
> =>
  Effect.gen(function* () {
    if (args.join !== undefined)
      return yield* rejected(
        "unsupported_join",
        "",
        "Structured queries do not support joins.",
      );
    if (args.aggregate !== undefined)
      return yield* rejected(
        "unsupported_aggregate",
        "",
        "Structured queries do not support aggregations.",
      );
    const firstFilter = args.filters[0];
    if (firstFilter === undefined)
      return yield* rejected(
        "empty_filters",
        "filters",
        "At least one registered indexed filter is required.",
      );
    if (args.filters.length > STRUCTURED_QUERY_LIMITS.filters)
      return yield* capacity(
        "filters",
        STRUCTURED_QUERY_LIMITS.filters,
        args.filters.length,
      );
    if (
      !Number.isInteger(args.pageSize) ||
      args.pageSize <= 0 ||
      args.pageSize > STRUCTURED_QUERY_LIMITS.pageSize
    )
      return yield* capacity(
        "page_size",
        STRUCTURED_QUERY_LIMITS.pageSize,
        args.pageSize,
      );
    const entityKinds = new Set(
      args.filters.map(({ entityKind }) => entityKind),
    );
    if (entityKinds.size !== 1)
      return yield* rejected(
        "mixed_entity_kind",
        "filters.entityKind",
        "A conjunction may target only one entity kind; cross-entity joins are unsupported.",
      );

    let filterTerms = 0;
    const scans: StructuredIndexScan[] = [];
    const normalizedFilters: NormalizedStructuredFilter[] = [];
    for (const filter of args.filters) {
      const values = normalizeFilterValues(filter);
      if (filter.op === "in") {
        if (values.length === 0)
          return yield* rejected(
            "value_type_mismatch",
            filter.fieldPath,
            "An in filter requires at least one typed value.",
          );
        if (values.length > STRUCTURED_QUERY_LIMITS.inValues)
          return yield* capacity(
            "in_values",
            STRUCTURED_QUERY_LIMITS.inValues,
            values.length,
          );
      } else if (Array.isArray(filter.value))
        return yield* rejected(
          "value_type_mismatch",
          filter.fieldPath,
          `${filter.op} requires exactly one typed value.`,
        );
      filterTerms += values.length;
      if (filterTerms > STRUCTURED_QUERY_LIMITS.filterTerms)
        return yield* capacity(
          "filter_terms",
          STRUCTURED_QUERY_LIMITS.filterTerms,
          filterTerms,
        );
      const registration = registry.find(
        (entry) =>
          entry.entityKind === filter.entityKind &&
          entry.fieldPath === filter.fieldPath &&
          entry.operators.includes(filter.op),
      );
      if (registration === undefined)
        return yield* rejected(
          "unregistered_field_operator",
          filter.fieldPath,
          "The field/operator pair is not in the approved structured eligibility manifest.",
        );
      if (
        values.some(({ type }) => type !== registration.valueType) ||
        registration.index !== expectedIndex[registration.valueType]
      )
        return yield* rejected(
          "value_type_mismatch",
          filter.fieldPath,
          "The filter value type does not match its declared physical index.",
        );
      if (
        (filter.op === "gte" || filter.op === "lte") &&
        registration.valueType !== "number" &&
        registration.valueType !== "timestamp"
      )
        return yield* rejected(
          "invalid_range_value",
          filter.fieldPath,
          "Range filters require a number or timestamp registration.",
        );
      const normalized = {
        entityKind: filter.entityKind,
        fieldPath: filter.fieldPath,
        op: filter.op,
        values,
      } satisfies NormalizedStructuredFilter;
      normalizedFilters.push(normalized);
      scans.push({
        index: registration.index,
        filter: normalized,
        valueType: registration.valueType,
        fieldMappingPolicyKey: registration.fieldMappingPolicyKey,
        fieldMappingPolicyGeneration: registration.fieldMappingPolicyGeneration,
      });
    }

    const queryHash = canonicalQueryHash(
      args.brainKey,
      normalizedFilters,
      registry,
    );
    let afterCandidateKey: string | null = null;
    if (args.cursor !== null) {
      const cursor = decodeStructuredQueryCursor(args.cursor);
      if (cursor === null)
        return yield* rejected(
          "invalid_cursor",
          "cursor",
          "The structured query cursor is malformed.",
        );
      if (cursor.queryHash !== queryHash)
        return yield* rejected(
          "cursor_query_mismatch",
          "cursor",
          "The cursor belongs to a different structured query.",
        );
      afterCandidateKey = cursor.afterCandidateKey;
    }
    return {
      entityKind: firstFilter.entityKind,
      scans,
      pageSize: args.pageSize,
      take: STRUCTURED_QUERY_LIMITS.indexCandidates + 1,
      queryHash,
      afterCandidateKey,
    };
  });
