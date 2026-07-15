import { Table } from "@confect/server";

import { ServicePrincipalRow } from "../headless/auth";

export default Table.make(() => ServicePrincipalRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_organization_status", ["organizationId", "status"])
  .index("by_principal_key", ["id"])
  .index("by_brain_status", ["workspaceId", "brainKey", "status"])
  .index("by_created_by", ["createdByUserId"]);
