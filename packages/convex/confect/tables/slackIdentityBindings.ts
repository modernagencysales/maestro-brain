import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const SlackIdentityBindingStatus = Schema.Literal(
  "pending_verification",
  "active",
  "revoked",
);

const NullableNumber = Schema.NullOr(Schema.Number);
const NullableString = Schema.NullOr(Schema.String);

export const SlackIdentityBindingRow = Schema.Struct({
  bindingKey: Schema.String,
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  teamId: Schema.String,
  slackUserId: Schema.String,
  userId: Schema.String,
  workosSubject: Schema.String,
  status: SlackIdentityBindingStatus,
  bindingGeneration: Schema.Number,
  nonceHash: Schema.String,
  intentExpiresAt: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  verifiedAt: NullableNumber,
  revokedAt: NullableNumber,
  revokeReason: NullableString,
});

export type SlackIdentityBindingRowValue = typeof SlackIdentityBindingRow.Type;

export default Table.make(() => SlackIdentityBindingRow)
  .index("by_binding_key", ["bindingKey"])
  .index("by_organization_user_status", ["organizationKey", "userId", "status"])
  .index("by_exact_slack_identity_status", [
    "organizationKey",
    "teamId",
    "slackUserId",
    "status",
  ])
  .index("by_connection_generation_status", [
    "connectionKey",
    "connectionGeneration",
    "status",
  ])
  .index("by_nonce_hash", ["nonceHash"]);
