import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const CallRouteMappingRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  mappingKey: Schema.String,
  kind: Schema.Literal("recurring_meeting", "email", "domain", "stakeholder"),
  value: Schema.String,
  brainKey: Schema.String,
  status: Schema.Literal("active", "revoked"),
  learnedFromProposalKey: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export default Table.make(() => CallRouteMappingRow)
  .index("by_org_kind_value", ["organizationKey", "kind", "value"])
  .index("by_org_status", ["organizationKey", "status"])
  .index("by_org_brain_status", ["organizationKey", "brainKey", "status"])
  .index("by_mapping_key", ["organizationKey", "mappingKey"]);
