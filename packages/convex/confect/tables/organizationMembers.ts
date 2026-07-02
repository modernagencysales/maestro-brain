import { Table } from "@confect/server";

import { OrganizationMemberRow } from "../access/tenancySchemas";

export default Table.make(() => OrganizationMemberRow)
  .index("by_user", ["userId"])
  .index("by_organization_user", ["organizationId", "userId"])
  .index("by_organization_status", ["organizationId", "status"]);
