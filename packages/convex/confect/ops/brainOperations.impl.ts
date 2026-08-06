import { FunctionImpl, GroupImpl } from "@confect/server";
import type * as Context from "effect/Context";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { recordAccessAuditEvent } from "../access/audit";
import { roleAtLeast, type Role } from "../access/roles";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import brainOperations, {
  BudgetExceeded,
  OperatorForbidden,
  SubsystemDisabled,
} from "./brainOperations.spec";
import {
  defaultOperationPolicy,
  isOperationPolicyError,
  nextOperationPolicy,
  operationPolicyAuditEvent,
  operationPolicyFromRecord,
  operationPolicyKey,
  operationPolicyRecord,
  operationSubsystems,
  replayOperationPolicyByIdempotencyKey,
  type OperationPolicy,
  type OperationSubsystem,
} from "./brainOperationPolicy";

const unsafeAssumeClockProvided = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const listPolicies = FunctionImpl.make(
  databaseSchema,
  brainOperations,
  "listPolicies",
  ({ workspaceId }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      const now = yield* unsafeAssumeClockProvided(Clock.currentTimeMillis);
      const policies = yield* loadOperationPolicies(workspaceId, now);

      return {
        policies: operationSubsystems.map((subsystem) => {
          const loaded = policies.get(subsystem);
          return toPolicyReturn(
            workspaceId,
            loaded?.policy ?? defaultOperationPolicy(subsystem),
            loaded?.updatedAt ?? 0,
          );
        }),
      };
    }),
);

const setPolicyInternal = FunctionImpl.make(
  databaseSchema,
  brainOperations,
  "setPolicyInternal",
  (input) =>
    Effect.gen(function* () {
      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(input.workspaceId, "viewer"),
      );
      if (!canOperateBrainPolicy(access.role)) {
        return yield* new OperatorForbidden({ reason: "admin role required" });
      }

      const updatedAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const current = yield* loadOperationPolicy(
        reader,
        input.workspaceId,
        input.subsystem,
        updatedAt,
      );
      const replayed = yield* loadOperationPolicyReplay(
        reader,
        input.workspaceId,
        input.subsystem,
        input.idempotencyKey,
      );
      if (replayed !== undefined) {
        return toPolicyReturn(
          input.workspaceId,
          replayed.policy,
          replayed.updatedAt,
        );
      }
      if (
        input.budgetCheck !== undefined &&
        input.budgetCheck.observed > input.budgetCheck.limit
      ) {
        return yield* new BudgetExceeded(input.budgetCheck);
      }
      if (
        input.expiresAt !== undefined &&
        input.expiresAt - updatedAt > maxPolicyExpiryMs
      ) {
        return yield* new BudgetExceeded({
          budget: "policyExpiryMs",
          limit: maxPolicyExpiryMs,
          observed: input.expiresAt - updatedAt,
        });
      }
      if (current.state === "disabled" && input.state === "paused") {
        return yield* new SubsystemDisabled({ subsystem: input.subsystem });
      }
      const next = nextOperationPolicy({
        current,
        requestedState: input.state,
        actorRole: access.role,
        reason: input.reason,
        ownerUserId: input.ownerUserId,
        idempotencyKey: input.idempotencyKey,
        ...(input.expectedGeneration === undefined
          ? {}
          : { expectedGeneration: input.expectedGeneration }),
        ...(input.expiresAt === undefined
          ? {}
          : { expiresAt: input.expiresAt }),
        now: updatedAt,
      });

      if (isOperationPolicyError(next)) return yield* next;

      yield* retireActiveOperationPolicy(
        reader,
        writer,
        input.workspaceId,
        input.subsystem,
        updatedAt,
      );
      yield* writer
        .table("policies")
        .insert(
          operationPolicyRecord({
            workspaceId: input.workspaceId,
            policy: next,
            updatedAt,
          }),
        )
        .pipe(Effect.orDie);
      yield* recordAccessAuditEvent(
        writer,
        operationPolicyAuditEvent({
          workspaceId: input.workspaceId,
          actorUserId: access.userId,
          policy: next,
          previousGeneration: current.generation,
          updatedAt,
        }),
        updatedAt,
      );

      return toPolicyReturn(input.workspaceId, next, updatedAt);
    }),
);

export const canOperateBrainPolicy = (role: Role): boolean =>
  roleAtLeast(role, "admin");

const maxPolicyExpiryMs = 90 * 24 * 60 * 60 * 1_000;

type LoadedOperationPolicy = {
  readonly policy: OperationPolicy;
  readonly updatedAt: number;
};

