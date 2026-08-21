import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  NonNegativeInteger,
  PositiveInteger,
  RetrievalEligibilityFenceKey,
  RetrievalEligibilityFenceKind,
} from "../brain/retrievalSchemas";

export const RetrievalEligibilityFenceRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  fenceKey: RetrievalEligibilityFenceKey,
  kind: RetrievalEligibilityFenceKind,
  controllerKey: Schema.String,
  eligibilityGeneration: PositiveInteger,
  eligible: Schema.Boolean,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => RetrievalEligibilityFenceRow)
  .index("by_organization_fence", ["organizationKey", "fenceKey"])
  .index("by_organization_kind_controller", [
    "organizationKey",
    "kind",
    "controllerKey",
  ]);
