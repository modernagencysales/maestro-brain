import * as Effect from "effect/Effect";

import {
  type StructuredLedgerDatabaseReader,
  StructuredLedgerDatabaseReader as StructuredLedgerDatabaseReaderTag,
} from "../integrations/structuredLedgerDatabase";
import {
  type StructuredFact,
  StructuredOriginIntegrityFailure,
  StructuredQueryCapacityExceeded,
  type StructuredValue,
  structuredCanonicalJson,
  structuredValueHash,
} from "../integrations/structuredLedgerSchemas";
import { sha256Hex } from "../shared/sha256";
import {
  encodeStructuredQueryCursor,
  planStructuredQuery,
  STRUCTURED_QUERY_LIMITS,
  type StructuredFieldRegistration,
  type StructuredIndexScan,
  type StructuredQueryArgs,
  type StructuredQueryCandidate,
  type StructuredQueryResult,
} from "./structuredQueryPlanner";
import type { StructuredSourceFieldRow } from "../tables/structuredSourceFields";

type StructuredFieldRow = typeof StructuredSourceFieldRow.Type;

type CandidateSeed = {
  readonly key: string;
  readonly entityKey: string;
  readonly revisionKey: string;
  readonly observationKey: string;
  readonly routeKey: string;
  readonly representative: StructuredFieldRow;
};

const candidateKey = (row: StructuredFieldRow): string =>
  [
    row.structuredEntityKey,
    row.structuredRevisionKey,
    row.structuredObservationKey,
    row.structuredRouteKey,
  ].join(":");

const capacity = (
  resource: StructuredQueryCapacityExceeded["resource"],
  limit: number,
  observedAtLeast: number,
) => new StructuredQueryCapacityExceeded({ resource, limit, observedAtLeast });

const integrity = (
  row: StructuredFieldRow,
  reason: StructuredOriginIntegrityFailure["reason"],
) =>
  new StructuredOriginIntegrityFailure({
    reason,
    revisionKey: row.structuredRevisionKey,
    fieldPath: row.fieldPath,
  });

const factFromRow = (row: StructuredFieldRow): StructuredFact => {
  const origin = {
    kind: "structured" as const,
    organizationKey: row.organizationKey,
    workspaceId: row.workspaceId,
    brainKey: row.brainKey,
    structuredEntityKey: row.structuredEntityKey,
    structuredRevisionKey: row.structuredRevisionKey,
    structuredObservationKey: row.structuredObservationKey,
    structuredRouteKey: row.structuredRouteKey,
    fieldPath: row.fieldPath,
    valueHash: row.valueHash,
  };
  return {
    origin,
    entity: {
      structuredEntityKey: row.structuredEntityKey,
      providerKey: row.providerKey,
      entityKind: row.entityKind,
      providerEntityId: row.providerEntityId,
      incarnation: row.incarnation,
    },
    fieldPath: row.fieldPath,
    value: row.value,
    revision: {
      structuredRevisionKey: row.structuredRevisionKey,
      providerRevision: row.providerRevision,
      observationOrder: row.observationOrder,
      incarnation: row.incarnation,
    },
    valueHash: row.valueHash,
    authority: row.authority,
    sourceModifiedAt: row.sourceModifiedAt,
    observedAt: row.observedAt,
    locator: row.locator,
  };
};

const eligibilityManifestHash = (row: StructuredFieldRow): string =>
  `sha256:${sha256Hex(structuredCanonicalJson(row.eligibilityManifest))}`;

const matchesScan = (row: StructuredFieldRow, scan: StructuredIndexScan) => {
  if (row.value.type !== scan.valueType) return false;
  if (scan.filter.op === "eq" || scan.filter.op === "in")
    return scan.filter.values.some(
      (value) =>
        structuredCanonicalJson(value) === structuredCanonicalJson(row.value),
    );
  const boundary = scan.filter.values[0];
  if (
    boundary === undefined ||
    (row.value.type !== "number" && row.value.type !== "timestamp") ||
    boundary.type !== row.value.type
  )
    return false;
  return scan.filter.op === "gte"
    ? row.value.value >= boundary.value
    : row.value.value <= boundary.value;
};

