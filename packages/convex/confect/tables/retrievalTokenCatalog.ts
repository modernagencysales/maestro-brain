import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { RETRIEVAL_TOKEN_CATALOG_SET_LIMIT } from "../brain/retrievalTokenCatalog";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
  RetrievalPublicationSetKey,
} from "../brain/retrievalSchemas";

const RetrievalTokenCatalogContribution = Schema.Struct({
  publicationSetKey: RetrievalPublicationSetKey,
  postingCount: PositiveInteger,
  postingDigest: ContentHash,
});

export const RetrievalTokenCatalogRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  tokenizerVersion: Schema.Literal(1),
  token: Schema.String,
  expectedPostingCount: PositiveInteger,
  expectedPostingDigest: ContentHash,
  contributions: Schema.Array(RetrievalTokenCatalogContribution).pipe(
    Schema.minItems(1),
    Schema.maxItems(RETRIEVAL_TOKEN_CATALOG_SET_LIMIT),
  ),
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => RetrievalTokenCatalogRow).index(
  "by_workspace_brain_token",
  ["workspaceId", "brainKey", "token"],
);
