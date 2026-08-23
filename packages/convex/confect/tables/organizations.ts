import { Table } from "@confect/server";

import { OrganizationRow } from "../access/tenancySchemas";

export default Table.make(() => OrganizationRow)
  .index("by_slug", ["slug"])
  .index("by_owner", ["ownerUserId"])
  .index("by_status", ["status"]);
