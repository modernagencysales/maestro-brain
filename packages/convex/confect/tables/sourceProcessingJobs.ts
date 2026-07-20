import { Table } from "@confect/server";

import { SourceProcessingJobRow } from "../sources/sourceSchemas";

export default Table.make(() => SourceProcessingJobRow)
  .index("by_stage_status_next_retry", ["stage", "status", "nextRetryAt"])
  .index("by_effect_key", ["effectKey"])
  .index("by_unit_stage", ["sourceUnitKey", "stage"])
  .index("by_lease_expiry", ["status", "leaseExpiresAt"])
  .index("by_organization_status", ["organizationKey", "status"]);
