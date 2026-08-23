import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import { ValidationFailed } from "../errors";
import type { DsarRequestRowValue } from "../tables/dsarRequests";
import dataLifecycleSpec from "./dataLifecycle.spec";
import { buildWorkspaceDsarPlan } from "./dataLifecycle";

const unsafeAssumeClockProvided = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

const createDsarRequest = FunctionImpl.make(
  databaseSchema,
  dataLifecycleSpec,
  "createDsarRequest",
  (input) =>
    Effect.gen(function* () {
      if (!input.requestId.trim()) {
        return yield* new ValidationFailed({
          field: "requestId",
          message: "DSAR request id is required.",
        });
      }

      const access = yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(input.workspaceId, "editor"),
      );
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const existing = yield* reader
        .table("dsarRequests")
        .index("by_workspace_request", (q) =>
          q
            .eq("workspaceId", input.workspaceId)
            .eq("requestId", input.requestId),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);

      if (existing !== null) {
        return toDsarRequestReturn(existing);
      }

      const plannedAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      const dsarPlan = buildWorkspaceDsarPlan({
        requestId: input.requestId,
        workspaceId: input.workspaceId,
        requestedBy: String(access.userId),
        ...(input.subjectId === undefined
          ? {}
          : { subjectId: input.subjectId }),
        kind: input.kind,
        now: plannedAt,
        ...(input.confirmationPhrase === undefined
          ? {}
          : { confirmationPhrase: input.confirmationPhrase }),
        ...(input.legalHold === undefined
          ? {}
          : { legalHold: input.legalHold }),
      });
      const row = {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
        requestedByUserId: access.userId,
        ...(input.subjectId === undefined
          ? {}
          : { subjectId: input.subjectId }),
        kind: input.kind,
        status: dsarPlan.status,
        dryRunOnly: true as const,
        plannedAt,
        ...(input.confirmationPhrase === undefined
          ? {}
          : { confirmationPhrase: input.confirmationPhrase }),
        ...(input.legalHold === undefined
          ? {}
          : { legalHold: input.legalHold }),
        exportManifest: dsarPlan.exportManifest,
        deletePlan: dsarPlan.deletePlan,
      };
      yield* writer.table("dsarRequests").insert(row).pipe(Effect.orDie);

      return {
        ...row,
        confirmation: dsarPlan.confirmation,
      };
    }),
);

const listDsarRequests = FunctionImpl.make(
  databaseSchema,
  dataLifecycleSpec,
  "listDsarRequests",
  ({ workspaceId }) =>
    Effect.gen(function* () {
      yield* unsafeAssumeClockProvided(
        requireWorkspaceAccess(workspaceId, "viewer"),
      );
      const reader = yield* DatabaseReader;
      const rows = yield* reader
        .table("dsarRequests")
        .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
        .pipe(Effect.orDie);

      return {
        requests: rows
          .map(toDsarRequestReturn)
          .sort((left, right) => left.requestId.localeCompare(right.requestId)),
      };
    }),
);

const toDsarRequestReturn = (row: DsarRequestRowValue) => ({
  workspaceId: row.workspaceId as GenericId<"workspaces">,
  requestId: row.requestId,
  requestedByUserId: row.requestedByUserId as GenericId<"users">,
  ...(row.subjectId === undefined ? {} : { subjectId: row.subjectId }),
  kind: row.kind,
  status: row.status,
  dryRunOnly: row.dryRunOnly,
  plannedAt: row.plannedAt,
  ...(row.confirmationPhrase === undefined
    ? {}
    : { confirmationPhrase: row.confirmationPhrase }),
  ...(row.legalHold === undefined ? {} : { legalHold: row.legalHold }),
  confirmation: {
    required: true as const,
    phrase: `delete ${row.workspaceId}`,
    reason: "workspace data deletion is destructive and audited",
  },
  exportManifest: row.exportManifest,
  deletePlan: row.deletePlan,
});

export default GroupImpl.make(databaseSchema, dataLifecycleSpec).pipe(
  Layer.provide(createDsarRequest),
  Layer.provide(listDsarRequests),
  GroupImpl.finalize,
);
