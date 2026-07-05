import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  DsarDeletePlanEntrySchema,
  DsarExportManifestEntrySchema,
  DsarRequestKindSchema,
  DsarRequestStatusSchema,
  LegalHoldSchema,
} from "../ops/dataLifecycle";

export const DsarRequestRow = Schema.Struct({
  workspaceId: Schema.String,
  requestId: Schema.String,
  requestedByUserId: Schema.String,
  subjectId: Schema.optional(Schema.String),
  kind: DsarRequestKindSchema,
  status: DsarRequestStatusSchema,
  dryRunOnly: Schema.Literal(true),
  plannedAt: Schema.Number,
  confirmationPhrase: Schema.optional(Schema.String),
  legalHold: Schema.optional(LegalHoldSchema),
  exportManifest: Schema.Array(DsarExportManifestEntrySchema),
  deletePlan: Schema.Array(DsarDeletePlanEntrySchema),
});

export type DsarRequestRowValue = Schema.Schema.Type<typeof DsarRequestRow>;

export default Table.make(() => DsarRequestRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_request", ["workspaceId", "requestId"])
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_requested_by", ["requestedByUserId"]);
