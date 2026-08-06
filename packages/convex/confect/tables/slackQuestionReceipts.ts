import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

const Scope = Schema.Struct({
  brainKey: Schema.String,
  workspaceId: Schema.String,
});

export const SlackQuestionReceiptRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  receiptKey: Schema.String,
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  providerEventId: Schema.String,
  state: Schema.Literal(
    "received",
    "scope_required",
    "scoped",
    "needs_clarification",
    "denied",
  ),
  requester: Schema.Struct({
    slackUserId: Schema.String,
    userId: Schema.String,
    bindingKey: Schema.String,
    bindingGeneration: Schema.Number,
    status: Schema.String,
  }),
  questionHash: Schema.String,
  scope: Schema.NullOr(Scope),
  reason: Schema.optional(Schema.String),
  availableBrainKeys: Schema.optional(Schema.Array(Schema.String)),
  receivedAt: Schema.Number,
  createdAt: Schema.Number,
});

export type SlackQuestionReceiptRowValue = typeof SlackQuestionReceiptRow.Type;

export default Table.make(() => SlackQuestionReceiptRow)
  .index("by_provider_event", ["organizationKey", "providerEventId"])
  .index("by_receipt_key", ["receiptKey"])
  .index("by_organization_state", ["organizationKey", "state"]);
