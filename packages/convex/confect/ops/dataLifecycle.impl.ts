import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import { makeFunctionReference } from "convex/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
  StorageReader,
} from "../_generated/services";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import { ValidationFailed } from "../errors";
import {
  operationPolicyFromRecord,
  operationPolicyKey,
} from "./brainOperationPolicy";
import { sha256Hex } from "../shared/sha256";
import { requireBrainAccess } from "../brain/pages.impl";
import type { DsarRequestRowValue } from "../tables/dsarRequests";
import dataLifecycleSpec from "./dataLifecycle.spec";
import { buildWorkspaceDsarPlan } from "./dataLifecycle";
import type { BrainExportJobRowValue } from "../tables/brainExportJobs";
import { ExportForbidden } from "./dataLifecycle.spec";

const scheduleBrainExportRef = makeFunctionReference<
  "mutation",
  { jobId: string },
  { scheduled: boolean }
>("brain/exports:scheduleBrainExport");

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

const toBrainExportReturn = (row: BrainExportJobRowValue) => ({
  brainKey: row.brainKey,
  jobId: row.jobId,
  state: row.state,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
  ...(row.sizeBytes === undefined ? {} : { sizeBytes: row.sizeBytes }),
  ...(row.manifestHash === undefined ? {} : { manifestHash: row.manifestHash }),
  ...(row.artifactHash === undefined ? {} : { artifactHash: row.artifactHash }),
});

const requestBrainExport = FunctionImpl.make(
  databaseSchema,
  dataLifecycleSpec,
  "requestBrainExport",
  (input) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(input.brainKey, "admin");
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const organizationKey = String(brain.organizationId);
      const existing = yield* reader
        .table("brainExportJobs")
        .index("by_org_idempotency", (q) =>
          q
            .eq("organizationKey", organizationKey)
            .eq("idempotencyKey", input.idempotencyKey),
        )
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (existing !== null) return toBrainExportReturn(existing);
      const policyRows = yield* reader
        .table("policies")
        .index("by_policy_version", (q) =>
          q.eq("policyKey", operationPolicyKey(brain.workspaceId, "export")),
        )
        .collect()
        .pipe(Effect.orDie);
      const active = policyRows
        .filter((row) => row.status === "active")
        .sort((left, right) => right.version - left.version)[0];
      if (
        active !== undefined &&
        operationPolicyFromRecord(active).state === "disabled"
      )
        return yield* new ExportForbidden({
          reason: "Brain exports are disabled.",
        });
      const workspace = yield* reader
        .table("workspaces")
        .get(brain.workspaceId)
        .pipe(Effect.orDie);
      const createdAt = yield* unsafeAssumeClockProvided(
        Clock.currentTimeMillis,
      );
      const row = {
        schemaVersion: 1 as const,
        jobId: `brain-export:${sha256Hex(`${organizationKey}:${brain.workspaceId}:${input.idempotencyKey}`)}`,
        idempotencyKey: input.idempotencyKey,
        organizationKey,
        workspaceId: String(brain.workspaceId),
        brainKey: brain.brainKey,
        lifecycleGeneration:
          (workspace as { readonly lifecycleGeneration?: number } | null)
            ?.lifecycleGeneration ?? 1,
        policyGeneration: active?.version ?? 1,
        state: "requested" as const,
        createdAt,
        updatedAt: createdAt,
      };
      yield* writer.table("brainExportJobs").insert(row).pipe(Effect.orDie);
      const runMutation = yield* MutationRunner;
      yield* runMutation(scheduleBrainExportRef, { jobId: row.jobId });
      return toBrainExportReturn(row);
    }),
);

const getBrainExport = FunctionImpl.make(
  databaseSchema,
  dataLifecycleSpec,
  "getBrainExport",
  (input) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(input.brainKey, "viewer");
      const reader = yield* DatabaseReader;
      const row = yield* reader
        .table("brainExportJobs")
        .index("by_job_id", (q) => q.eq("jobId", input.jobId))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (row === null || row.brainKey !== brain.brainKey)
        return yield* new ValidationFailed({
          field: "jobId",
          message: "Export job is unavailable.",
        });
      return toBrainExportReturn(row);
    }),
);

const downloadBrainExport = FunctionImpl.make(
  databaseSchema,
  dataLifecycleSpec,
  "downloadBrainExport",
  (input) =>
    Effect.gen(function* () {
      const brain = yield* requireBrainAccess(input.brainKey, "viewer");
      const reader = yield* DatabaseReader;
      const row = yield* reader
        .table("brainExportJobs")
        .index("by_job_id", (q) => q.eq("jobId", input.jobId))
        .first()
        .pipe(Effect.map(Option.getOrNull), Effect.orDie);
      if (row === null || row.brainKey !== brain.brainKey)
        return yield* new ValidationFailed({
          field: "jobId",
          message: "Export job is unavailable.",
        });
      if (row.state !== "ready" || row.artifactId === undefined)
        return yield* new ValidationFailed({
          field: "jobId",
          message: "Export artifact is not ready.",
        });
      const workspace = yield* reader
        .table("workspaces")
        .get(brain.workspaceId)
        .pipe(Effect.orDie);
      const policyRows = yield* reader
        .table("policies")
        .index("by_policy_version", (q) =>
          q.eq("policyKey", operationPolicyKey(brain.workspaceId, "export")),
        )
        .collect()
        .pipe(Effect.orDie);
      const policyGeneration =
        policyRows
          .filter((policy) => policy.status === "active")
          .sort((left, right) => right.version - left.version)[0]?.version ?? 1;
      const now = yield* unsafeAssumeClockProvided(Clock.currentTimeMillis);
      if (
        row.expiresAt === undefined ||
        row.expiresAt <= now ||
        row.lifecycleGeneration !==
          ((workspace as { readonly lifecycleGeneration?: number } | null)
            ?.lifecycleGeneration ?? 1) ||
        row.policyGeneration !== policyGeneration
      )
        return yield* new ValidationFailed({
          field: "jobId",
          message: "Export artifact is unavailable.",
        });
      const storage = yield* StorageReader;
      const url = yield* storage.getUrl(row.artifactId as never).pipe(
        Effect.map(String),
        Effect.catchAll(() => Effect.succeed(null)),
      );
      if (url === null)
        return yield* new ValidationFailed({
          field: "jobId",
          message: "Export artifact is unavailable.",
        });
      return { ...toBrainExportReturn(row), downloadUrl: url };
    }),
);

export default GroupImpl.make(databaseSchema, dataLifecycleSpec).pipe(
  Layer.provide(createDsarRequest),
  Layer.provide(listDsarRequests),
  Layer.provide(requestBrainExport),
  Layer.provide(getBrainExport),
  Layer.provide(downloadBrainExport),
  GroupImpl.finalize,
);
