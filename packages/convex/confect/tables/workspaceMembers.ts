import { Table } from "@confect/server";

import { WorkspaceMemberRow } from "../access/tenancySchemas";

export default Table.make(() => WorkspaceMemberRow)
  .index("by_workspace_user", ["workspaceId", "userId"])
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_user", ["userId"]);
