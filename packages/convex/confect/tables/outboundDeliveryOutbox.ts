import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

const AnswerCitation = Schema.Struct({
  sourceKey: Schema.String,
  label: Schema.String,
});

const AnswerPayload = Schema.Struct({
  format: Schema.Literal("mrkdwn"),
  text: Schema.String,
  citations: Schema.Array(AnswerCitation),
});

const LifecycleFence = Schema.Struct({
  organizationKey: Schema.String,
  workspaceId: Schema.String,
  brainKey: Schema.String,
  bindingKey: Schema.String,
  bindingGeneration: Schema.Number,
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  teamId: Schema.String,
  channelKey: Schema.String,
  deliveryGeneration: Schema.Number,
  operationGeneration: Schema.Number,
});

export const OutboundDeliveryOutboxRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  answerKey: Schema.String,
  answerReference: Schema.String,
  answer: AnswerPayload,
  requester: Schema.Struct({
    userId: Schema.String,
    slackUserId: Schema.String,
  }),
  delivery: Schema.Struct({
    organizationKey: Schema.String,
    workspaceId: Schema.String,
    brainKey: Schema.String,
    connectionKey: Schema.String,
    teamId: Schema.String,
    channelKey: Schema.String,
    externalChannelId: Schema.String,
  }),
  lifecycle: LifecycleFence,
  status: Schema.Literal(
    "pending",
    "in_flight",
    "retryable",
    "sent",
    "failed",
    "expired",
  ),
  attempt: Schema.Number,
  leaseToken: Schema.optional(Schema.String),
  leaseExpiresAt: Schema.optional(Schema.Number),
  lastError: Schema.optional(
    Schema.Struct({
      kind: Schema.Literal("retryable", "terminal"),
      code: Schema.String,
    }),
  ),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  sentAt: Schema.optional(Schema.Number),
});

export type OutboundDeliveryOutboxRowValue =
  typeof OutboundDeliveryOutboxRow.Type;

export default Table.make(() => OutboundDeliveryOutboxRow)
  .index("by_answer_key", ["answerKey"])
  .index("by_organization_status", ["organizationKey", "status"])
  .index("by_lease_expiry", ["status", "leaseExpiresAt"]);
