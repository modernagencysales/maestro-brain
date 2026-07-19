import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import brainOperationsImpl from "../confect/ops/brainOperations.impl";
import brainOperations, {
  BrainOperationPolicyReturn,
  SetBrainOperationPolicyArgs,
} from "../confect/ops/brainOperations.spec";
import {
  evaluateOperationPolicy,
  nextOperationPolicy,
  operationSubsystems,
} from "../confect/ops/brainOperationPolicy";

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
      expiresAt: 1_782_925_000_000,
      now: 1_782_924_800_000,
    });
    expect(paused).toMatchObject({ state: "paused", generation: 2 });

    expect(
      nextOperationPolicy({
        current: paused,
        requestedState: "enabled",
        actorRole: "admin",
        reason: "provider recovered",
        ownerUserId: "users_1",
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
        now: 1_782_924_900_000,
      }),
    ).toMatchObject({ state: "disabled", generation: 8 });
  });

  it("rejects stale operators and stale recovery generations", () => {
    expect(() =>
      nextOperationPolicy({
        current: { subsystem: "ask", state: "enabled", generation: 4 },
        requestedState: "paused",
        actorRole: "viewer",
        reason: "incident",
        ownerUserId: "users_1",
        now: 1,
      }),
    ).toThrow(/OperatorForbidden/);

    expect(
      evaluateOperationPolicy({
        subsystem: "export",
        state: "paused",
        generation: 3,
        expectedGeneration: 2,
        now: 1,
      }),
    ).toEqual({ ok: false, errorTag: "RecoveryGenerationMismatch" });
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
    ).toEqual({ ok: false, errorTag: "SubsystemDisabled" });
  });

  it("declares Confect operation contracts with typed state schemas", () => {
    expect(
      Schema.decodeUnknownSync(SetBrainOperationPolicyArgs)({
        workspaceId: "workspaces_123",
        subsystem: "mcp",
        state: "paused",
        ownerUserId: "users_123",
        reason: "operator drill",
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
    expect(JSON.stringify(brainOperations)).toContain("setPolicyInternal");
    expect(brainOperationsImpl).toMatchObject({ _op_layer: "Fold" });
  });
});
