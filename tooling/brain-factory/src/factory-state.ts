export interface LaneCompletionResult {
  readonly integrationHeadSha?: string;
  readonly status?: string;
}

export const completedTaskIdsForControlHead = (input: {
  readonly controlHead: string;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly resultFor: (taskId: string) => LaneCompletionResult | undefined;
  readonly taskIds: readonly string[];
}): ReadonlySet<string> => {
  const completed = new Set<string>();

  for (const taskId of input.taskIds) {
    const result = input.resultFor(taskId);
    if (!new Set(["integrated", "accepted"]).has(result?.status ?? "")) {
      continue;
    }

    const integrationHeadSha = result?.integrationHeadSha?.trim();
    if (!integrationHeadSha) {
      throw new Error(
        `${taskId}: ${result?.status} evidence has no integrationHeadSha; ` +
          "refusing to launch dependents",
      );
    }
    if (!input.isAncestor(integrationHeadSha, input.controlHead)) {
      throw new Error(
        `${taskId}: integration head ${integrationHeadSha} is not an ancestor ` +
          `of control HEAD ${input.controlHead}; merge the integration before dispatch`,
      );
    }

    completed.add(taskId);
  }

  return completed;
};

export interface IntegrationAttemptState {
  readonly existingArtifacts: readonly string[];
  readonly headSha?: string;
  readonly status?: string;
}

export const integrationIdForWave = (
  manifestTranche: string,
  wave: number,
): string => (wave === 1 ? manifestTranche : `${manifestTranche}-w${wave}`);

export const nextIntegrationId = (input: {
  readonly controlHead: string;
  readonly isAncestor: (ancestor: string, descendant: string) => boolean;
  readonly manifestTranche: string;
  readonly stateFor: (integrationId: string) => IntegrationAttemptState;
}): string => {
  for (let wave = 1; wave <= 1_000; wave += 1) {
    const integrationId = integrationIdForWave(input.manifestTranche, wave);
    const state = input.stateFor(integrationId);
    if (state.existingArtifacts.length === 0) return integrationId;

    if (state.status !== "passed") {
      throw new Error(
        `${integrationId}: latest integration attempt is unresolved ` +
          `(status ${state.status ?? "missing"}); existing state: ` +
          state.existingArtifacts.join(", "),
      );
    }

    const headSha = state.headSha?.trim();
    if (!headSha) {
      throw new Error(
        `${integrationId}: passed integration evidence has no headSha`,
      );
    }
    if (!input.isAncestor(headSha, input.controlHead)) {
      throw new Error(
        `${integrationId}: passed integration head ${headSha} is not an ` +
          `ancestor of control HEAD ${input.controlHead}; merge it before ` +
          "starting another wave",
      );
    }
  }

  throw new Error(`${input.manifestTranche}: integration wave limit exceeded`);
};
