import * as Effect from "effect/Effect";

import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import {
  StructuredLedgerDatabaseReader,
  StructuredLedgerDatabaseWriter,
} from "./structuredLedgerDatabase";
import {
  type CommitStructuredObservationArgs,
  type CommitStructuredObservationResult,
  normalizeStructuredValue,
  type StructuredCanonicalObservation,
  type StructuredFact,
  type StructuredInputField,
  StructuredOriginIntegrityFailure,
  type StructuredOrigin,
  type StructuredValue,
  structuredCanonicalJson,
  structuredValueHash,
} from "./structuredLedgerSchemas";

const MAX_FIELDS_PER_REVISION = 64;

const invalid = (field: string, message: string) =>
  new ValidationFailed({ field, message });

const stableKey = (prefix: string, value: unknown): string =>
  `${prefix}_${sha256Hex(structuredCanonicalJson(value))}`;

const digest = (value: unknown): string =>
  `sha256:${sha256Hex(structuredCanonicalJson(value))}`;

type NormalizedField = {
  readonly fieldPath: string;
  readonly value: StructuredValue;
  readonly valueHash: string;
  readonly authority: StructuredInputField["authority"];
};

const normalizeFields = (
  fields: readonly StructuredInputField[],
): readonly NormalizedField[] =>
  fields
    .map((field) => {
      const value = normalizeStructuredValue(field.value);
      return {
        fieldPath: field.fieldPath,
        value,
        valueHash: structuredValueHash(value),
        authority: field.authority,
      };
    })
    .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));

const fieldManifestHash = (fields: readonly NormalizedField[]): string =>
  digest(
    fields.map(({ fieldPath, value, valueHash, authority }) => ({
      fieldPath,
      value,
      valueHash,
      authority,
    })),
  );

const scalarColumns = (value: StructuredValue) => ({
  stringValue: value.type === "string" ? value.value : null,
  numberValue: value.type === "number" ? value.value : null,
  booleanValue: value.type === "boolean" ? value.value : null,
  timestampValue: value.type === "timestamp" ? value.value : null,
});

const validateObservation = (
  observation: StructuredCanonicalObservation,
  fields: readonly NormalizedField[],
): ValidationFailed | null => {
  if (fields.length > MAX_FIELDS_PER_REVISION)
    return invalid(
      "observation.fields",
      `A structured revision may contain at most ${MAX_FIELDS_PER_REVISION} typed fields.`,
    );
  if (observation.tombstone !== (fields.length === 0))
    return invalid(
      "observation.fields",
      "A tombstone has no typed fields and a live revision has at least one.",
    );
  if (
    fields.some(
      (field, index) =>
        index > 0 && field.fieldPath === fields[index - 1]?.fieldPath,
    )
  )
    return invalid(
      "observation.fields",
      "Typed field paths must be unique within one immutable revision.",
    );
  if (
    fields.some(
      ({ value }) => value.type === "number" && !Number.isFinite(value.value),
    )
  )
    return invalid(
      "observation.fields.value",
      "Structured numeric values must be finite.",
    );
  const manifest = observation.eligibilityManifest;
  if (
    manifest.connectorScope.key !== observation.connectorScopeKey ||
    manifest.allowlist.eligibilityGeneration !==
      observation.allowlistGeneration ||
    manifest.connection.key !== observation.connectionKey ||
    manifest.connection.eligibilityGeneration !==
      observation.connectionGeneration ||
    manifest.fieldMappingPolicy.key !== observation.fieldMappingPolicyKey ||
    manifest.fieldMappingPolicy.eligibilityGeneration !==
      observation.fieldMappingPolicyGeneration
  )
    return invalid(
      "observation.eligibilityManifest",
      "Eligibility fences must match the observation scope and configuration generations.",
    );
  return null;
};

const originFor = (input: {
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly entityKey: string;
  readonly revisionKey: string;
  readonly observationKey: string;
  readonly routeKey: string;
  readonly field: NormalizedField;
}): StructuredOrigin => ({
  kind: "structured",
  organizationKey: input.organizationKey,
  workspaceId: input.workspaceId,
  brainKey: input.brainKey,
  structuredEntityKey: input.entityKey,
  structuredRevisionKey: input.revisionKey,
  structuredObservationKey: input.observationKey,
  structuredRouteKey: input.routeKey,
  fieldPath: input.field.fieldPath,
  valueHash: input.field.valueHash,
});

