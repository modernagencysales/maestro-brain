import { Table } from "@confect/server";

import { ProviderEventReceiptRow } from "../sources/sourceSchemas";

export default Table.make(() => ProviderEventReceiptRow)
  .index("by_connection_transport_delivery", [
    "connectionKey",
    "transportDeliveryId",
  ])
  .index("by_connection_generation_transport_delivery", [
    "organizationKey",
    "connectionKey",
    "connectionGeneration",
    "transportDeliveryId",
  ])
  .index("by_observation_key", ["observationKey"])
  .index("by_received_at", ["organizationKey", "receivedAt"])
  .index("by_outcome", ["organizationKey", "outcome"]);
