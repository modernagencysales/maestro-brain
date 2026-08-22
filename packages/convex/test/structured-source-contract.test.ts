import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import type { Value } from "convex/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  buildCandidateManifestV2,
  classifyNarrativeStructuredConflict,
} from "../confect/brain/contextPackV2";
import {
  encodeStructuredQueryCursor,
  planStructuredQuery,
  STRUCTURED_QUERY_LIMITS,
  type StructuredFieldRegistration,
} from "../confect/brain/structuredQueryPlanner";
import { executeStructuredQuery } from "../confect/brain/structuredQueryRepository";
import structuredQuery, {
  manifest as structuredQueryManifest,
} from "../confect/brain/structuredQuery.spec";
import generatedConvexSchema from "../confect/_generated/convexSchema";
import {
  StructuredLedgerDatabaseReader,
  structuredLedgerDatabaseSchema,
} from "../confect/integrations/structuredLedgerDatabase";
import {
  commitStructuredObservation,
  resolveStructuredOrigin,
} from "../confect/integrations/structuredLedgerRepository";
import {
  structuredValueHash,
  type CommitStructuredObservationArgs,
  type StructuredFact,
} from "../confect/integrations/structuredLedgerSchemas";
import structuredSourceEntities from "../confect/tables/structuredSourceEntities";
import structuredSourceFields from "../confect/tables/structuredSourceFields";
import structuredSourceObservations from "../confect/tables/structuredSourceObservations";
import structuredSourceRevisions from "../confect/tables/structuredSourceRevisions";
import structuredSourceRoutes from "../confect/tables/structuredSourceRoutes";

const structuredLedgerConvexSchema = defineSchema({
  ...generatedConvexSchema.tables,
  structuredSourceEntities:
    structuredLedgerDatabaseSchema.tables.structuredSourceEntities
      .tableDefinition,
  structuredSourceFields:
    structuredLedgerDatabaseSchema.tables.structuredSourceFields
      .tableDefinition,
  structuredSourceObservations:
    structuredLedgerDatabaseSchema.tables.structuredSourceObservations
      .tableDefinition,
  structuredSourceRevisions:
    structuredLedgerDatabaseSchema.tables.structuredSourceRevisions
      .tableDefinition,
  structuredSourceRoutes:
    structuredLedgerDatabaseSchema.tables.structuredSourceRoutes
      .tableDefinition,
});
const structuredLedgerTestLayer = TestConfect.layer(
  structuredLedgerDatabaseSchema,
  structuredLedgerConvexSchema,
  import.meta.glob("../convex/**/!(*.*.*)*.*s"),
);
const resultSchema = <Result>(): Schema.Schema<Result, Value> =>
  Schema.Any as unknown as Schema.Schema<Result, Value>;
const runLedger = <Result, Error>(
  program: Effect.Effect<
    Result,
    Error,
    TestConfect.TestConfect<typeof structuredLedgerDatabaseSchema>
  >,
) =>
  Effect.runPromise(program.pipe(Effect.provide(structuredLedgerTestLayer())));

const organizationKey = "ag_0123456789ABCDEFGHJKMNPQRS";
const workspaceId = "workspace_apero";
const brainKey = "company";
const now = 1_787_270_400_000;

const observation = (
  providerEntityId: string,
  input: {
    readonly providerRevision?: string;
    readonly observationOrder?: number;
    readonly observedAt?: number;
    readonly tombstone?: boolean;
    readonly lifecycleGeneration?: number;
    readonly amount?: number;
    readonly stage?: string;
  } = {},
): CommitStructuredObservationArgs => ({
  organizationKey,
  workspaceId,
  brainKey,
  expectedIncarnation: null,
  observation: {
    providerKey: "crm_fixture",
    entityKind: "opportunity",
    providerEntityId,
    providerRevision: input.providerRevision ?? "revision_1",
    observationOrder: input.observationOrder ?? 1,
    connectorScopeKey: "crm_pipeline_enterprise",
    connectionKey: "crm_connection",
    connectionGeneration: 3,
    allowlistGeneration: 2,
    fieldMappingPolicyKey: "crm_fields_v1",
    fieldMappingPolicyGeneration: 1,
    sourceModifiedAt: now - 1_000,
    observedAt: input.observedAt ?? now,
    locator: `https://crm.example.test/opportunity/${providerEntityId}`,
    tombstone: input.tombstone ?? false,
    fields: input.tombstone
      ? []
      : [
          {
            fieldPath: "opportunity.amount",
            value: { type: "number", value: input.amount ?? 125_000 },
            authority: "authoritative",
          },
          {
            fieldPath: "opportunity.stage",
            value: { type: "string", value: input.stage ?? "open" },
            authority: "authoritative",
          },
        ],
    eligibilityManifest: {
      entityLifecycle: {
        key: `crm_fixture:opportunity:${providerEntityId}`,
        eligibilityGeneration: input.lifecycleGeneration ?? 1,
      },
      connectorScope: {
        key: "crm_pipeline_enterprise",
        eligibilityGeneration: 2,
      },
      allowlist: {
        key: "crm_pipeline_enterprise:allowlist",
        eligibilityGeneration: 2,
      },
      connection: {
        key: "crm_connection",
        eligibilityGeneration: 3,
      },
      fieldMappingPolicy: {
        key: "crm_fields_v1",
        eligibilityGeneration: 1,
      },
    },
  },
});

