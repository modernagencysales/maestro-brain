import { Table } from "@confect/server";

import { AccessAuditEventRow } from "../access/tenancySchemas";

export default Table.make(() => AccessAuditEventRow)
  .index("by_workspace_created", ["workspaceId", "createdAt"])
  .index("by_subject", ["subjectKind", "subjectId"])
  .index("by_workspace_action", ["workspaceId", "action"]);
