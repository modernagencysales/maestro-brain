import { Table } from "@confect/server";

import { ApiKeyStorageRow } from "../headless/auth";

export default Table.make(() => ApiKeyStorageRow)
  .index("by_key_hash", ["keyHash"])
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_principal", ["principalId"])
  .index("by_principal_status", ["principalId", "status"])
  .index("by_brain_status", ["workspaceId", "brainKey", "status"])
  .index("by_expiry", ["expiresAt"]);
