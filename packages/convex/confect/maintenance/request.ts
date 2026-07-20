import {
  assertCitationMembership,
  assertRevisionBudget,
  requireActiveLifecycle,
  type MaintenanceContextPack,
  type MaintenanceProposalStatus,
} from "./policy";

export type MaintenanceModelOutput =
  | {
      readonly kind: "noop";
      readonly rationale: string;
      readonly citationKeys: readonly string[];
      readonly selfConfidence: number;
    }
  | {
      readonly kind: "revision";
      readonly title: string;
      readonly markdown: string;
      readonly citationKeys: readonly string[];
      readonly selfConfidence: number;
    };

export type MaintenanceProposal = {
  readonly proposalKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly pageKey: string;
  readonly expectedRevisionKey: string;
  readonly routeGeneration: number;
  readonly lifecycleGeneration: number;
  readonly policyGeneration: number;
  readonly modelPromptPair: string;
  readonly status: Extract<
    MaintenanceProposalStatus,
    "proposed_noop" | "awaiting_review"
  >;
  readonly citationKeys: readonly string[];
  readonly rationale?: string;
  readonly title?: string;
  readonly markdown?: string;
};

const proposalKeyFor = (
  context: MaintenanceContextPack,
  output: MaintenanceModelOutput,
): string =>
  [
    context.pageKey,
    context.currentRevisionKey,
    output.kind,
    context.modelPromptPair,
  ]
    .join(":")
    .replace(/[^a-zA-Z0-9:_-]/g, "_");

export const requestMaintenanceProposal = ({
  context,
  modelOutput,
}: {
  readonly context: MaintenanceContextPack;
  readonly modelOutput: MaintenanceModelOutput;
}): MaintenanceProposal => {
  requireActiveLifecycle(context);
  assertCitationMembership(context, modelOutput.citationKeys);

  const base = {
    proposalKey: proposalKeyFor(context, modelOutput),
    workspaceId: context.workspaceId,
    brainKey: context.brainKey,
    pageKey: context.pageKey,
    expectedRevisionKey: context.currentRevisionKey,
    routeGeneration: context.routeGeneration,
    lifecycleGeneration: context.lifecycleGeneration,
    policyGeneration: context.policyGeneration,
    modelPromptPair: context.modelPromptPair,
    citationKeys: modelOutput.citationKeys,
  } as const;

  if (modelOutput.kind === "noop") {
    return {
      ...base,
      status: "proposed_noop",
      rationale: modelOutput.rationale,
    };
  }

  assertRevisionBudget(context);
  return {
    ...base,
    status: "awaiting_review",
    title: modelOutput.title,
    markdown: modelOutput.markdown,
  };
};
