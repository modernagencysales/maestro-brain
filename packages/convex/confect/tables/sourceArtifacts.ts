import { Table } from "@confect/server";

import { SourceArtifactRow } from "../sources/sourceSchemas";

export default Table.make(() => SourceArtifactRow)
  .index("by_channel_provider_object", ["channelKey", "providerObjectId"])
  .index("by_source_key", ["sourceKey"])
  .index("by_thread_key", ["organizationKey", "threadKey"])
  .index("by_lifecycle_purge_after", [
    "organizationKey",
    "lifecycle.state",
    "lifecycle.purgeAfter",
  ]);
