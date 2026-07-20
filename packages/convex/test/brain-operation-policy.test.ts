import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import brainOperationsImpl from "../confect/ops/brainOperations.impl";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import brainOperations, {
  BrainOperationPolicyReturn,
  OperatorForbidden,
  SetBrainOperationPolicyArgs,
} from "../confect/ops/brainOperations.spec";
import {
  evaluateOperationPolicy,
  nextOperationPolicy,
  operationPolicyAuditEvent,
  operationPolicyFromRecord,
  operationPolicyRecord,
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
    expect(() =>
      Schema.decodeUnknownSync(SetBrainOperationPolicyArgs)({
        workspaceId: "workspaces_123",
        subsystem: "mcp",
        state: "paused",
        ownerUserId: "users_123",
        reason: "operator drill",
      }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(SetBrainOperationPolicyArgs)({
        workspaceId: "workspaces_123",
        subsystem: "mcp",
        state: "paused",
        ownerUserId: "users_123",
        reason: "operator drill",
        idempotencyKey: "budget-drill-1",
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
  it("persists Brain operation policies through the Confect policy boundary", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof databaseSchema>(),
      );
      const seeded = yield* confect.run(
        seedTenancy(1_782_924_800_000),
        SeededTenancy,
      );
      const rows = yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const reader = yield* DatabaseReader;
          const paused = operationPolicyRecord({
            workspaceId: seeded.workspaceId,
            policy: {
              subsystem: "classification",
              state: "paused",
              generation: 2,
              ownerUserId: seeded.memberUserId,
              reason: "provider outage",
              idempotencyKey: "classification-pause-1",
              expiresAt: 1_782_925_000_000,
            },
            updatedAt: 1_782_924_800_000,
          });
          const resumed = operationPolicyRecord({
            workspaceId: seeded.workspaceId,
            policy: {
              subsystem: "classification",
              state: "enabled",
              generation: 3,
              ownerUserId: seeded.memberUserId,
              reason: "provider recovered",
              idempotencyKey: "classification-enable-1",
            },
            updatedAt: 1_782_924_900_000,
          });
          const pausedId = yield* writer
            .table("policies")
            .insert(paused)
            .pipe(Effect.orDie);
          yield* writer
            .table("policies")
            .patch(pausedId, {
              status: "retired",
              retiredAt: 1_782_924_900_000,
            })
            .pipe(Effect.orDie);
          yield* writer.table("policies").insert(resumed).pipe(Effect.orDie);
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

      return rows;
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result).toMatchObject({
      activeCount: 1,
      retiredCount: 1,
      active: { subsystem: "classification", state: "enabled", generation: 3 },
    });
  });
});
