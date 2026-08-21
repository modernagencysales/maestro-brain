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
  .index("by_org_unit_key", ["organizationKey", "unitKey"])
  .index("by_org_current_state", ["organizationKey", "lifecycle.state"]);
