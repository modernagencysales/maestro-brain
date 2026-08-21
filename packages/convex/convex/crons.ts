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

const convexCrons = crons.convexCronJobs;
convexCrons.interval(
  "recover Slack publication target resolution",
  { minutes: 1 },
  sweepSlackPublicationTargets,
  { limit: 20 },
);

export default convexCrons;
