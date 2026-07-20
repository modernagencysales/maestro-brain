import { Registry } from "@confect/core";
import { TestConfect } from "@confect/test";
import type { RegisteredConvexFunction } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import brainOperationsImpl from "../confect/ops/brainOperations.impl";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import brainOperations, {
  BrainOperationPolicyListReturn,
  BrainOperationPolicyReturn,
  ListBrainOperationPoliciesArgs,
  OperatorForbidden,
  SetBrainOperationPolicyArgs,
} from "../confect/ops/brainOperations.spec";
import {
  evaluateOperationPolicy,
  nextOperationPolicy,
  operationPolicyAuditEvent,
  operationPolicyFromRecord,
  operationPolicyRecord,
  replayOperationPolicyByIdempotencyKey,
  operationSubsystems,
} from "../confect/ops/brainOperationPolicy";
import { testConfectLayer } from "./support/confect";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";

describe("Brain operation policy", () => {
  it("declares every independent risky subsystem kill switch", () => {
    expect(operationSubsystems).toEqual([
      "capture",
      "backfill",
      "classification",
      "maintenance",
      "ask",
      "slackDelivery",
      "mcp",
      "export",
      "lifecycle",
    ]);
  });

  it("allows enabled paused enabled transitions and emergency disabled", () => {
    const paused = nextOperationPolicy({
      current: { subsystem: "classification", state: "enabled", generation: 1 },
      requestedState: "paused",
      actorRole: "admin",
      reason: "model outage",
      ownerUserId: "users_1",
      idempotencyKey: "transition-1",
      expiresAt: 1_782_925_000_000,
      now: 1_782_924_800_000,
    });
    expect(paused).toMatchObject({ state: "paused", generation: 2 });
    if (paused instanceof Error) throw paused;

    expect(
      nextOperationPolicy({
        current: paused,
        requestedState: "enabled",
        actorRole: "admin",
        reason: "provider recovered",
        ownerUserId: "users_1",
        idempotencyKey: "transition-2",
        now: 1_782_924_900_000,
      }),
    ).toMatchObject({ state: "enabled", generation: 3 });

    expect(
      nextOperationPolicy({
        current: { subsystem: "lifecycle", state: "enabled", generation: 7 },
        requestedState: "disabled",
        actorRole: "owner",
        reason: "emergency revoke",
        ownerUserId: "users_2",
        idempotencyKey: "transition-3",
        now: 1_782_924_900_000,
      }),
    ).toMatchObject({ state: "disabled", generation: 8 });
  });

  it("rejects stale operators and stale recovery generations", () => {
    expect(
      nextOperationPolicy({
        current: { subsystem: "ask", state: "enabled", generation: 4 },
        requestedState: "paused",
        actorRole: "viewer",
        reason: "incident",
        ownerUserId: "users_1",
        idempotencyKey: "stale-operator-1",
        now: 1,
      }),
    ).toEqual(new OperatorForbidden({ reason: "admin role required" }));

    expect(
      evaluateOperationPolicy({
        subsystem: "export",
        state: "paused",
        generation: 3,
        expectedGeneration: 2,
        now: 1,
      }),
    ).toMatchObject({ ok: false, errorTag: "RecoveryGenerationMismatch" });
  });

  it("preserves independent controls between exact capture and semantic systems", () => {
    expect(
      evaluateOperationPolicy({
        subsystem: "capture",
        state: "enabled",
        generation: 1,
        now: 1,
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateOperationPolicy({
        subsystem: "classification",
        state: "disabled",
        generation: 1,
        now: 1,
      }),
    ).toMatchObject({ ok: false, errorTag: "SubsystemDisabled" });
  });

  it("declares Confect operation contracts with typed state schemas", () => {
    expect(() =>
      Schema.decodeUnknownSync(SetBrainOperationPolicyArgs)({
        workspaceId: "workspaces_123",
        subsystem: "mcp",
        state: "paused",
        ownerUserId: "users_123",
        reason: "operator drill",
        idempotencyKey: "missing-generation",
      }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(SetBrainOperationPolicyArgs)({
        workspaceId: "workspaces_123",
        subsystem: "mcp",
        state: "paused",
        ownerUserId: "users_123",
        reason: "operator drill",
        idempotencyKey: "policy-drill-1",
        expectedGeneration: 1,
      }),
    ).toMatchObject({ subsystem: "mcp", state: "paused" });
    expect(
      Schema.decodeUnknownSync(BrainOperationPolicyReturn)({
        workspaceId: "workspaces_123",
        subsystem: "mcp",
        state: "paused",
        ownerUserId: "users_123",
        reason: "operator drill",
        generation: 2,
        updatedAt: 1,
      }),
    ).toMatchObject({ generation: 2 });
    expect(
      Schema.decodeUnknownSync(SetBrainOperationPolicyArgs)({
        workspaceId: "workspaces_123",
        subsystem: "mcp",
        state: "paused",
        ownerUserId: "users_123",
        reason: "operator drill",
        idempotencyKey: "budget-drill-1",
        expectedGeneration: 1,
        budgetCheck: {
          budget: "modelTokens",
          limit: 1_000,
          observed: 1_001,
        },
      }),
    ).toMatchObject({ budgetCheck: { budget: "modelTokens" } });
    expect(JSON.stringify(brainOperations)).toContain("setPolicyInternal");
    expect(brainOperationsImpl).toMatchObject({ _op_layer: "Fold" });
  });
  it("builds durable redacted policy records and audit receipts", () => {
    const policy = {
      subsystem: "classification",
      state: "paused",
      generation: 2,
      ownerUserId: "users_123",
      reason: "provider outage with customer prompt canary",
      expiresAt: 1_782_925_000_000,
    } as const;
    const row = operationPolicyRecord({
      workspaceId: "workspaces_123",
      policy,
      updatedAt: 1_782_924_800_000,
    });
    const audit = operationPolicyAuditEvent({
      workspaceId: "workspaces_123",
      actorUserId: "users_123",
      policy,
      previousGeneration: 1,
      updatedAt: 1_782_924_800_000,
    });

    expect(row.policyKey).toBe("brainOperation:workspaces_123:classification");
    expect(row.status).toBe("active");
    expect(row).not.toHaveProperty("policy");
    expect(operationPolicyFromRecord(row)).toMatchObject({
      state: "paused",
      generation: 2,
      reason: "provider outage with customer prompt canary",
    });
    expect(audit).toMatchObject({
      action: "model.egressPolicyChanged",
      subjectKind: "privilegedAction",
      subjectId: "classification",
      metadata: {
        outcome: "changed",
        subsystem: "classification",
        state: "paused",
        generation: 2,
        previousGeneration: 1,
        expiresAt: 1_782_925_000_000,
      },
    });
    expect(JSON.stringify(audit)).not.toContain("customer prompt canary");
  });
  it("expires transient pauses consistently before policy evaluation", () => {
    expect(
      evaluateOperationPolicy({
        subsystem: "ask",
        state: "paused",
        generation: 4,
        expiresAt: 1_782_924_800_000,
        expectedGeneration: 4,
        now: 1_782_924_800_000,
      }),
    ).toEqual({ ok: true });
  });

  it("keeps replay idempotent even after later policy updates", () => {
    const paused = nextOperationPolicy({
      current: { subsystem: "ask", state: "enabled", generation: 1 },
      requestedState: "paused",
      actorRole: "admin",
      reason: "ask outage",
      ownerUserId: "users_1",
      idempotencyKey: "ask-pause-1",
      expectedGeneration: 1,
      now: 1_782_924_800_000,
    });
    if (paused instanceof Error) throw paused;
    const resumed = nextOperationPolicy({
      current: paused,
      requestedState: "enabled",
      actorRole: "admin",
      reason: "ask recovered",
      ownerUserId: "users_1",
      idempotencyKey: "ask-enable-1",
      expectedGeneration: 2,
      now: 1_782_924_900_000,
    });
    if (resumed instanceof Error) throw resumed;

    expect(
      replayOperationPolicyByIdempotencyKey([paused, resumed], "ask-pause-1"),
    ).toBe(paused);
    expect(
      nextOperationPolicy({
        current: resumed,
        requestedState: "paused",
        actorRole: "admin",
        reason: "late duplicate",
        ownerUserId: "users_1",
        idempotencyKey: "ask-pause-1",
        expectedGeneration: 1,
        now: 1_782_925_000_000,
      }),
    ).toMatchObject({ _tag: "RecoveryGenerationMismatch" });
  });

  it("persists Brain operation policies through registered Confect functions", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedTenancy(1_782_924_800_000),
        SeededTenancy,
      );
      const handlers = yield* collectOperationHandlers();
      const member = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const viewerDenied = yield* member.run(
        handlers
          .setPolicyInternal({
            workspaceId: seeded.workspaceId,
            subsystem: "classification",
            state: "paused",
            ownerUserId: seeded.memberUserId,
            reason: "viewer should be denied",
            idempotencyKey: "classification-denied-1",
            expectedGeneration: 1,
          })
          .pipe(
            Effect.either,
            Effect.map((result) =>
              result._tag === "Left"
                ? {
                    _tag: "Left" as const,
                    left: {
                      _tag: (result.left as { readonly _tag?: string })._tag,
                    },
                  }
                : result,
            ),
          ),
        Schema.Any,
      );

      yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const writer = yield* DatabaseWriter;
          const membership = yield* reader
            .table("workspaceMembers")
            .index("by_workspace_user", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("userId", seeded.memberUserId),
            )
            .first()
            .pipe(Effect.orDie);
          if (membership._tag === "None") {
            throw new Error("expected seeded workspace membership");
          }
          yield* writer
            .table("workspaceMembers")
            .patch(membership.value._id, {
              role: "admin",
              updatedAt: 1_782_924_801_000,
            })
            .pipe(Effect.orDie);
          return {};
        }),
        Schema.Struct({}),
      );

      const paused = yield* member.run(
        handlers.setPolicyInternal({
          workspaceId: seeded.workspaceId,
          subsystem: "classification",
          state: "paused",
          ownerUserId: seeded.memberUserId,
          reason: "provider outage with customer prompt canary",
          idempotencyKey: "classification-pause-1",
          expectedGeneration: 1,
        }),
        BrainOperationPolicyReturn,
      );
      const resumed = yield* member.run(
        handlers.setPolicyInternal({
          workspaceId: seeded.workspaceId,
          subsystem: "classification",
          state: "enabled",
          ownerUserId: seeded.memberUserId,
          reason: "provider recovered",
          idempotencyKey: "classification-enable-1",
          expectedGeneration: 2,
        }),
        BrainOperationPolicyReturn,
      );
      const listed = (yield* member.run(
        handlers.listPolicies({ workspaceId: seeded.workspaceId }),
        Schema.Any,
      )) as OperationPolicyList;
      const rows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const policies = yield* reader
            .table("policies")
            .index("by_policy_version", (q) =>
              q.eq(
                "policyKey",
                `brainOperation:${seeded.workspaceId}:classification`,
              ),
            )
            .collect()
            .pipe(Effect.orDie);

          return {
            activeCount: policies.filter((row) => row.status === "active")
              .length,
            retiredCount: policies.filter((row) => row.status === "retired")
              .length,
            active: operationPolicyFromRecord(
              policies.find((row) => row.status === "active") ??
                (() => {
                  throw new Error("expected an active operation policy row");
                })(),
            ),
          };
        }),
        Schema.Struct({
          activeCount: Schema.Number,
          retiredCount: Schema.Number,
          active: Schema.Any,
        }),
      );

      return { listed, paused, resumed, rows, viewerDenied };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.viewerDenied).toMatchObject({
      _tag: "Left",
      left: { _tag: "OperatorForbidden" },
    });
    expect(result.paused).toMatchObject({
      state: "paused",
      generation: 2,
    });
    expect(result.resumed).toMatchObject({
      state: "enabled",
      generation: 3,
    });
    expect(
      result.listed.policies.find(
        (policy) => policy.subsystem === "classification",
      ),
    ).toMatchObject({ state: "enabled", generation: 3 });
    expect(result.rows).toMatchObject({
      activeCount: 1,
      retiredCount: 1,
      active: { subsystem: "classification", state: "enabled", generation: 3 },
    });
  });
});

