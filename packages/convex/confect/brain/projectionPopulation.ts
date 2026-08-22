import { DataModel, type DatabaseSchema } from "@confect/server";
import type { GenericDatabaseWriter } from "convex/server";
import type { GenericId } from "convex/values";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import databaseSchema from "../_generated/schema";
import { MutationCtx } from "../_generated/services";
import { sha256Hex } from "../shared/sha256";
import type brainProjectionPopulationSource from "../tables/brainProjectionPopulation";

type BrainProjectionPopulationTable = ReturnType<
  typeof brainProjectionPopulationSource<"brainProjectionPopulation">
>;
type ProjectionConfectDataModel = DataModel.FromTables<
  DatabaseSchema.Tables<typeof databaseSchema> | BrainProjectionPopulationTable
>;
type ProjectionDataModel = DataModel.ToConvex<ProjectionConfectDataModel>;
type ProjectionPopulationDoc = DataModel.DocumentWithName<
  ProjectionConfectDataModel,
  "brainProjectionPopulation"
>;
type ProjectionPopulationInsert = Omit<
  ProjectionPopulationDoc,
  "_creationTime" | "_id"
>;

const rawDatabase = (ctx: Effect.Effect.Success<typeof MutationCtx>) =>
  ctx.db as unknown as GenericDatabaseWriter<ProjectionDataModel>;

const projectionTableIsMissing = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("brainProjectionPopulation") &&
    (message.includes("table") || message.includes("Table"))
  );
};

class ProjectionPopulationLookupFailed extends Data.TaggedError(
  "ProjectionPopulationLookupFailed",
)<{ readonly cause: unknown }> {}

const loadPopulationIfTableExistsEffect = (input: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
}) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    return yield* Effect.tryPromise({
      try: () =>
        rawDatabase(ctx)
          .query("brainProjectionPopulation")
          .withIndex("by_workspace_brain", (query) =>
            query
              .eq("workspaceId", input.workspaceId)
              .eq("brainKey", input.brainKey),
          )
          .take(2),
      catch: (cause) => new ProjectionPopulationLookupFailed({ cause }),
    }).pipe(
      Effect.map((rows) => ({ kind: "available" as const, rows })),
      Effect.catchAll((error) =>
        projectionTableIsMissing(error.cause)
          ? Effect.succeed({ kind: "unavailable" as const })
          : Effect.die(error.cause),
      ),
    );
  });

/**
 * Advances the live population in the mutation that changes publication
 * eligibility. The unavailable branch only supports pre-codegen local schemas;
 * deployed schemas register brainProjectionPopulation before these writers.
 */
export const advanceProjectionPopulationForMutationEffect: (input: {
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly now: number;
}) => Effect.Effect<number | null, never, MutationCtx> = (input) =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const loaded = yield* loadPopulationIfTableExistsEffect(input);
    if (loaded.kind === "unavailable") return null;
    if (loaded.rows.length > 1)
      return yield* Effect.die(
        new Error(
          "More than one projection population row exists for the Brain.",
        ),
      );
    const stored = loaded.rows[0];
    if (stored !== undefined) {
      const nextGeneration = stored.projectionPopulationGeneration + 1;
      yield* Effect.promise(() =>
        rawDatabase(ctx).patch(stored._id, {
          projectionPopulationGeneration: nextGeneration,
          updatedAt: input.now,
        }),
      );
      return nextGeneration;
    }
    const row: ProjectionPopulationInsert = {
      schemaVersion: 1,
      organizationKey: input.organizationKey,
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      populationKey: `bpop_${sha256Hex(
        JSON.stringify({
          workspaceId: String(input.workspaceId),
          brainKey: input.brainKey,
        }),
      )}`,
      projectionPopulationGeneration: 1,
      subjectBackfillGeneration: 0,
      fenceBackfillGeneration: 0,
      activeRunKey: null,
      activeRunGeneration: 0,
      activePhase: null,
      activeStage: null,
      activeCursor: null,
      activeCorpusKey: null,
      activeConnectorScopeKey: null,
      activeConfigurationDigest: null,
      scanHighWater: null,
      catchUpHighWater: null,
      validationPopulationGeneration: null,
      validationPredecessorDigest: null,
      validationRestartCount: 0,
      scannedSetCount: 0,
      backfilledSetCount: 0,
      validatedSetCount: 0,
      validatedSubjectCount: 0,
      validatedEntryCount: 0,
      validatedTokenCount: 0,
      conflictCount: 0,
      capacityCount: 0,
      legacySubjectBackfillCompletion: null,
      currentFenceSetCount: 0,
      retiredFenceSetCount: 0,
      fenceBackfilledSetCount: 0,
      invalidatedFenceSetCount: 0,
      fenceConflictCount: 0,
      legacyEligibilityFenceBackfillCompletion: null,
      jobAuthorityMigrationRunKey: null,
      jobAuthorityMigrationRunGeneration: 0,
      jobAuthorityMigrationStage: null,
      jobAuthorityMigrationCursor: null,
      jobAuthorityMigrationConfigurationDigest: null,
      jobAuthorityMigrationScanHighWater: null,
      jobAuthorityMigrationPredecessorDigest: null,
      jobAuthorityMigrationProcessedCount: 0,
      jobAuthorityMigrationReplacementCount: 0,
      jobAuthorityMigrationCompleteAuthorityCount: 0,
      jobAuthorityMigrationTerminalHistoryCount: 0,
      jobAuthorityMigrationConflictCount: 0,
      legacyJobAuthorityMigrationCompletion: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    yield* Effect.promise(() =>
      rawDatabase(ctx).insert("brainProjectionPopulation", row),
    );
    return 1;
  });