const executeIndexScan = (
  reader: StructuredLedgerDatabaseReader,
  context: { readonly organizationKey: string; readonly workspaceId: string },
  brainKey: string,
  scan: StructuredIndexScan,
  value: StructuredValue,
  take: number,
): Effect.Effect<readonly StructuredFieldRow[]> => {
  const queryString = (scalar: string) =>
    reader
      .table("structuredSourceFields")
      .index("by_brain_entity_field_string_value_entity", (query) => {
        const scoped = query
          .eq("organizationKey", context.organizationKey)
          .eq("workspaceId", context.workspaceId)
          .eq("brainKey", brainKey)
          .eq("entityKind", scan.filter.entityKind)
          .eq("fieldPath", scan.filter.fieldPath);
        if (scan.filter.op === "gte") return scoped.gte("stringValue", scalar);
        if (scan.filter.op === "lte") return scoped.lte("stringValue", scalar);
        return scoped.eq("stringValue", scalar);
      })
      .take(take)
      .pipe(Effect.orDie);
  const queryNumber = (scalar: number) =>
    reader
      .table("structuredSourceFields")
      .index("by_brain_entity_field_number_value_entity", (query) => {
        const scoped = query
          .eq("organizationKey", context.organizationKey)
          .eq("workspaceId", context.workspaceId)
          .eq("brainKey", brainKey)
          .eq("entityKind", scan.filter.entityKind)
          .eq("fieldPath", scan.filter.fieldPath);
        if (scan.filter.op === "gte") return scoped.gte("numberValue", scalar);
        if (scan.filter.op === "lte") return scoped.lte("numberValue", scalar);
        return scoped.eq("numberValue", scalar);
      })
      .take(take)
      .pipe(Effect.orDie);
  const queryBoolean = (scalar: boolean) =>
    reader
      .table("structuredSourceFields")
      .index("by_brain_entity_field_boolean_value_entity", (query) =>
        query
          .eq("organizationKey", context.organizationKey)
          .eq("workspaceId", context.workspaceId)
          .eq("brainKey", brainKey)
          .eq("entityKind", scan.filter.entityKind)
          .eq("fieldPath", scan.filter.fieldPath)
          .eq("booleanValue", scalar),
      )
      .take(take)
      .pipe(Effect.orDie);
  const queryTimestamp = (scalar: number) =>
    reader
      .table("structuredSourceFields")
      .index("by_brain_entity_field_timestamp_value_entity", (query) => {
        const scoped = query
          .eq("organizationKey", context.organizationKey)
          .eq("workspaceId", context.workspaceId)
          .eq("brainKey", brainKey)
          .eq("entityKind", scan.filter.entityKind)
          .eq("fieldPath", scan.filter.fieldPath);
        if (scan.filter.op === "gte")
          return scoped.gte("timestampValue", scalar);
        if (scan.filter.op === "lte")
          return scoped.lte("timestampValue", scalar);
        return scoped.eq("timestampValue", scalar);
      })
      .take(take)
      .pipe(Effect.orDie);

  switch (scan.index) {
    case "by_brain_entity_field_string_value_entity":
      return value.type === "string"
        ? queryString(value.value)
        : Effect.succeed([]);
    case "by_brain_entity_field_number_value_entity":
      return value.type === "number"
        ? queryNumber(value.value)
        : Effect.succeed([]);
    case "by_brain_entity_field_boolean_value_entity":
      return value.type === "boolean"
        ? queryBoolean(value.value)
        : Effect.succeed([]);
    case "by_brain_entity_field_timestamp_value_entity":
      return value.type === "timestamp"
        ? queryTimestamp(value.value)
        : Effect.succeed([]);
  }
};

export const executeStructuredQuery = (
  context: { readonly organizationKey: string; readonly workspaceId: string },
  registry: readonly StructuredFieldRegistration[],
  args: StructuredQueryArgs,
): Effect.Effect<
  StructuredQueryResult,
  | StructuredQueryCapacityExceeded
  | StructuredOriginIntegrityFailure
  | import("../integrations/structuredLedgerSchemas").StructuredQueryRejected,
  StructuredLedgerDatabaseReader
