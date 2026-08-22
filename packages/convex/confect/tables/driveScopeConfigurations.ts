import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonEmptyString = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(2_048),
);

export const DriveScopeConfigurationRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyString,
  workspaceId: Id("workspaces"),
  brainKey: NonEmptyString,
  connectorScopeKey: NonEmptyString,
  connectionKey: NonEmptyString,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  configurationGeneration: PositiveInteger,
  driveId: NonEmptyString,
  rootFolderIds: Schema.Array(NonEmptyString).pipe(
    Schema.minItems(1),
    Schema.maxItems(100),
  ),
  sharedDrive: Schema.Boolean,
  retentionClass: NonEmptyString,
  permissionPolicyDigest: ContentHash,
  configurationDigest: ContentHash,
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => DriveScopeConfigurationRow)
  .index("by_scope_tuple", [
    "connectorScopeKey",
    "connectionGeneration",
    "allowlistGeneration",
  ])
  .index("by_connection_scope", ["connectionKey", "connectorScopeKey"]);
