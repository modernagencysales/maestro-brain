import { CronJob, CronJobs } from "@confect/server";
import * as Duration from "effect/Duration";

import refs from "./_generated/refs";

export default CronJobs.make().add(
  CronJob.make(
    "recover Brain publication jobs",
    Duration.minutes(1),
    refs.internal.brain.retrievalPublication.sweepPublicationJobs,
    {
      limit: 20,
      caller: {
        kind: "system",
        name: "retrieval-publication-cron",
        surface: "internal",
      },
    },
  ),
);
