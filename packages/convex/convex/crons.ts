import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile approved Company Brain provider scopes",
  { hours: 1 },
  internal.integrations.connections.dispatchScheduledSyncs,
  {},
);

export default crons;