const acceptedClassification = (classification: string): boolean =>
  classification === "created" ||
  classification === "newer" ||
  classification === "tombstone" ||
  classification === "recreated";

export const commitStructuredObservation = (
  input: CommitStructuredObservationArgs,
): Effect.Effect<
  CommitStructuredObservationResult,
  ValidationFailed,
  StructuredLedgerDatabaseReader | StructuredLedgerDatabaseWriter
> =>
  Effect.gen(function* () {
    const observation = input.observation;
    const fields = normalizeFields(observation.fields);
    const validationFailure = validateObservation(observation, fields);
    if (validationFailure !== null) return yield* validationFailure;

    const entityKey = stableKey("sent", {
      organizationKey: input.organizationKey,
      providerKey: observation.providerKey,
      entityKind: observation.entityKind,
      providerEntityId: observation.providerEntityId,
    });
    const routeKey = stableKey("sroute", {
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      connectorScopeKey: observation.connectorScopeKey,
      structuredEntityKey: entityKey,
    });
    const fieldsHash = fieldManifestHash(fields);
    const eligibilityManifestHash = digest(observation.eligibilityManifest);
    const observationKey = stableKey("sobs", {
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      structuredRouteKey: routeKey,
      providerRevision: observation.providerRevision,
      observationOrder: observation.observationOrder,
      tombstone: observation.tombstone,
      fieldManifestHash: fieldsHash,
      eligibilityManifestHash,
      locator: observation.locator,
    });
    const reader = yield* StructuredLedgerDatabaseReader;
    const duplicateRows = yield* reader
      .table("structuredSourceObservations")
      .index("by_organization_observation_key", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("structuredObservationKey", observationKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (duplicateRows.length > 1)
      return yield* invalid(
        "observation",
        "The structured observation identity is inconsistent.",
      );
    const duplicate = duplicateRows[0];
    if (duplicate !== undefined) {
      const duplicateRevisionKey = duplicate.structuredRevisionKey;
      const duplicateFields =
        duplicateRevisionKey === null
          ? []
          : yield* reader
              .table("structuredSourceFields")
              .index("by_revision_observation_field_path", (query) =>
                query
                  .eq("organizationKey", input.organizationKey)
                  .eq("structuredRevisionKey", duplicateRevisionKey)
                  .eq("structuredObservationKey", observationKey),
              )
              .take(MAX_FIELDS_PER_REVISION + 1)
              .pipe(Effect.orDie);
      return {
        classification: duplicate.classification,
        entityKey,
        revisionKey: duplicate.structuredRevisionKey,
        observationKey,
        routeKey:
          duplicate.structuredRevisionKey === null
            ? null
            : duplicate.structuredRouteKey,
        incarnation: duplicate.incarnation,
        fieldCount: duplicateFields.length,
        origins: duplicateFields.map((field) => ({
          kind: "structured" as const,
          organizationKey: input.organizationKey,
          workspaceId: duplicate.workspaceId,
          brainKey: duplicate.brainKey,
          structuredEntityKey: entityKey,
          structuredRevisionKey: field.structuredRevisionKey,
          structuredObservationKey: observationKey,
          structuredRouteKey: duplicate.structuredRouteKey,
          fieldPath: field.fieldPath,
          valueHash: field.valueHash,
        })),
      };
    }

    const entityRows = yield* reader
      .table("structuredSourceEntities")
      .index("by_organization_entity_key", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("structuredEntityKey", entityKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (entityRows.length > 1)
      return yield* invalid(
        "observation.providerEntityId",
        "The structured entity identity is inconsistent.",
      );
    const entity = entityRows[0] ?? null;
    const currentRevisionRows =
      entity === null
        ? []
        : yield* reader
            .table("structuredSourceRevisions")
            .index("by_organization_revision_key", (query) =>
              query
                .eq("organizationKey", input.organizationKey)
                .eq("structuredRevisionKey", entity.currentRevisionKey),
            )
            .take(2)
            .pipe(Effect.orDie);
    if (currentRevisionRows.length > 1)
      return yield* invalid(
        "observation.providerRevision",
        "The current structured revision pointer is inconsistent.",
      );
    const currentRevision = currentRevisionRows[0] ?? null;
    const expectedMatches =
      entity === null
        ? input.expectedIncarnation === null
        : input.expectedIncarnation === entity.incarnation;

    let classification: CommitStructuredObservationResult["classification"];
    if (!expectedMatches) classification = "superseded";
    else if (entity === null)
      classification = observation.tombstone ? "tombstone" : "created";
    else if (observation.observationOrder < entity.currentObservationOrder)
      classification = "stale";
    else if (observation.observationOrder === entity.currentObservationOrder) {
      classification =
        currentRevision !== null &&
        currentRevision.providerRevision === observation.providerRevision &&
        currentRevision.fieldManifestHash === fieldsHash &&
        currentRevision.tombstone === observation.tombstone
          ? "newer"
          : "conflict";
    } else if (entity.lifecycleState === "tombstoned" && !observation.tombstone)
      classification = "recreated";
    else classification = observation.tombstone ? "tombstone" : "newer";

    const nextIncarnation =
      classification === "recreated" && entity !== null
        ? entity.incarnation + 1
        : (entity?.incarnation ?? 1);
    const lifecycleState = observation.tombstone
      ? ("tombstoned" as const)
      : ("live" as const);
    const nextLifecycleGeneration =
      entity === null
        ? 1
        : entity.lifecycleState === lifecycleState
          ? entity.lifecycleGeneration
          : entity.lifecycleGeneration + 1;
    if (
      acceptedClassification(classification) &&
      observation.eligibilityManifest.entityLifecycle.eligibilityGeneration !==
        nextLifecycleGeneration
    )
      return yield* invalid(
        "observation.eligibilityManifest.entityLifecycle",
        "The entity lifecycle fence must advance exactly on tombstone or recreation.",
      );
    const writer = yield* StructuredLedgerDatabaseWriter;

    if (!acceptedClassification(classification)) {
      yield* writer
        .table("structuredSourceObservations")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          workspaceId: input.workspaceId,
          brainKey: input.brainKey,
          providerKey: observation.providerKey,
          entityKind: observation.entityKind,
          providerEntityId: observation.providerEntityId,
          structuredEntityKey: entityKey,
          structuredObservationKey: observationKey,
          structuredRouteKey: routeKey,
          structuredRevisionKey: null,
          providerRevision: observation.providerRevision,
          observationOrder: observation.observationOrder,
          connectorScopeKey: observation.connectorScopeKey,
          connectionKey: observation.connectionKey,
          connectionGeneration: observation.connectionGeneration,
          allowlistGeneration: observation.allowlistGeneration,
          fieldMappingPolicyKey: observation.fieldMappingPolicyKey,
          fieldMappingPolicyGeneration:
            observation.fieldMappingPolicyGeneration,
          fieldManifestHash: fieldsHash,
          eligibilityManifestHash,
          eligibilityManifest: observation.eligibilityManifest,
          sourceModifiedAt: observation.sourceModifiedAt,
          observedAt: observation.observedAt,
          locator: observation.locator,
          tombstone: observation.tombstone,
          classification,
          incarnation: nextIncarnation,
          fieldCount: 0,
          recordedAt: observation.observedAt,
        })
        .pipe(Effect.orDie);
      return {
        classification,
        entityKey,
        revisionKey: null,
        observationKey,
        routeKey: null,
        incarnation: nextIncarnation,
        fieldCount: 0,
        origins: [],
      };
    }

    const revisionKey = stableKey("srev", {
      organizationKey: input.organizationKey,
      structuredEntityKey: entityKey,
      providerRevision: observation.providerRevision,
      observationOrder: observation.observationOrder,
      incarnation: nextIncarnation,
      tombstone: observation.tombstone,
      fieldManifestHash: fieldsHash,
    });
    const revisionRows = yield* reader
      .table("structuredSourceRevisions")
      .index("by_organization_revision_key", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("structuredRevisionKey", revisionKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (revisionRows.length > 1)
      return yield* invalid(
        "observation.providerRevision",
        "The immutable structured revision identity is inconsistent.",
      );

    if (revisionRows.length === 0) {
      yield* writer
        .table("structuredSourceRevisions")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          providerKey: observation.providerKey,
          entityKind: observation.entityKind,
          providerEntityId: observation.providerEntityId,
          structuredEntityKey: entityKey,
          structuredRevisionKey: revisionKey,
          providerRevision: observation.providerRevision,
          observationOrder: observation.observationOrder,
          incarnation: nextIncarnation,
          tombstone: observation.tombstone,
          fieldManifestHash: fieldsHash,
          sourceModifiedAt: observation.sourceModifiedAt,
          firstObservedAt: observation.observedAt,
          recordedAt: observation.observedAt,
        })
        .pipe(Effect.orDie);
    }

    yield* writer
      .table("structuredSourceObservations")
      .insert({
        schemaVersion: 1,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        providerKey: observation.providerKey,
        entityKind: observation.entityKind,
        providerEntityId: observation.providerEntityId,
        structuredEntityKey: entityKey,
        structuredObservationKey: observationKey,
        structuredRouteKey: routeKey,
        structuredRevisionKey: revisionKey,
        providerRevision: observation.providerRevision,
        observationOrder: observation.observationOrder,
        connectorScopeKey: observation.connectorScopeKey,
        connectionKey: observation.connectionKey,
        connectionGeneration: observation.connectionGeneration,
        allowlistGeneration: observation.allowlistGeneration,
        fieldMappingPolicyKey: observation.fieldMappingPolicyKey,
        fieldMappingPolicyGeneration: observation.fieldMappingPolicyGeneration,
        fieldManifestHash: fieldsHash,
        eligibilityManifestHash,
        eligibilityManifest: observation.eligibilityManifest,
        sourceModifiedAt: observation.sourceModifiedAt,
        observedAt: observation.observedAt,
        locator: observation.locator,
        tombstone: observation.tombstone,
        classification,
        incarnation: nextIncarnation,
        fieldCount: fields.length,
        recordedAt: observation.observedAt,
      })
      .pipe(Effect.orDie);

    const origins = fields.map((field) =>
      originFor({
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        entityKey,
        revisionKey,
        observationKey,
        routeKey,
        field,
      }),
    );
    for (const [index, field] of fields.entries()) {
      yield* writer
        .table("structuredSourceFields")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          workspaceId: input.workspaceId,
          brainKey: input.brainKey,
          providerKey: observation.providerKey,
          entityKind: observation.entityKind,
          providerEntityId: observation.providerEntityId,
          structuredEntityKey: entityKey,
          structuredRevisionKey: revisionKey,
          structuredObservationKey: observationKey,
          structuredRouteKey: routeKey,
          structuredFieldKey: stableKey("sfld", {
            structuredObservationKey: observationKey,
            fieldPath: field.fieldPath,
            ordinal: index,
          }),
          providerRevision: observation.providerRevision,
          observationOrder: observation.observationOrder,
          incarnation: nextIncarnation,
          fieldPath: field.fieldPath,
          valueType: field.value.type,
          value: field.value,
          valueHash: field.valueHash,
          ...scalarColumns(field.value),
          authority: field.authority,
          sourceModifiedAt: observation.sourceModifiedAt,
          observedAt: observation.observedAt,
          locator: observation.locator,
          eligibilityManifest: observation.eligibilityManifest,
          recordedAt: observation.observedAt,
        })
        .pipe(Effect.orDie);
    }

    const entityValue = {
      schemaVersion: 1 as const,
      organizationKey: input.organizationKey,
      providerKey: observation.providerKey,
      entityKind: observation.entityKind,
      providerEntityId: observation.providerEntityId,
      structuredEntityKey: entityKey,
      lifecycleState,
      lifecycleGeneration: nextLifecycleGeneration,
      incarnation: nextIncarnation,
      currentRevisionKey: revisionKey,
      currentObservationKey: observationKey,
      currentObservationOrder: observation.observationOrder,
      createdAt: entity?.createdAt ?? observation.observedAt,
      updatedAt: observation.observedAt,
    };
    if (entity === null)
      yield* writer
        .table("structuredSourceEntities")
        .insert(entityValue)
        .pipe(Effect.orDie);
    else
      yield* writer
        .table("structuredSourceEntities")
        .replace(entity._id, entityValue)
        .pipe(Effect.orDie);

    const routeRows = yield* reader
      .table("structuredSourceRoutes")
      .index("by_organization_route_key", (query) =>
        query
          .eq("organizationKey", input.organizationKey)
          .eq("structuredRouteKey", routeKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (routeRows.length > 1)
      return yield* invalid(
        "observation.connectorScopeKey",
        "The structured route identity is inconsistent.",
      );
    const routeValue = {
      schemaVersion: 1 as const,
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      connectorScopeKey: observation.connectorScopeKey,
      structuredRouteKey: routeKey,
      structuredEntityKey: entityKey,
      routeState: observation.tombstone
        ? ("tombstoned" as const)
        : ("active" as const),
      currentRevisionKey: revisionKey,
      currentObservationKey: observationKey,
      currentObservationOrder: observation.observationOrder,
      incarnation: nextIncarnation,
      eligibilityManifestHash,
      eligibilityManifest: observation.eligibilityManifest,
      updatedAt: observation.observedAt,
    };
    const route = routeRows[0];
    if (route === undefined)
      yield* writer
        .table("structuredSourceRoutes")
        .insert(routeValue)
        .pipe(Effect.orDie);
    else
      yield* writer
        .table("structuredSourceRoutes")
        .replace(route._id, routeValue)
        .pipe(Effect.orDie);

    return {
      classification,
      entityKey,
      revisionKey,
      observationKey,
      routeKey,
      incarnation: nextIncarnation,
      fieldCount: fields.length,
      origins,
    };
  });

const integrityFailure = (
  origin: StructuredOrigin,
  reason: StructuredOriginIntegrityFailure["reason"],
) =>
  new StructuredOriginIntegrityFailure({
    reason,
    revisionKey: origin.structuredRevisionKey,
    fieldPath: origin.fieldPath,
  });

export const resolveStructuredOrigin = (
  origin: StructuredOrigin,
): Effect.Effect<
  StructuredFact,
  StructuredOriginIntegrityFailure,
  StructuredLedgerDatabaseReader
> =>
  Effect.gen(function* () {
    const reader = yield* StructuredLedgerDatabaseReader;
    const [entities, revisions, observations, fields] = yield* Effect.all([
      reader
        .table("structuredSourceEntities")
        .index("by_organization_entity_key", (query) =>
          query
            .eq("organizationKey", origin.organizationKey)
            .eq("structuredEntityKey", origin.structuredEntityKey),
        )
        .take(2)
        .pipe(Effect.orDie),
      reader
        .table("structuredSourceRevisions")
        .index("by_organization_revision_key", (query) =>
          query
            .eq("organizationKey", origin.organizationKey)
            .eq("structuredRevisionKey", origin.structuredRevisionKey),
        )
        .take(2)
        .pipe(Effect.orDie),
      reader
        .table("structuredSourceObservations")
        .index("by_organization_observation_key", (query) =>
          query
            .eq("organizationKey", origin.organizationKey)
            .eq("structuredObservationKey", origin.structuredObservationKey),
        )
        .take(2)
        .pipe(Effect.orDie),
      reader
        .table("structuredSourceFields")
        .index("by_revision_observation_field_path", (query) =>
          query
            .eq("organizationKey", origin.organizationKey)
            .eq("structuredRevisionKey", origin.structuredRevisionKey)
            .eq("structuredObservationKey", origin.structuredObservationKey)
            .eq("fieldPath", origin.fieldPath),
        )
        .take(2)
        .pipe(Effect.orDie),
    ]);
    const entity = entities.length === 1 ? entities[0] : undefined;
    if (entity === undefined)
      return yield* integrityFailure(origin, "entity_missing");
    const revision = revisions.length === 1 ? revisions[0] : undefined;
    if (revision === undefined)
      return yield* integrityFailure(origin, "revision_missing");
    const observation = observations.length === 1 ? observations[0] : undefined;
    if (observation === undefined)
      return yield* integrityFailure(origin, "observation_missing");
    const field = fields.length === 1 ? fields[0] : undefined;
    if (field === undefined)
      return yield* integrityFailure(origin, "field_missing");
    if (
      revision.structuredEntityKey !== origin.structuredEntityKey ||
      observation.workspaceId !== origin.workspaceId ||
      observation.brainKey !== origin.brainKey ||
      observation.structuredEntityKey !== origin.structuredEntityKey ||
      observation.structuredRevisionKey !== origin.structuredRevisionKey ||
      observation.structuredRouteKey !== origin.structuredRouteKey ||
      observation.providerKey !== revision.providerKey ||
      observation.entityKind !== revision.entityKind ||
      observation.providerEntityId !== revision.providerEntityId ||
      observation.providerRevision !== revision.providerRevision ||
      observation.observationOrder !== revision.observationOrder ||
      field.structuredEntityKey !== origin.structuredEntityKey ||
      field.structuredRouteKey !== origin.structuredRouteKey ||
      field.providerKey !== revision.providerKey ||
      field.entityKind !== revision.entityKind ||
      field.providerEntityId !== revision.providerEntityId ||
      field.providerRevision !== revision.providerRevision ||
      field.observationOrder !== revision.observationOrder ||
      field.incarnation !== revision.incarnation ||
      field.sourceModifiedAt !== observation.sourceModifiedAt ||
      field.observedAt !== observation.observedAt ||
      field.locator !== observation.locator ||
      entity.providerKey !== revision.providerKey ||
      entity.entityKind !== revision.entityKind ||
      entity.providerEntityId !== revision.providerEntityId
    )
      return yield* integrityFailure(origin, "identity_mismatch");
    const computedValueHash = structuredValueHash(field.value);
    if (
      computedValueHash !== field.valueHash ||
      computedValueHash !== origin.valueHash
    )
      return yield* integrityFailure(origin, "value_hash_mismatch");

    const manifestFields = yield* reader
      .table("structuredSourceFields")
      .index("by_revision_observation_field_path", (query) =>
        query
          .eq("organizationKey", origin.organizationKey)
          .eq("structuredRevisionKey", origin.structuredRevisionKey)
          .eq("structuredObservationKey", origin.structuredObservationKey),
      )
      .take(MAX_FIELDS_PER_REVISION + 1)
      .pipe(Effect.orDie);
    if (manifestFields.length > MAX_FIELDS_PER_REVISION)
      return yield* integrityFailure(origin, "field_capacity_exceeded");
    const computedManifestHash = fieldManifestHash(
      manifestFields.map((entry) => ({
        fieldPath: entry.fieldPath,
        value: entry.value,
        valueHash: entry.valueHash,
        authority: entry.authority,
      })),
    );
    if (
      manifestFields.length !== observation.fieldCount ||
      computedManifestHash !== observation.fieldManifestHash ||
      computedManifestHash !== revision.fieldManifestHash
    )
      return yield* integrityFailure(origin, "field_manifest_mismatch");
    if (
      digest(observation.eligibilityManifest) !==
        observation.eligibilityManifestHash ||
      manifestFields.some(
        (entry) =>
          digest(entry.eligibilityManifest) !==
          observation.eligibilityManifestHash,
      )
    )
      return yield* integrityFailure(origin, "eligibility_manifest_mismatch");

    return {
      origin,
      entity: {
        structuredEntityKey: origin.structuredEntityKey,
        providerKey: revision.providerKey,
        entityKind: revision.entityKind,
        providerEntityId: revision.providerEntityId,
        incarnation: revision.incarnation,
      },
      fieldPath: field.fieldPath,
      value: field.value,
      revision: {
        structuredRevisionKey: revision.structuredRevisionKey,
        providerRevision: revision.providerRevision,
        observationOrder: revision.observationOrder,
        incarnation: revision.incarnation,
      },
      valueHash: computedValueHash,
      authority: field.authority,
      sourceModifiedAt: field.sourceModifiedAt,
      observedAt: field.observedAt,
      locator: field.locator,
    };
  });