const loadOperationPolicies = (
  workspaceId: GenericId<"workspaces">,
  now: number,
): Effect.Effect<
  Map<OperationSubsystem, LoadedOperationPolicy>,
  never,
  DatabaseReader
> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("policies")
      .index("by_workspace_kind_status", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("kind", "agent.config")
          .eq("status", "active"),
      )
      .collect()
      .pipe(Effect.orDie);
    const policies = new Map<OperationSubsystem, LoadedOperationPolicy>();
    for (const subsystem of operationSubsystems) {
      policies.set(subsystem, {
        policy: defaultOperationPolicy(subsystem),
        updatedAt: 0,
      });
    }
    for (const row of rows) {
      if (!row.policyKey.startsWith(`brainOperation:${workspaceId}:`)) continue;
      const policy = operationPolicyFromRecord(row);
      const current = policies.get(policy.subsystem);
      if (
        !isExpiredOperationPolicy(policy, now) &&
        (current === undefined || policy.generation > current.policy.generation)
      ) {
        policies.set(policy.subsystem, {
          policy,
          updatedAt: row.activatedAt ?? 0,
        });
      }
    }

    return policies;
  });

type Reader = Context.Tag.Service<typeof DatabaseReader>;

const loadOperationPolicy = (
  reader: Reader,
  workspaceId: GenericId<"workspaces">,
  subsystem: OperationSubsystem,
  now: number,
): Effect.Effect<OperationPolicy, never> =>
  Effect.gen(function* () {
    const rows = yield* reader
      .table("policies")
      .index("by_policy_version", (q) =>
        q.eq("policyKey", operationPolicyKey(workspaceId, subsystem)),
      )
      .collect()
      .pipe(Effect.orDie);
    const row = rows
      .filter((candidate) => candidate.status === "active")
      .map((candidate) => ({
        policy: operationPolicyFromRecord(candidate),
      }))
      .filter((candidate) => !isExpiredOperationPolicy(candidate.policy, now))
      .sort(
        (left, right) => right.policy.generation - left.policy.generation,
      )[0];

    return row?.policy ?? defaultOperationPolicy(subsystem);
  });

const loadOperationPolicyReplay = (
  reader: Reader,
  workspaceId: GenericId<"workspaces">,
  subsystem: OperationSubsystem,
  idempotencyKey: string,
): Effect.Effect<LoadedOperationPolicy | undefined, never> =>
  Effect.gen(function* () {
    const rows = yield* reader
      .table("policies")
      .index("by_policy_version", (q) =>
        q.eq("policyKey", operationPolicyKey(workspaceId, subsystem)),
      )
      .collect()
      .pipe(Effect.orDie);
    const policies = rows.map((row) => operationPolicyFromRecord(row));
    const policy = replayOperationPolicyByIdempotencyKey(
      policies,
      idempotencyKey,
    );
    if (policy === undefined) return undefined;
    const row = rows.find(
      (candidate) =>
        operationPolicyFromRecord(candidate).generation === policy.generation,
    );

    return { policy, updatedAt: row?.activatedAt ?? 0 };
  });

const retireActiveOperationPolicy = (
  reader: Context.Tag.Service<typeof DatabaseReader>,
  writer: Context.Tag.Service<typeof DatabaseWriter>,
  workspaceId: GenericId<"workspaces">,
  subsystem: OperationSubsystem,
  retiredAt: number,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const existing = yield* reader
      .table("policies")
      .index("by_policy_version", (q) =>
        q.eq("policyKey", operationPolicyKey(workspaceId, subsystem)),
      )
      .collect()
      .pipe(Effect.orDie);

    for (const row of existing.filter(
      (candidate) => candidate.status === "active",
    )) {
      yield* writer
        .table("policies")
        .patch(row._id, { status: "retired", retiredAt })
        .pipe(Effect.orDie);
    }
  });

const isExpiredOperationPolicy = (
  policy: OperationPolicy,
  now: number,
): boolean => policy.expiresAt !== undefined && policy.expiresAt <= now;

const toPolicyReturn = (
  workspaceId: GenericId<"workspaces">,
  policy: OperationPolicy,
  updatedAt: number,
) => ({
  workspaceId,
  subsystem: policy.subsystem,
  state: policy.state,
  ownerUserId: (policy.ownerUserId ?? "users_system") as GenericId<"users">,
  reason: policy.reason ?? "Default operations policy is enabled.",
  generation: policy.generation,
  updatedAt,
  ...(policy.expiresAt === undefined ? {} : { expiresAt: policy.expiresAt }),
});

export default GroupImpl.make(databaseSchema, brainOperations).pipe(
  Layer.provide(listPolicies),
  Layer.provide(setPolicyInternal),
  GroupImpl.finalize,
);
