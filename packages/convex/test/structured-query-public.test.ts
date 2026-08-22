import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import generatedConvexSchema from "../confect/_generated/convexSchema";
import {
  StructuredLedgerDatabaseReader,
  structuredLedgerDatabaseSchema,
  StructuredLedgerDatabaseWriter,
} from "../confect/integrations/structuredLedgerDatabase";
import { commitStructuredObservation } from "../confect/integrations/structuredLedgerRepository";
import type { CommitStructuredObservationArgs } from "../confect/integrations/structuredLedgerSchemas";

const now = 1_787_875_200_000;
const brainKey = "br_0123456789ABCDEFGHJKMNPQRS";

type TenantSeed = {
  readonly subject: string;
  readonly email: string;
  readonly workosOrganizationId: string;
  readonly organizationKey: string;
  readonly observations: readonly ObservationSeed[];
  readonly corruptRouteFor?: string;
};

type ObservationSeed = {
  readonly providerEntityId: string;
  readonly amount: number;
  readonly stage: string;
};

const primaryTenant = {
  subject: "structured-query-viewer",
  email: "structured-query-viewer@example.test",
  workosOrganizationId: "org_structured_query_primary",
  organizationKey: "ag_0123456789ABCDEFGHJKMNPQRS",
} as const;

const foreignTenant = {
  subject: "structured-query-foreign-viewer",
  email: "structured-query-foreign-viewer@example.test",
  workosOrganizationId: "org_structured_query_foreign",
  organizationKey: "ag_1123456789ABCDEFGHJKMNPQRS",
} as const;

const structuredQueryTestLayer = TestConfect.layer(
  structuredLedgerDatabaseSchema,
  generatedConvexSchema,
  import.meta.glob("../convex/**/!(*.*.*)*.*s"),
);

