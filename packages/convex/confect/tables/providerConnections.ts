import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";
import {
  providerConnectionStatuses,
  providerKeys,
} from "../integrations/connectionLifecycle";

export const CurrentProviderConnectionRow = Schema.Struct({
  workspaceId: Id("workspaces"),
  provider: Schema.Literals(providerKeys),
  status: Schema.Literals(providerConnectionStatuses),
  generation: Schema.Number,
  connectionRef: Schema.optional(Schema.NonEmptyString),
  errorCode: Schema.optional(Schema.NonEmptyString),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

const LegacyProviderConnectionStatus = Schema.Literals([
  "authorizing",
  "verifying",
  "active",
  "error",
  "reauthorizing",
  "revoked",
]);
const LegacyOptionalNullableString = Schema.optional(
  Schema.NullOr(Schema.String),
);
const LegacyOptionalNullableNumber = Schema.optional(
  Schema.NullOr(Schema.Number),
);

export const LegacyProviderConnectionRow = Schema.Struct({
  provider: Schema.Literal("nango"),
  providerConfigKey: Schema.String,
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  status: LegacyProviderConnectionStatus,
  previousStatus: Schema.optional(
    Schema.NullOr(LegacyProviderConnectionStatus),
  ),
  connectSessionId: Schema.String,
  nangoConnectionId: LegacyOptionalNullableString,
  nangoEndUserId: Schema.String,
  nangoOrganizationId: Schema.String,
  correlationTag: Schema.String,
  attemptId: Schema.String,
  attemptExpiresAt: Schema.Number,
  completedAt: LegacyOptionalNullableNumber,
  teamId: LegacyOptionalNullableString,
  apiAppId: LegacyOptionalNullableString,
  botUserId: LegacyOptionalNullableString,
  errorReason: LegacyOptionalNullableString,
  purgeRequestedAt: LegacyOptionalNullableNumber,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export const ProviderConnectionRow = Schema.Union([
  CurrentProviderConnectionRow,
  LegacyProviderConnectionRow,
]);

// Workspace provider authorization and redacted connection status. The legacy
// Nango attempt branch remains readable until those rows are migrated.
export default Table.make(() => ProviderConnectionRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_and_provider", ["workspaceId", "provider"])
  .index("by_workspace_and_status", ["workspaceId", "status"])
  .index("by_organization", ["organizationKey"])
  .index("by_organization_status", ["organizationKey", "status"])
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
