import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const WorkspaceRow = Schema.Struct({
  organizationId: Schema.String,
  ownerUserId: Schema.String,
  brainKey: Schema.optional(Schema.String),
  slug: Schema.String,
  name: Schema.String,
  kind: Schema.optional(Schema.Literals(["agency", "client"])),
  clientSlug: Schema.optional(Schema.String),
  clientCreationIdempotencyKey: Schema.optional(Schema.String),
  clientCreationPayloadHash: Schema.optional(Schema.String),
  status: Schema.Literals(["active", "archived"]),
  dataClassification: Schema.Literals(["public", "internal", "confidential"]),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  lifecycleGeneration: Schema.optional(Schema.Number),
  revocationGeneration: Schema.optional(Schema.Number),
});

export default Table.make(() => WorkspaceRow)
  .index("by_slug", ["slug"])
  .index("by_organization", ["organizationId"])
  .index("by_owner", ["ownerUserId"])
  .index("by_organization_brain_key", ["organizationId", "brainKey"])
  .index("by_organization_kind", ["organizationId", "kind"])
  .index("by_organization_client_slug", ["organizationId", "clientSlug"])
  .index("by_organization_client_idempotency", [
    "organizationId",
    "clientCreationIdempotencyKey",
  ]);
