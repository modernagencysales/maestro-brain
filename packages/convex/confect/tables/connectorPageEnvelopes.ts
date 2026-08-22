import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));

const PageChunkDescriptor = Schema.Struct({
  chunkIndex: NonNegativeInteger,
  chunkDigest: ContentHash,
  observationCount: NonNegativeInteger,
});

export const ConnectorPageEnvelopeRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.Literal("slack", "transcripts"),
  providerKind: Schema.Literal("slack", "transcript"),
  connectorScopeKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  pageEnvelopeKey: Schema.String.pipe(Schema.pattern(/^cenv_[a-f0-9]{64}$/)),
  reconciliationRunKey: Schema.String.pipe(
    Schema.pattern(/^crun_[a-f0-9]{64}$/),
  ),
  runGeneration: PositiveInteger,
  cursorKey: Schema.String.pipe(Schema.pattern(/^ccur_[a-f0-9]{64}$/)),
  expectedCursor: Schema.NullOr(Schema.String),
  expectedCursorGeneration: PositiveInteger,
  nextCursor: Schema.NullOr(Schema.String),
  providerHighWater: Schema.NullOr(Schema.String),
  ledgerHighWater: NonNegativeNumber,
  pageDigest: ContentHash,
  chunks: Schema.Array(PageChunkDescriptor).pipe(
    Schema.minItems(1),
    Schema.maxItems(64),
  ),
  createdAt: NonNegativeInteger,
});

export default Table.make(() => ConnectorPageEnvelopeRow)
  .index("by_page_envelope_key", ["pageEnvelopeKey"])
  .index("by_cursor_generation", ["cursorKey", "expectedCursorGeneration"])
  .index("by_run_page_envelope", ["reconciliationRunKey", "pageEnvelopeKey"]);
