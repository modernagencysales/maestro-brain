import * as Effect from "effect/Effect";

import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { sha256Hex } from "../shared/sha256";

const migrationKey = (organizationKey: string) =>
  `tromstate_${sha256Hex(
    JSON.stringify({ kind: "transcript_revision_order", organizationKey }),
  )}`;

export const advanceTranscriptRevisionOrderPopulationEffect = (input: {
  readonly organizationKey: string;
  readonly now: number;
}): Effect.Effect<number, never, DatabaseReader | DatabaseWriter> =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const rows = yield* reader
      .table("transcriptRevisionOrderMigrations")
      .index("by_organization", (query) =>
        query.eq("organizationKey", input.organizationKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (rows.length > 1)
      return yield* Effect.dieMessage(
        "More than one transcript revision-order migration state exists for the organization.",
      );
    const row = rows[0];
    if (row === undefined) {
      yield* writer
        .table("transcriptRevisionOrderMigrations")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          migrationKey: migrationKey(input.organizationKey),
          sourcePopulationGeneration: 1,
          activeRunKey: null,
          activeRunGeneration: 0,
          activeStage: null,
          activeCursor: null,
          activeAdapterOrderVersion: null,
          scanHighWater: null,
          pinnedSourcePopulationGeneration: null,
          predecessorDigest: null,
          processedUnitCount: 0,
          backfilledUnitCount: 0,
          excludedUnitCount: 0,
          conflictCount: 0,
          terminalConflictKind: null,
          completion: null,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      return 1;
    }
    const nextGeneration = row.sourcePopulationGeneration + 1;
    yield* writer
      .table("transcriptRevisionOrderMigrations")
      .patch(row._id, {
        sourcePopulationGeneration: nextGeneration,
        updatedAt: input.now,
      })
      .pipe(Effect.orDie);
    return nextGeneration;
  });