> =>
  Effect.gen(function* () {
    const plan = yield* planStructuredQuery(registry, args);
    const reader = yield* StructuredLedgerDatabaseReaderTag;
    const candidatesByScan: Array<Map<string, CandidateSeed>> = [];
    for (const scan of plan.scans) {
      const pages = yield* Effect.all(
        scan.filter.values.map((value) =>
          executeIndexScan(
            reader,
            context,
            args.brainKey,
            scan,
            value,
            plan.take,
          ),
        ),
      );
      const candidates = new Map<string, CandidateSeed>();
      for (const row of pages.flat()) {
        if (!matchesScan(row, scan)) continue;
        const key = candidateKey(row);
        candidates.set(key, {
          key,
          entityKey: row.structuredEntityKey,
          revisionKey: row.structuredRevisionKey,
          observationKey: row.structuredObservationKey,
          routeKey: row.structuredRouteKey,
          representative: row,
        });
        if (candidates.size > STRUCTURED_QUERY_LIMITS.indexCandidates)
          return yield* capacity(
            "index_candidates",
            STRUCTURED_QUERY_LIMITS.indexCandidates,
            candidates.size,
          );
      }
      candidatesByScan.push(candidates);
    }

    const firstScan = candidatesByScan[0] ?? new Map<string, CandidateSeed>();
    const intersection = [...firstScan.values()].filter((candidate) =>
      candidatesByScan.every((candidates) => candidates.has(candidate.key)),
    );
    const current: CandidateSeed[] = [];
    for (const candidate of intersection) {
      const routes = yield* reader
        .table("structuredSourceRoutes")
        .index("by_organization_route_key", (query) =>
          query
            .eq("organizationKey", context.organizationKey)
            .eq("structuredRouteKey", candidate.routeKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      const route = routes[0];
      if (
        routes.length === 1 &&
        route !== undefined &&
        route.workspaceId === context.workspaceId &&
        route.brainKey === args.brainKey &&
        route.routeState === "active" &&
        route.currentRevisionKey === candidate.revisionKey &&
        route.currentObservationKey === candidate.observationKey &&
        route.eligibilityManifestHash ===
          eligibilityManifestHash(candidate.representative)
      )
        current.push(candidate);
      else if (
        routes.length === 1 &&
        route !== undefined &&
        route.currentRevisionKey === candidate.revisionKey &&
        route.currentObservationKey === candidate.observationKey
      )
        return yield* integrity(
          candidate.representative,
          "eligibility_manifest_mismatch",
        );
    }
    if (current.length > STRUCTURED_QUERY_LIMITS.resolvedCandidates)
      return yield* capacity(
        "resolved_candidates",
        STRUCTURED_QUERY_LIMITS.resolvedCandidates,
        current.length,
      );
    current.sort((left, right) => left.key.localeCompare(right.key));
    const afterCandidateKey = plan.afterCandidateKey;
    const afterCursor =
      afterCandidateKey === null
        ? current
        : current.filter(({ key }) => key > afterCandidateKey);
    const page = afterCursor.slice(0, plan.pageSize + 1);
    const hasMore = page.length > plan.pageSize;
    const selected = hasMore ? page.slice(0, plan.pageSize) : page;
    const candidates: StructuredQueryCandidate[] = [];
    for (const candidate of selected) {
      const rows = yield* reader
        .table("structuredSourceFields")
        .index("by_revision_observation_field_path", (query) =>
          query
            .eq("organizationKey", context.organizationKey)
            .eq("structuredRevisionKey", candidate.revisionKey)
            .eq("structuredObservationKey", candidate.observationKey),
        )
        .take(65)
        .pipe(Effect.orDie);
      if (rows.length > 64)
        return yield* integrity(
          candidate.representative,
          "field_capacity_exceeded",
        );
      const mismatched = rows.find(
        (row) =>
          row.structuredRouteKey !== candidate.routeKey ||
          structuredValueHash(row.value) !== row.valueHash,
      );
      if (mismatched !== undefined)
        return yield* integrity(
          mismatched,
          mismatched.structuredRouteKey !== candidate.routeKey
            ? "identity_mismatch"
            : "value_hash_mismatch",
        );
      const facts = rows
        .map(factFromRow)
        .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
      const representative = candidate.representative;
      candidates.push({
        entity: {
          structuredEntityKey: representative.structuredEntityKey,
          providerKey: representative.providerKey,
          entityKind: representative.entityKind,
          providerEntityId: representative.providerEntityId,
          incarnation: representative.incarnation,
        },
        revision: {
          structuredRevisionKey: representative.structuredRevisionKey,
          providerRevision: representative.providerRevision,
          observationOrder: representative.observationOrder,
          incarnation: representative.incarnation,
        },
        facts,
      });
    }
    const last = selected.at(-1);
    const nextCursor =
      hasMore && last !== undefined
        ? encodeStructuredQueryCursor(plan.queryHash, last.key)
        : null;
    return {
      schemaVersion: "1",
      candidates,
      nextCursor,
      candidateManifestHash: `sha256:${sha256Hex(
        structuredCanonicalJson(candidates),
      )}`,
    };
  });
