import { Table } from "@confect/server";

import { SourceSegmentRow } from "../sources/sourceUnit";

export default Table.make(() => SourceSegmentRow)
  .index("by_unit_revision_ordinal", [
    "organizationKey",
    "unitRevisionKey",
    "ordinal",
  ])
  .index("by_segment_key", ["organizationKey", "segmentKey"]);