const registry = [
  {
    entityKind: "opportunity",
    fieldPath: "opportunity.amount",
    valueType: "number",
    operators: ["eq", "in", "gte", "lte"],
    index: "by_brain_entity_field_number_value_entity",
    fieldMappingPolicyKey: "crm_fields_v1",
    fieldMappingPolicyGeneration: 1,
  },
  {
    entityKind: "opportunity",
    fieldPath: "opportunity.stage",
    valueType: "string",
    operators: ["eq", "in"],
    index: "by_brain_entity_field_string_value_entity",
    fieldMappingPolicyKey: "crm_fields_v1",
    fieldMappingPolicyGeneration: 1,
  },
] as const satisfies readonly StructuredFieldRegistration[];

const captureFailure = <Success, Error extends { readonly _tag: string }>(
  effect: Effect.Effect<Success, Error>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (error) => error,
        onSuccess: () => null,
      }),
    ),
  );

describe("structured source contract", () => {
  it("declares provider-neutral identity, immutable provenance, route, and typed value indexes", () => {
    expect(structuredSourceEntities.indexes).toMatchObject({
      by_organization_provider_entity: [
        "organizationKey",
        "providerKey",
        "entityKind",
        "providerEntityId",
      ],
    });
    expect(structuredSourceRevisions.indexes).toHaveProperty(
      "by_organization_revision_key",
    );
    expect(structuredSourceObservations.indexes).toHaveProperty(
      "by_organization_observation_key",
    );
    expect(structuredSourceRoutes.indexes).toHaveProperty(
      "by_brain_scope_entity",
    );
    expect(structuredSourceFields.indexes).toMatchObject({
      by_brain_entity_field_boolean_value_entity: expect.any(Array),
      by_brain_entity_field_number_value_entity: expect.any(Array),
      by_brain_entity_field_string_value_entity: expect.any(Array),
      by_brain_entity_field_timestamp_value_entity: expect.any(Array),
      by_revision_observation_field_path: expect.any(Array),
    });
    expect(structuredQuery.functions).toHaveProperty("query");
    expect(structuredQueryManifest).toEqual([
      expect.objectContaining({
        namespace: "brain.structured",
        name: "query",
        operationId: "brain.structured.query",
        kind: "query",
        typedErrors: expect.arrayContaining([
          "StructuredQueryRejected",
          "StructuredQueryCapacityExceeded",
          "StructuredOriginIntegrityFailure",
        ]),
      }),
    ]);
  });

  it("normalizes typed values before hashing", () => {
    expect(
      structuredValueHash({ type: "string", value: "  Cafe\u0301  " }),
    ).toBe(structuredValueHash({ type: "string", value: "Caf\u00e9" }));
    expect(structuredValueHash({ type: "number", value: -0 })).toBe(
      structuredValueHash({ type: "number", value: 0 }),
    );
    expect(structuredValueHash({ type: "number", value: 0 })).not.toBe(
      structuredValueHash({ type: "string", value: "0" }),
    );
  });

  it("commits immutable entity/revision/field evidence idempotently and resolves an exact structured origin", async () => {
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof structuredLedgerDatabaseSchema>();
      const first = yield* confect.run(
        commitStructuredObservation(observation("opp_1")),
        resultSchema(),
      );
      const retry = yield* confect.run(
        commitStructuredObservation({
          ...observation("opp_1"),
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const firstOrigin = first.origins[0];
      if (firstOrigin === undefined)
        return yield* Effect.die("The committed revision has no origin.");
      const fact = yield* confect.run(
        resolveStructuredOrigin(firstOrigin),
        resultSchema(),
      );
      const ledger = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* StructuredLedgerDatabaseReader;
          const [entities, revisions, observations, fields, routes] =
            yield* Effect.all([
              reader
                .table("structuredSourceEntities")
                .index("by_organization", (query) =>
                  query.eq("organizationKey", organizationKey),
                )
                .take(10)
                .pipe(Effect.orDie),
              reader
                .table("structuredSourceRevisions")
                .index("by_organization", (query) =>
                  query.eq("organizationKey", organizationKey),
                )
                .take(10)
                .pipe(Effect.orDie),
              reader
                .table("structuredSourceObservations")
                .index("by_organization", (query) =>
                  query.eq("organizationKey", organizationKey),
                )
                .take(10)
                .pipe(Effect.orDie),
              reader
                .table("structuredSourceFields")
                .index("by_organization", (query) =>
                  query.eq("organizationKey", organizationKey),
                )
                .take(10)
                .pipe(Effect.orDie),
              reader
                .table("structuredSourceRoutes")
                .index("by_organization", (query) =>
                  query.eq("organizationKey", organizationKey),
                )
                .take(10)
                .pipe(Effect.orDie),
            ]);
          return { entities, revisions, observations, fields, routes };
        }),
        resultSchema(),
      );
      return {
        first,
        retry,
        fact,
        counts: {
          entities: ledger.entities.length,
          revisions: ledger.revisions.length,
          observations: ledger.observations.length,
          fields: ledger.fields.length,
          routes: ledger.routes.length,
        },
      };
    });

    const result = await runLedger(program);
    expect(result.first).toMatchObject({
      classification: "created",
      incarnation: 1,
      fieldCount: 2,
    });
    expect(result.first.entityKey).toMatch(/^sent_[a-f0-9]{64}$/);
    expect(result.first.revisionKey).toMatch(/^srev_[a-f0-9]{64}$/);
    expect(result.first.observationKey).toMatch(/^sobs_[a-f0-9]{64}$/);
    expect(result.first.routeKey).toMatch(/^sroute_[a-f0-9]{64}$/);
    expect(result.retry).toEqual(result.first);
    expect(result.counts).toEqual({
      entities: 1,
      revisions: 1,
      observations: 1,
      fields: 2,
      routes: 1,
    });
    expect(result.fact).toMatchObject({
      origin: { kind: "structured" },
      entity: {
        providerKey: "crm_fixture",
        entityKind: "opportunity",
        providerEntityId: "opp_1",
      },
      authority: "authoritative",
      locator: "https://crm.example.test/opportunity/opp_1",
    });
    expect(result.fact.valueHash).toBe(structuredValueHash(result.fact.value));
  });

  it("fails closed when a cited value hash does not match the immutable field", async () => {
    const error = await runLedger(
      Effect.gen(function* () {
        const confect =
          yield* TestConfect.TestConfect<
            typeof structuredLedgerDatabaseSchema
          >();
        const committed = yield* confect.run(
          commitStructuredObservation(observation("opp_hash")),
          resultSchema(),
        );
        const origin = committed.origins[0];
        if (origin === undefined)
          return yield* Effect.die("The committed revision has no origin.");
        return yield* confect.run(
          resolveStructuredOrigin({
            ...origin,
            valueHash: `sha256:${"0".repeat(64)}`,
          }).pipe(
            Effect.match({
              onFailure: (failure) => ({
                _tag: failure._tag,
                reason: failure.reason,
                revisionKey: failure.revisionKey,
                fieldPath: failure.fieldPath,
              }),
              onSuccess: () => null,
            }),
          ),
          resultSchema(),
        );
      }),
    );

    expect(error).toMatchObject({
      _tag: "StructuredOriginIntegrityFailure",
      reason: "value_hash_mismatch",
    });
  });

  it("retains tombstone and recreation revisions with a new incarnation", async () => {
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof structuredLedgerDatabaseSchema>();
      yield* confect.run(
        commitStructuredObservation(observation("opp_recreated")),
        resultSchema(),
      );
      const tombstone = yield* confect.run(
        commitStructuredObservation({
          ...observation("opp_recreated", {
            providerRevision: "revision_2",
            observationOrder: 2,
            observedAt: now + 1_000,
            tombstone: true,
            lifecycleGeneration: 2,
          }),
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const recreated = yield* confect.run(
        commitStructuredObservation({
          ...observation("opp_recreated", {
            providerRevision: "revision_3",
            observationOrder: 3,
            observedAt: now + 2_000,
            lifecycleGeneration: 3,
          }),
          expectedIncarnation: 1,
        }),
        resultSchema(),
      );
      const revisions = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* StructuredLedgerDatabaseReader;
          return yield* reader
            .table("structuredSourceRevisions")
            .index("by_organization", (query) =>
              query.eq("organizationKey", organizationKey),
            )
            .take(10)
            .pipe(Effect.orDie);
        }),
        resultSchema(),
      );
      return { tombstone, recreated, revisions };
    });

    const result = await runLedger(program);
    expect(result.tombstone).toMatchObject({
      classification: "tombstone",
      incarnation: 1,
      fieldCount: 0,
    });
    expect(result.recreated).toMatchObject({
      classification: "recreated",
      incarnation: 2,
      fieldCount: 2,
    });
    expect(result.revisions).toHaveLength(3);
    expect(result.revisions.map(({ incarnation }) => incarnation)).toEqual([
      1, 1, 2,
    ]);
  });

  it("plans only registered bounded index scans and returns typed rejection or capacity errors", async () => {
    const acceptedArgs = {
      brainKey,
      filters: [
        {
          entityKind: "opportunity",
          fieldPath: "opportunity.amount",
          op: "gte",
          value: { type: "number", value: 100_000 },
        },
        {
          entityKind: "opportunity",
          fieldPath: "opportunity.stage",
          op: "in",
          value: [
            { type: "string", value: "open" },
            { type: "string", value: "won" },
          ],
        },
      ],
      pageSize: 10,
      cursor: null,
    } as const;
    const accepted = await Effect.runPromise(
      planStructuredQuery(registry, acceptedArgs),
    );
    expect(accepted.scans.map(({ index }) => index)).toEqual([
      "by_brain_entity_field_number_value_entity",
      "by_brain_entity_field_string_value_entity",
    ]);
    expect(accepted.take).toBe(STRUCTURED_QUERY_LIMITS.indexCandidates + 1);
    const cursorRegistryMismatch = await captureFailure(
      planStructuredQuery(
        [
          ...registry,
          {
            entityKind: "account",
            fieldPath: "account.name",
            valueType: "string",
            operators: ["eq"],
            index: "by_brain_entity_field_string_value_entity",
            fieldMappingPolicyKey: "crm_fields_v1",
            fieldMappingPolicyGeneration: 1,
          },
        ],
        {
          ...acceptedArgs,
          cursor: encodeStructuredQueryCursor(
            accepted.queryHash,
            "candidate_key",
          ),
        },
      ),
    );
    expect(cursorRegistryMismatch).toMatchObject({
      _tag: "StructuredQueryRejected",
      reason: "cursor_query_mismatch",
    });

    const unsupportedJoin = await captureFailure(
      planStructuredQuery(registry, {
        brainKey,
        filters: [],
        pageSize: 10,
        cursor: null,
        join: { entityKind: "account" },
      }),
    );
    expect(unsupportedJoin).toMatchObject({
      _tag: "StructuredQueryRejected",
      reason: "unsupported_join",
    });

    const unsupportedAggregate = await captureFailure(
      planStructuredQuery(registry, {
        brainKey,
        filters: [],
        pageSize: 10,
        cursor: null,
        aggregate: { op: "sum", fieldPath: "opportunity.amount" },
      }),
    );
    expect(unsupportedAggregate).toMatchObject({
      _tag: "StructuredQueryRejected",
      reason: "unsupported_aggregate",
    });

    const unregistered = await captureFailure(
      planStructuredQuery(registry, {
        brainKey,
        filters: [
          {
            entityKind: "opportunity",
            fieldPath: "opportunity.stage",
            op: "gte",
            value: { type: "string", value: "open" },
          },
        ],
        pageSize: 10,
        cursor: null,
      }),
    );
    expect(unregistered).toMatchObject({
      _tag: "StructuredQueryRejected",
      reason: "unregistered_field_operator",
      fieldPath: "opportunity.stage",
    });

    const tooManyFilters = await captureFailure(
      planStructuredQuery(registry, {
        brainKey,
        filters: Array.from(
          { length: STRUCTURED_QUERY_LIMITS.filters + 1 },
          () => ({
            entityKind: "opportunity" as const,
            fieldPath: "opportunity.stage",
            op: "eq" as const,
            value: { type: "string" as const, value: "open" },
          }),
        ),
        pageSize: 10,
        cursor: null,
      }),
    );
    expect(tooManyFilters).toMatchObject({
      _tag: "StructuredQueryCapacityExceeded",
      resource: "filters",
      limit: STRUCTURED_QUERY_LIMITS.filters,
    });
  });

  it("executes bounded conjunctions with deterministic cursor pagination", async () => {
    const program = Effect.gen(function* () {
      const confect =
        yield* TestConfect.TestConfect<typeof structuredLedgerDatabaseSchema>();
      for (const input of [
        observation("opp_a", { amount: 150_000, stage: "open" }),
        observation("opp_b", { amount: 200_000, stage: "won" }),
        observation("opp_c", { amount: 50_000, stage: "open" }),
      ]) {
        yield* confect.run(commitStructuredObservation(input), resultSchema());
      }
      const query = {
        brainKey,
        filters: [
          {
            entityKind: "opportunity" as const,
            fieldPath: "opportunity.amount",
            op: "gte" as const,
            value: { type: "number" as const, value: 100_000 },
          },
          {
            entityKind: "opportunity" as const,
            fieldPath: "opportunity.stage",
            op: "in" as const,
            value: [
              { type: "string" as const, value: "open" },
              { type: "string" as const, value: "won" },
            ],
          },
        ],
        pageSize: 1,
        cursor: null,
      };
      const first = yield* confect.run(
        executeStructuredQuery(
          { organizationKey, workspaceId },
          registry,
          query,
        ),
        resultSchema(),
      );
      const second = yield* confect.run(
        executeStructuredQuery({ organizationKey, workspaceId }, registry, {
          ...query,
          cursor: first.nextCursor,
        }),
        resultSchema(),
      );
      return { first, second };
    });

    const { first, second } = await runLedger(program);
    expect(first.candidates).toHaveLength(1);
    expect(first.nextCursor).toMatch(/^sqc1_[a-f0-9]+$/);
    expect(second.candidates).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const firstCandidate = first.candidates[0];
    const secondCandidate = second.candidates[0];
    expect(firstCandidate).toBeDefined();
    expect(secondCandidate).toBeDefined();
    if (firstCandidate === undefined || secondCandidate === undefined) return;
    const orderedKeys = [
      firstCandidate.entity.structuredEntityKey,
      secondCandidate.entity.structuredEntityKey,
    ];
    expect(orderedKeys).toEqual([...orderedKeys].sort());
    expect(new Set(orderedKeys).size).toBe(2);
  });

  it("isolates ContextPack v2 while hashing every structured fact and exposing narrative conflicts", async () => {
    const fact = await runLedger(
      Effect.gen(function* () {
        const confect =
          yield* TestConfect.TestConfect<
            typeof structuredLedgerDatabaseSchema
          >();
        const committed = yield* confect.run(
          commitStructuredObservation(observation("opp_context")),
          resultSchema(),
        );
        const origin = committed.origins[0];
        if (origin === undefined)
          return yield* Effect.die("The committed revision has no origin.");
        return yield* confect.run(
          resolveStructuredOrigin(origin),
          resultSchema(),
        );
      }),
    );
    const manifest = buildCandidateManifestV2({
      entries: [
        {
          kind: "page",
          publicationSetKey: "set_1",
          entryKey: "entry_1",
          revisionKey: "page_revision_1",
          contentHash: `sha256:${"1".repeat(64)}`,
        },
      ],
      structuredFacts: [fact],
    });
    const changedFact: StructuredFact = {
      ...fact,
      locator: `${fact.locator}?changed=1`,
    };
    const changed = buildCandidateManifestV2({
      entries: [
        {
          kind: "page",
          publicationSetKey: "set_1",
          entryKey: "entry_1",
          revisionKey: "page_revision_1",
          contentHash: `sha256:${"1".repeat(64)}`,
        },
      ],
      structuredFacts: [changedFact],
    });
    expect(manifest).toMatchObject({ version: "2" });
    expect(manifest.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(changed.hash).not.toBe(manifest.hash);
    expect(
      classifyNarrativeStructuredConflict({
        subject: "opportunity:opp_context:amount",
        narrativeRevisionKey: "page_revision_1",
        narrativeValueHash: `sha256:${"2".repeat(64)}`,
        structuredFact: fact,
      }),
    ).toEqual({
      status: "conflict",
      behavior: "expose_both",
      subject: "opportunity:opp_context:amount",
      narrativeRevisionKey: "page_revision_1",
      structuredRevisionKey: fact.revision.structuredRevisionKey,
      authoritativeValueHash: fact.valueHash,
    });
  });
});
