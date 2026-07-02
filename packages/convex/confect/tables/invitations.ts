import { Table } from "@confect/server";

import { InvitationRow } from "../access/tenancySchemas";

export default Table.make(() => InvitationRow)
  .index("by_token", ["tokenHash"])
  .index("by_email_status", ["email", "status"])
  .index("by_workspace_status", ["workspaceId", "status"]);
