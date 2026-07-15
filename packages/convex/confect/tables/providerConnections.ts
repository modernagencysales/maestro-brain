import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const ProviderConnectionStatus = Schema.Literal(
  "authorizing",
  "verifying",
  "active",
  "error",
  "reauthorizing",
  "revoked",
);

const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String));
const OptionalNullableNumber = Schema.optional(Schema.NullOr(Schema.Number));

export const ProviderConnectionRow = Schema.Struct({
  provider: Schema.Literal("nango"),
  providerConfigKey: Schema.String,
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  status: ProviderConnectionStatus,
  connectSessionId: Schema.String,
  nangoConnectionId: OptionalNullableString,
  nangoEndUserId: Schema.String,
  nangoOrganizationId: Schema.String,
  correlationTag: Schema.String,
  attemptId: Schema.String,
  attemptExpiresAt: Schema.Number,
  completedAt: OptionalNullableNumber,
  teamId: OptionalNullableString,
  apiAppId: OptionalNullableString,
  botUserId: OptionalNullableString,
  errorReason: OptionalNullableString,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export type ProviderConnectionRowValue = typeof ProviderConnectionRow.Type;

export default Table.make(() => ProviderConnectionRow)
  .index("by_organization", ["organizationKey"])
  .index("by_connection_key", ["connectionKey"])
  .index("by_connect_session", ["connectSessionId"])
  .index("by_attempt", ["attemptId"])
  .index("by_nango_connection", ["nangoConnectionId"])
  .index("by_organization_provider_status", [
    "organizationKey",
    "provider",
    "providerConfigKey",
    "status",
  ]);
