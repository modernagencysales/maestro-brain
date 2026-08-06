import { Table } from "@confect/server";

import { SourceUnitRevisionRow } from "../sources/sourceUnit";

export default Table.make(() => SourceUnitRevisionRow)
  .index("by_unit_revision_key", ["organizationKey", "unitRevisionKey"])
  .index("by_unit_created", ["organizationKey", "unitKey", "createdAt"]);
