import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  FeedbackBrainKey,
  FeedbackCategory,
  FeedbackCitations,
  FeedbackDisposition,
  FeedbackEvaluationRerunKey,
  FeedbackIdempotencyKey,
  FeedbackReadiness,
  FeedbackReportKey,
  FeedbackRequestId,
  FeedbackSubmitter,
} from "../brain/feedbackSchema";
import { ContentHash, NonNegativeInteger } from "../brain/retrievalSchemas";

export const BrainFeedbackReportRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationId: Id("organizations"),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: FeedbackBrainKey,
  reportKey: FeedbackReportKey,
  idempotencyKey: FeedbackIdempotencyKey,
  payloadHash: ContentHash,
  requestId: FeedbackRequestId,
  candidateManifestHash: ContentHash,
  citations: FeedbackCitations,
  readiness: FeedbackReadiness,
  category: FeedbackCategory,
  disposition: FeedbackDisposition,
  evaluationRerunKey: Schema.optional(FeedbackEvaluationRerunKey),
  submittedBy: FeedbackSubmitter,
  createdAt: NonNegativeInteger,
});

export default Table.make(() => BrainFeedbackReportRow)
  .index("by_workspace_report", ["workspaceId", "reportKey"])
  .index("by_workspace_idempotency", ["workspaceId", "idempotencyKey"])
  .index("by_workspace_request", ["workspaceId", "requestId"])
  .index("by_workspace_brain_created", [
    "workspaceId",
    "brainKey",
    "createdAt",
  ]);
