import { Table } from "@confect/server";

import { ApiKeyRow } from "../headless/auth";

export default Table.make(() => ApiKeyRow)
  .index("by_key_hash", ["keyHash"])
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_status", ["workspaceId", "status"]);
