import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { NotificationCategory } from "./notificationRecords";

export const NotificationPreferenceRow = Schema.Struct({
  workspaceId: Schema.String,
  recipientId: Schema.String,
  category: NotificationCategory,
  inApp: Schema.Boolean,
  email: Schema.Boolean,
  digest: Schema.Boolean,
  updatedAt: Schema.Number,
});

export default Table.make(() => NotificationPreferenceRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_recipient", ["workspaceId", "recipientId"])
  .index("by_recipient_category", ["workspaceId", "recipientId", "category"])
  .index("by_category", ["workspaceId", "category"]);
