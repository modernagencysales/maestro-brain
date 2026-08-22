import { CanonicalTranscriptRevisionOrder } from "@maestro-template/integrations/transcripts/canonical";
import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { ContentHash, PositiveInteger } from "../brain/retrievalSchemas";
import {
  TranscriptAdapterOrderVersion,
  TranscriptRevisionOrderConflictKind,
} from "../sources/transcriptRevisionOrder";

const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
);

export const TranscriptRevisionOrderMigrationItemRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  runKey: Schema.String.pipe(Schema.pattern(/^trom_[a-f0-9]{64}$/)),
  runGeneration: PositiveInteger,
  adapterOrderVersion: TranscriptAdapterOrderVersion,
  unitKey: Schema.String.pipe(Schema.pattern(/^sunit_[a-f0-9]{64}$/)),
  currentUnitRevisionKey: Schema.String.pipe(
    Schema.pattern(/^surev_[a-f0-9]{64}$/),
  ),
  observedContentHash: ContentHash,
  observedTombstone: Schema.Boolean,
  observedRevisionOrder: Schema.NullOr(CanonicalTranscriptRevisionOrder),
  classification: Schema.Literal("backfilled", "excluded", "conflict"),
  conflictKind: Schema.NullOr(TranscriptRevisionOrderConflictKind),
  historyCount: NonNegativeInteger,
  itemDigest: ContentHash,
  createdAt: NonNegativeInteger,
});

export default Table.make(() => TranscriptRevisionOrderMigrationItemRow)
  .index("by_run_unit", ["runKey", "unitKey"])
  .index("by_organization_run", ["organizationKey", "runKey"]);
