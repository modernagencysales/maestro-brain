import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";
import {
  TranscriptAdapterOrderVersion,
  TranscriptRevisionOrderConflictKind,
} from "../sources/transcriptRevisionOrder";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));

export const TranscriptRevisionOrderMigrationStage = Schema.Literal(
  "scanning",
  "validating",
  "complete",
  "blocked",
);

export const TranscriptRevisionOrderMigrationCompletion = Schema.Struct({
  runKey: Schema.String.pipe(Schema.pattern(/^trom_[a-f0-9]{64}$/)),
  runGeneration: PositiveInteger,
  adapterOrderVersion: TranscriptAdapterOrderVersion,
  scanHighWater: NonNegativeNumber,
  sourcePopulationGeneration: NonNegativeInteger,
  populationDigest: ContentHash,
  processedUnitCount: NonNegativeInteger,
  backfilledUnitCount: NonNegativeInteger,
  excludedUnitCount: NonNegativeInteger,
  conflictCount: Schema.Literal(0),
  completedAt: NonNegativeInteger,
  completionDigest: ContentHash,
});

export const TranscriptRevisionOrderMigrationRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  migrationKey: Schema.String.pipe(Schema.pattern(/^tromstate_[a-f0-9]{64}$/)),
  sourcePopulationGeneration: NonNegativeInteger,
  activeRunKey: Schema.NullOr(
    Schema.String.pipe(Schema.pattern(/^trom_[a-f0-9]{64}$/)),
  ),
  activeRunGeneration: NonNegativeInteger,
  activeStage: Schema.NullOr(TranscriptRevisionOrderMigrationStage),
  activeCursor: Schema.NullOr(Schema.String),
  activeAdapterOrderVersion: Schema.NullOr(TranscriptAdapterOrderVersion),
  scanHighWater: Schema.NullOr(NonNegativeNumber),
  pinnedSourcePopulationGeneration: Schema.NullOr(NonNegativeInteger),
  predecessorDigest: Schema.NullOr(ContentHash),
  processedUnitCount: NonNegativeInteger,
  backfilledUnitCount: NonNegativeInteger,
  excludedUnitCount: NonNegativeInteger,
  conflictCount: NonNegativeInteger,
  terminalConflictKind: Schema.NullOr(TranscriptRevisionOrderConflictKind),
  completion: Schema.NullOr(TranscriptRevisionOrderMigrationCompletion),
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => TranscriptRevisionOrderMigrationRow)
  .index("by_organization", ["organizationKey"])
  .index("by_active_run_key", ["activeRunKey"]);
