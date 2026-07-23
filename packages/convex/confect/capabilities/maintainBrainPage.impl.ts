import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { commitMaintenanceProposal } from "../maintenance/commit";
import { MaintenancePolicyError } from "../maintenance/policy";
import { requestMaintenanceProposal } from "../maintenance/request";
import { ValidationFailed } from "../errors";
import databaseSchema from "../_generated/schema";
import type { MaintainBrainPageInput } from "./maintainBrainPage.domain";
import {
  AutopilotNotEligible,
  CitationNotInManifest,
  CitationRequired,
  LifecycleRevoked,
  RevisionBudgetExceeded,
  StaleRevision,
} from "./maintainBrainPage.spec";
import maintainBrainPageGroup from "./maintainBrainPage.spec";

export const mapMaintenancePolicyError = (error: unknown) => {
  if (!(error instanceof MaintenancePolicyError)) return null;

  switch (error.name) {
    case "CitationRequired":
      return new CitationRequired();
    case "CitationNotInManifest":
      return new CitationNotInManifest({ citationKey: error.message });
    case "RevisionBudgetExceeded":
      return new RevisionBudgetExceeded({ limit: 0 });
    case "AutopilotNotEligible":
      return new AutopilotNotEligible({ reason: error.message });
    case "StaleRevision":
      return new StaleRevision({ proposalKey: error.message });
    case "LifecycleRevoked":
      return new LifecycleRevoked({ lifecycleGeneration: 0 });
  }
};

export const maintainBrainPageFromContextPack = (
  input: MaintainBrainPageInput,
) => {
  const proposal = requestMaintenanceProposal({
    context: input.context,
    modelOutput: input.modelOutput,
  });
  const committed = commitMaintenanceProposal({
    context: input.context,
    proposal,
    ...(input.autopilot ? { autopilot: input.autopilot } : {}),
  });
  return {
    proposalKey: committed.proposalKey,
    status: committed.status,
    citationKeys: proposal.citationKeys,
    revisionEffect:
      committed.revisionEffect === null
        ? null
        : {
            pageKey: committed.revisionEffect.pageKey,
            expectedRevisionKey: committed.revisionEffect.expectedRevisionKey,
            markdown: committed.revisionEffect.markdown,
            citationKeys: [...committed.revisionEffect.citationKeys],
          },
  };
};

const maintainBrainPageImpl = FunctionImpl.make(
  databaseSchema,
  maintainBrainPageGroup,
  "maintainBrainPage",
  (input) =>
    Effect.try({
      try: () => maintainBrainPageFromContextPack(input),
      catch: (error) =>
        mapMaintenancePolicyError(error) ??
        new ValidationFailed({
          field: "maintenance",
          message:
            error instanceof Error ? error.message : "Maintenance failed.",
        }),
    }),
);

export default GroupImpl.make(databaseSchema, maintainBrainPageGroup).pipe(
  Layer.provide(maintainBrainPageImpl),
  GroupImpl.finalize,
);
