import type { WorkpoolComponent } from "@convex-dev/workpool";
import { makeFunctionReference } from "convex/server";

export const workpoolComponent = {
  config: {
    update: makeFunctionReference("workpool:config/update"),
  },
  lib: {
    cancel: makeFunctionReference("workpool:lib/cancel"),
    cancelAll: makeFunctionReference("workpool:lib/cancelAll"),
    enqueue: makeFunctionReference("workpool:lib/enqueue"),
    enqueueBatch: makeFunctionReference("workpool:lib/enqueueBatch"),
    status: makeFunctionReference("workpool:lib/status"),
    statusBatch: makeFunctionReference("workpool:lib/statusBatch"),
  },
} as unknown as WorkpoolComponent;