const observation = (
  input: ObservationSeed,
  context: {
    readonly organizationKey: string;
    readonly workspaceId: string;
  },
): CommitStructuredObservationArgs => ({
  organizationKey: context.organizationKey,
  workspaceId: context.workspaceId,
  brainKey,
  expectedIncarnation: null,
  observation: {
    providerKey: "crm_fixture",
    entityKind: "opportunity",
    providerEntityId: input.providerEntityId,
    providerRevision: "revision_1",
    observationOrder: 1,
    connectorScopeKey: "crm_pipeline_enterprise",
    connectionKey: "crm_connection",
    connectionGeneration: 3,
    allowlistGeneration: 2,
    fieldMappingPolicyKey: "crm_fields_v1",
    fieldMappingPolicyGeneration: 1,
    sourceModifiedAt: now - 1_000,
    observedAt: now,
    locator: `https://crm.example.test/opportunity/${input.providerEntityId}`,
    tombstone: false,
    fields: [
      {
        fieldPath: "opportunity.amount",
        value: { type: "number", value: input.amount },
        authority: "authoritative",
      },
      {
        fieldPath: "opportunity.stage",
        value: { type: "string", value: input.stage },
        authority: "authoritative",
      },
    ],
    eligibilityManifest: {
      entityLifecycle: {
        key: `crm_fixture:opportunity:${input.providerEntityId}`,
        eligibilityGeneration: 1,
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

const seedTenant = (input: TenantSeed) =>
  Effect.gen(function* () {
    const reader = yield* StructuredLedgerDatabaseReader;
    const writer = yield* StructuredLedgerDatabaseWriter;
    const userId = yield* writer
      .table("users")
      .insert({
        subject: input.subject,
        email: input.email,
        displayName: input.subject,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        ownerUserId: userId,
        name: input.subject,
        slug: input.subject,
        status: "active",
        workosOrganizationId: input.workosOrganizationId,
        agencyKey: input.organizationKey,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("organizationMembers")
      .insert({
        organizationId,
        userId,
        role: "viewer",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        ownerUserId: userId,
        brainKey,
        name: input.subject,
        slug: `${input.subject}-workspace`,
        status: "active",
        dataClassification: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId,
        userId,
        role: "viewer",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);

    for (const registration of [
      {
        registrationKey: `sqreg_${"1".repeat(64)}`,
        fieldPath: "opportunity.amount",
        valueType: "number" as const,
        operators: ["eq", "in", "gte", "lte"] as const,
        physicalIndex: "by_brain_entity_field_number_value_entity" as const,
      },
      {
        registrationKey: `sqreg_${"2".repeat(64)}`,
        fieldPath: "opportunity.stage",
        valueType: "string" as const,
        operators: ["eq", "in"] as const,
        physicalIndex: "by_brain_entity_field_string_value_entity" as const,
      },
    ]) {
      yield* writer
        .table("structuredQueryFieldRegistrations")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          workspaceId: String(workspaceId),
          brainKey,
          registrationKey: registration.registrationKey,
          entityKind: "opportunity",
          fieldPath: registration.fieldPath,
          valueType: registration.valueType,
          operators: registration.operators,
          physicalIndex: registration.physicalIndex,
          fieldMappingPolicyKey: "crm_fields_v1",
          fieldMappingPolicyGeneration: 1,
          state: "active",
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
    }

    for (const item of input.observations) {
      const committed = yield* commitStructuredObservation(
        observation(item, {
          organizationKey: input.organizationKey,
          workspaceId: String(workspaceId),
        }),
      );
      if (item.providerEntityId !== input.corruptRouteFor) continue;
      const routeKey = committed.routeKey;
      if (routeKey === null)
        return yield* Effect.die("Expected a live structured route.");
      const routes = yield* reader
        .table("structuredSourceRoutes")
        .index("by_organization_route_key", (query) =>
          query
            .eq("organizationKey", input.organizationKey)
            .eq("structuredRouteKey", routeKey),
        )
        .take(2)
        .pipe(Effect.orDie);
      const route = routes[0];
      if (routes.length !== 1 || route === undefined)
        return yield* Effect.die("Expected one structured route.");
      yield* writer
        .table("structuredSourceRoutes")
        .patch(route._id, {
          eligibilityManifestHash: `sha256:${"0".repeat(64)}`,
        })
        .pipe(Effect.orDie);
    }
  });

const viewer = (
  confect: TestConfect.TestConfect<typeof structuredLedgerDatabaseSchema>,
  tenant: typeof primaryTenant | typeof foreignTenant,
) =>
  confect.withIdentity({
    subject: tenant.subject,
    email: tenant.email,
    emailVerified: true,
    workosOrganizationId: tenant.workosOrganizationId,
  });

const captureFailure = <Success, Error>(
  effect: Effect.Effect<Success, Error>,
) =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => error,
      onSuccess: () => null,
    }),
  );

const runPublicTest = <Result>(
  program: Effect.Effect<
    Result,
    unknown,
    TestConfect.TestConfect<typeof structuredLedgerDatabaseSchema>
  >,
) =>
  Effect.runPromise(program.pipe(Effect.provide(structuredQueryTestLayer())));

describe("authorized structured query", () => {
  it("executes registered numeric and string filters", async () => {
    const result = await runPublicTest(
      Effect.gen(function* () {
        const confect =
          yield* TestConfect.TestConfect<
            typeof structuredLedgerDatabaseSchema
          >();
        yield* confect.run(
          seedTenant({
            ...primaryTenant,
            observations: [
              {
                providerEntityId: "opp_target",
                amount: 150_000,
                stage: "open",
              },
              { providerEntityId: "opp_below", amount: 50_000, stage: "open" },
              { providerEntityId: "opp_lost", amount: 200_000, stage: "lost" },
            ],
          }),
        );
        return yield* viewer(confect, primaryTenant).query(
          refs.public.brain.structuredQuery.query,
          {
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
                op: "eq",
                value: { type: "string", value: "open" },
              },
            ],
            pageSize: 10,
            cursor: null,
          },
        );
      }),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      entity: { providerEntityId: "opp_target" },
      facts: expect.arrayContaining([
        expect.objectContaining({
          fieldPath: "opportunity.amount",
          value: { type: "number", value: 150_000 },
        }),
        expect.objectContaining({
          fieldPath: "opportunity.stage",
          value: { type: "string", value: "open" },
        }),
      ]),
    });
    expect(result.nextCursor).toBeNull();
  });

  it("rejects unregistered fields and operators", async () => {
    const result = await runPublicTest(
      Effect.gen(function* () {
        const confect =
          yield* TestConfect.TestConfect<
            typeof structuredLedgerDatabaseSchema
          >();
        yield* confect.run(seedTenant({ ...primaryTenant, observations: [] }));
        const actor = viewer(confect, primaryTenant);
        const unregisteredField = yield* captureFailure(
          actor.query(refs.public.brain.structuredQuery.query, {
            brainKey,
            filters: [
              {
                entityKind: "opportunity",
                fieldPath: "opportunity.owner",
                op: "eq",
                value: { type: "string", value: "Ada" },
              },
            ],
            pageSize: 10,
            cursor: null,
          }),
        );
        const unregisteredOperator = yield* captureFailure(
          actor.query(refs.public.brain.structuredQuery.query, {
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
        return { unregisteredField, unregisteredOperator };
      }),
    );

    expect(result.unregisteredField).toMatchObject({
      _tag: "StructuredQueryRejected",
      reason: "unregistered_field_operator",
      fieldPath: "opportunity.owner",
    });
    expect(result.unregisteredOperator).toMatchObject({
      _tag: "StructuredQueryRejected",
      reason: "unregistered_field_operator",
      fieldPath: "opportunity.stage",
    });
  });

  it("scopes matching indexed values to the exact organization, workspace, and Brain", async () => {
    const result = await runPublicTest(
      Effect.gen(function* () {
        const confect =
          yield* TestConfect.TestConfect<
            typeof structuredLedgerDatabaseSchema
          >();
        yield* confect.run(
          seedTenant({
            ...primaryTenant,
            observations: [
              { providerEntityId: "opp_local", amount: 125_000, stage: "open" },
            ],
          }),
        );
        yield* confect.run(
          seedTenant({
            ...foreignTenant,
            observations: [
              {
                providerEntityId: "opp_foreign",
                amount: 125_000,
                stage: "open",
              },
            ],
          }),
        );
        return yield* viewer(confect, primaryTenant).query(
          refs.public.brain.structuredQuery.query,
          {
            brainKey,
            filters: [
              {
                entityKind: "opportunity",
                fieldPath: "opportunity.amount",
                op: "eq",
                value: { type: "number", value: 125_000 },
              },
            ],
            pageSize: 10,
            cursor: null,
          },
        );
      }),
    );

    expect(
      result.candidates.map(({ entity }) => entity.providerEntityId),
    ).toEqual(["opp_local"]);
    expect(JSON.stringify(result)).not.toContain("opp_foreign");
  });

  it("paginates deterministically and binds cursors to the query", async () => {
    const result = await runPublicTest(
      Effect.gen(function* () {
        const confect =
          yield* TestConfect.TestConfect<
            typeof structuredLedgerDatabaseSchema
          >();
        yield* confect.run(
          seedTenant({
            ...primaryTenant,
            observations: [
              {
                providerEntityId: "opp_page_a",
                amount: 100_000,
                stage: "open",
              },
              {
                providerEntityId: "opp_page_b",
                amount: 200_000,
                stage: "open",
              },
            ],
          }),
        );
        const actor = viewer(confect, primaryTenant);
        const query = {
          brainKey,
          filters: [
            {
              entityKind: "opportunity" as const,
              fieldPath: "opportunity.stage",
              op: "eq" as const,
              value: { type: "string" as const, value: "open" },
            },
          ],
          pageSize: 1,
          cursor: null,
        };
        const first = yield* actor.query(
          refs.public.brain.structuredQuery.query,
          query,
        );
        const second = yield* actor.query(
          refs.public.brain.structuredQuery.query,
          { ...query, cursor: first.nextCursor },
        );
        const secondRepeat = yield* actor.query(
          refs.public.brain.structuredQuery.query,
          { ...query, cursor: first.nextCursor },
        );
        const mismatch = yield* captureFailure(
          actor.query(refs.public.brain.structuredQuery.query, {
            ...query,
            filters: [
              {
                entityKind: "opportunity",
                fieldPath: "opportunity.stage",
                op: "eq",
                value: { type: "string", value: "won" },
              },
            ],
            cursor: first.nextCursor,
          }),
        );
        return { first, second, secondRepeat, mismatch };
      }),
    );

    expect(result.first.candidates).toHaveLength(1);
    expect(result.first.nextCursor).toMatch(/^sqc1_[a-f0-9]+$/);
    expect(result.second.candidates).toHaveLength(1);
    expect(result.second.nextCursor).toBeNull();
    expect(result.secondRepeat).toEqual(result.second);
    const candidateKeys = [
      result.first.candidates[0]?.entity.structuredEntityKey,
      result.second.candidates[0]?.entity.structuredEntityKey,
    ];
    expect(candidateKeys).toEqual([...candidateKeys].sort());
    expect(
      new Set(
        [result.first, result.second].flatMap(({ candidates }) =>
          candidates.map(({ entity }) => entity.providerEntityId),
        ),
      ),
    ).toEqual(new Set(["opp_page_a", "opp_page_b"]));
    expect(result.mismatch).toMatchObject({
      _tag: "StructuredQueryRejected",
      reason: "cursor_query_mismatch",
    });
  });

  it("fails closed when current-route eligibility integrity is corrupt", async () => {
    const error = await runPublicTest(
      Effect.gen(function* () {
        const confect =
          yield* TestConfect.TestConfect<
            typeof structuredLedgerDatabaseSchema
          >();
        yield* confect.run(
          seedTenant({
            ...primaryTenant,
            observations: [
              {
                providerEntityId: "opp_corrupt",
                amount: 125_000,
                stage: "open",
              },
            ],
            corruptRouteFor: "opp_corrupt",
          }),
        );
        return yield* captureFailure(
          viewer(confect, primaryTenant).query(
            refs.public.brain.structuredQuery.query,
            {
              brainKey,
              filters: [
                {
                  entityKind: "opportunity",
                  fieldPath: "opportunity.stage",
                  op: "eq",
                  value: { type: "string", value: "open" },
                },
              ],
              pageSize: 10,
              cursor: null,
            },
          ),
        );
      }),
    );

    expect(error).toMatchObject({
      _tag: "StructuredOriginIntegrityFailure",
      reason: "eligibility_manifest_mismatch",
      fieldPath: "opportunity.stage",
    });
  });
});
