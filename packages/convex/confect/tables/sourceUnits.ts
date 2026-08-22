import { Table } from "@confect/server";

import { SourceUnitRow } from "../sources/sourceUnit";

export default Table.make(() => SourceUnitRow)
  .index("by_org_connection_external", [
    "organizationKey",
    "connectionKey",
    "connectionGeneration",
    "providerKey",
    "externalCallId",
  ])
  .index("by_unit_key", ["organizationKey", "unitKey"])
  .index("by_org_connection_generation_unit_key", [
    "organizationKey",
    "connectionKey",
    "connectionGeneration",
    "unitKey",
  ])
  .index("by_org_current_state", ["organizationKey", "lifecycle.state"])
  .index("by_organization_updated", ["organizationKey", "updatedAt"]);
