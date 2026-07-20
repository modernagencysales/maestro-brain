import { Table } from "@confect/server";

import { SourceRevisionRow } from "../sources/sourceSchemas";

export default Table.make(() => SourceRevisionRow)
  .index("by_source_revision_key", ["sourceRevisionKey"])
  .index("by_source_provider_order", ["sourceKey", "providerOrder"])
  .index("by_source_created", ["organizationKey", "sourceCreatedAt"])
  .index("by_lifecycle_purge_after", [
    "organizationKey",
    "lifecycle.state",
    "lifecycle.purgeAfter",
  ]);
