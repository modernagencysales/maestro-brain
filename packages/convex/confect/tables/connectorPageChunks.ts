import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { ContentHash, NonNegativeInteger } from "../brain/retrievalSchemas";

export const ConnectorPageChunkRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  connectorScopeKey: Schema.String,
  pageChunkKey: Schema.String.pipe(Schema.pattern(/^cchunk_[a-f0-9]{64}$/)),
  pageEnvelopeKey: Schema.String.pipe(Schema.pattern(/^cenv_[a-f0-9]{64}$/)),
  reconciliationRunKey: Schema.String.pipe(
    Schema.pattern(/^crun_[a-f0-9]{64}$/),
  ),
  chunkIndex: NonNegativeInteger,
  chunkDigest: ContentHash,
  observationCount: NonNegativeInteger,
  seenCount: NonNegativeInteger,
  obligationCount: NonNegativeInteger,
  commitDigest: ContentHash,
  committedAt: NonNegativeInteger,
});

export default Table.make(() => ConnectorPageChunkRow)
  .index("by_page_chunk_key", ["pageChunkKey"])
  .index("by_page_envelope_chunk", ["pageEnvelopeKey", "chunkIndex"])
  .index("by_run_page_chunk", ["reconciliationRunKey", "pageChunkKey"]);