type OperationPolicyList = Schema.Schema.Type<
  typeof BrainOperationPolicyListReturn
>;
type OperationPolicyReturn = Schema.Schema.Type<
  typeof BrainOperationPolicyReturn
>;
type OperationHandlerServices = RegisteredConvexFunction.MutationServices<
  typeof databaseSchema
>;

type OperationHandlers = {
  readonly listPolicies: (
    input: Schema.Schema.Type<typeof ListBrainOperationPoliciesArgs>,
  ) => Effect.Effect<OperationPolicyList, unknown, OperationHandlerServices>;
  readonly setPolicyInternal: (
    input: Schema.Schema.Type<typeof SetBrainOperationPolicyArgs>,
  ) => Effect.Effect<OperationPolicyReturn, unknown, OperationHandlerServices>;
};

const collectOperationHandlers = (): Effect.Effect<OperationHandlers> =>
  Effect.gen(function* () {
    const registry = yield* Ref.make<Registry.RegistryItems>({});
    yield* Layer.build(brainOperationsImpl).pipe(
      Effect.scoped,
      Effect.provideService(Registry.Registry, registry),
    );
    const items = yield* Ref.get(registry);

    return {
      listPolicies: registryHandler(items, "listPolicies"),
      setPolicyInternal: registryHandler(items, "setPolicyInternal"),
    };
  });

const registryHandler = <Name extends keyof OperationHandlers>(
  items: Registry.RegistryItems,
  name: Name,
): OperationHandlers[Name] => {
  const item = items[name];
  if (
    typeof item !== "object" ||
    item === null ||
    !("handler" in item) ||
    typeof item.handler !== "function"
  ) {
    throw new Error(`missing ${name} operation handler`);
  }

  return item.handler as OperationHandlers[Name];
};
