import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { GenericId } from "convex/values";

import databaseSchema from "../_generated/schema";
import { roleAtLeast, type Role } from "../access/roles";
import brainOperations from "./brainOperations.spec";
import {
  nextOperationPolicy,
  operationSubsystems,
} from "./brainOperationPolicy";

const unsafeAssumeClockProvided = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const defaultOwnerUserId = "users_system" as GenericId<"users">;

const listPolicies = FunctionImpl.make(
  databaseSchema,
  brainOperations,
  "listPolicies",
  ({ workspaceId }) =>
    Effect.succeed({
      policies: operationSubsystems.map((subsystem) => ({
        workspaceId,
        subsystem,
        state: "enabled" as const,
        ownerUserId: defaultOwnerUserId,
        reason: "Default operations policy is enabled.",
        generation: 1,
        updatedAt: 0,
      })),
    }),
);

const setPolicyInternal = FunctionImpl.make(
  databaseSchema,
  brainOperations,
  "setPolicyInternal",
  (input) =>
    Effect.gen(function* () {
      const updatedAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      const current = {
        subsystem: input.subsystem,
        state: "enabled" as const,
        generation: input.expectedGeneration ?? 1,
      };
      const next = nextOperationPolicy({
        current,
        requestedState: input.state,
        actorRole: "admin",
        reason: input.reason,
        ownerUserId: input.ownerUserId,
        ...(input.expectedGeneration === undefined
          ? {}
          : { expectedGeneration: input.expectedGeneration }),
        ...(input.expiresAt === undefined
          ? {}
          : { expiresAt: input.expiresAt }),
        now: updatedAt,
      });

      return {
        workspaceId: input.workspaceId,
        subsystem: next.subsystem,
        state: next.state,
        ownerUserId: input.ownerUserId,
        reason: input.reason,
        generation: next.generation,
        updatedAt,
        ...(next.expiresAt === undefined ? {} : { expiresAt: next.expiresAt }),
      };
    }),
);

export const canOperateBrainPolicy = (role: Role): boolean =>
  roleAtLeast(role, "admin");

export default GroupImpl.make(databaseSchema, brainOperations).pipe(
  Layer.provide(listPolicies),
  Layer.provide(setPolicyInternal),
  GroupImpl.finalize,
);
