import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { DatabaseReader } from "../_generated/services";
import { Forbidden } from "../errors";
import {
  type StructuredLedgerDatabaseReader,
  StructuredLedgerDatabaseReader as StructuredLedgerDatabaseReaderTag,
} from "../integrations/structuredLedgerDatabase";
import {
  StructuredOriginIntegrityFailure,
  StructuredQueryCapacityExceeded,
} from "../integrations/structuredLedgerSchemas";
import { requireBrainAccess } from "./pages.impl";
import structuredQuery from "./structuredQuery.spec";
import {
  STRUCTURED_QUERY_LIMITS,
  type StructuredFieldIndex,
  type StructuredFieldRegistration,
  type StructuredQueryOperator,
} from "./structuredQueryPlanner";
import { executeStructuredQuery } from "./structuredQueryRepository";

const STRUCTURED_FIELD_REGISTRY_LIMIT = STRUCTURED_QUERY_LIMITS.indexCandidates;

const expectedIndex: Readonly<
  Record<StructuredFieldRegistration["valueType"], StructuredFieldIndex>
> = {
  string: "by_brain_entity_field_string_value_entity",
  number: "by_brain_entity_field_number_value_entity",
  boolean: "by_brain_entity_field_boolean_value_entity",
  timestamp: "by_brain_entity_field_timestamp_value_entity",
};

const registryIntegrity = (fieldPath: string) =>
  new StructuredOriginIntegrityFailure({
    reason: "field_registry_conflict",
    revisionKey: "structured-query-field-registry",
    fieldPath,
  });

const loadApprovedRegistry = (
  reader: StructuredLedgerDatabaseReader,
  context: {
    readonly organizationKey: string;
    readonly workspaceId: string;
    readonly brainKey: string;
  },
) =>
  Effect.gen(function* () {
    const rows = yield* reader
      .table("structuredQueryFieldRegistrations")
      .index("by_brain_state_entity_field", (query) =>
        query
          .eq("organizationKey", context.organizationKey)
          .eq("workspaceId", context.workspaceId)
          .eq("brainKey", context.brainKey)
          .eq("state", "active"),
      )
      .take(STRUCTURED_FIELD_REGISTRY_LIMIT + 1)
      .pipe(Effect.orDie);
    if (rows.length > STRUCTURED_FIELD_REGISTRY_LIMIT)
      return yield* new StructuredQueryCapacityExceeded({
        resource: "field_registry",
        limit: STRUCTURED_FIELD_REGISTRY_LIMIT,
        observedAtLeast: rows.length,
      });

    const registrations: StructuredFieldRegistration[] = [];
    const registeredFields = new Set<string>();
    for (const row of rows) {
      const fieldKey = `${row.entityKind}:${row.fieldPath}`;
      const operators = [...row.operators] as StructuredQueryOperator[];
      if (
        registeredFields.has(fieldKey) ||
        new Set(operators).size !== operators.length ||
        row.physicalIndex !== expectedIndex[row.valueType]
      )
        return yield* registryIntegrity(row.fieldPath);
      registeredFields.add(fieldKey);
      registrations.push({
        entityKind: row.entityKind,
        fieldPath: row.fieldPath,
        valueType: row.valueType,
        operators,
        index: row.physicalIndex,
        fieldMappingPolicyKey: row.fieldMappingPolicyKey,
        fieldMappingPolicyGeneration: row.fieldMappingPolicyGeneration,
      });
    }
    return registrations;
  });

const queryImpl = FunctionImpl.make(
  databaseSchema,
  structuredQuery,
  "query",
  (args) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(args.brainKey, "viewer").pipe(
        Effect.catchTags({
          BrainNotFound: () =>
            Effect.fail(new Forbidden({ reason: "Brain is unavailable." })),
          LifecycleRevoked: () =>
            Effect.fail(new Forbidden({ reason: "Brain is unavailable." })),
        }),
      );
      const generatedReader = yield* DatabaseReader;
      const reader =
        generatedReader as unknown as StructuredLedgerDatabaseReader;
      const context = {
        organizationKey: brain.organizationKey,
        workspaceId: String(brain.workspaceId),
        brainKey: brain.brainKey,
      };
      const registry = yield* loadApprovedRegistry(reader, context);
      return yield* executeStructuredQuery(context, registry, args).pipe(
        Effect.provideService(StructuredLedgerDatabaseReaderTag, reader),
      );
    }),
);

export default GroupImpl.make(databaseSchema, structuredQuery).pipe(
  Layer.provide(queryImpl),
  GroupImpl.finalize,
);
