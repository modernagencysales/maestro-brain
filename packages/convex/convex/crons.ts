import crons from "../confect/crons";
import { makeFunctionReference, type FunctionReference } from "convex/server";

const sweepSlackPublicationTargets = makeFunctionReference(
  "slack/ingress:sweepSlackPublicationTargets",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { limit: number },
  unknown
>;
const sweepIngestionObligations = makeFunctionReference(
  "integrations/providerReconciliation:sweepIngestionObligations",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { limit: number },
  unknown
>;
const sweepIngestionObligationRepairs = makeFunctionReference(
  "integrations/providerReconciliation:sweepIngestionObligationRepairs",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { limit: number },
  unknown
>;
const recoverReconciliationRuns = makeFunctionReference(
  "integrations/providerReconciliation:recoverReconciliationRuns",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { limit: number },
  unknown
>;
const recoverProviderReconciliationWorkers = makeFunctionReference(
  "integrations/providerReconciliationWorker:recoverProviderReconciliationWorkers",
) as unknown as FunctionReference<
  "action",
  "internal",
  { limit: number },
  unknown
>;

const convexCrons = crons.convexCronJobs;
convexCrons.interval(
  "recover Slack publication target resolution",
  { minutes: 1 },
  sweepSlackPublicationTargets,
  { limit: 20 },
);
convexCrons.interval(
  "progress ingestion obligations",
  { minutes: 1 },
  sweepIngestionObligations,
  { limit: 50 },
);
convexCrons.interval(
  "consume ingestion obligation repairs",
  { minutes: 1 },
  sweepIngestionObligationRepairs,
  { limit: 50 },
);
convexCrons.interval(
  "complete reconciled provider runs",
  { minutes: 1 },
  recoverReconciliationRuns,
  { limit: 50 },
);
convexCrons.interval(
  "recover provider reconciliation workers",
  { minutes: 1 },
  recoverProviderReconciliationWorkers,
  { limit: 50 },
);

export default convexCrons;
