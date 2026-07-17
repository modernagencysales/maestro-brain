import type { BrainTaskContract } from "./manifest.js";

export interface IntegrationWaveRequest {
  readonly preview: boolean;
  readonly requestedTaskIds?: readonly string[];
  readonly statePath?: string;
}

const valueFor = (
  args: readonly string[],
  index: number,
  flag: string,
): string => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

export const parseIntegrationWaveRequest = (
  args: readonly string[],
  knownTaskIds: ReadonlySet<string>,
): IntegrationWaveRequest => {
  let preview = false;
  let requestedTaskIds: readonly string[] | undefined;
  let statePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--" && index === 0) continue;
    if (flag === "--preview") {
      if (preview) throw new Error("--preview may be supplied only once");
      preview = true;
      continue;
    }
    if (flag === "--tasks") {
      if (requestedTaskIds !== undefined) {
        throw new Error("--tasks may be supplied only once");
      }
      const value = valueFor(args, index, flag);
      index += 1;
      const ids = value.split(",");
      if (
        ids.length === 0 ||
        ids.some((taskId) => !/^S\d{2}-T\d{2}$/.test(taskId))
      ) {
        throw new Error(
          "--tasks must be a comma-separated list of exact task IDs",
        );
      }
      if (new Set(ids).size !== ids.length) {
        throw new Error("--tasks contains duplicate task IDs");
      }
      const unknown = ids.filter((taskId) => !knownTaskIds.has(taskId));
      if (unknown.length > 0) {
        throw new Error(
          `--tasks contains unknown task IDs: ${unknown.join(", ")}`,
        );
      }
      requestedTaskIds = [...ids].sort();
      continue;
    }
    if (flag === "--state") {
      if (statePath !== undefined) {
        throw new Error("--state may be supplied only once");
      }
      statePath = valueFor(args, index, flag);
      index += 1;
      continue;
    }
    throw new Error(`unknown integrate-wave argument: ${flag ?? "<missing>"}`);
  }
  return {
    preview,
    ...(requestedTaskIds === undefined ? {} : { requestedTaskIds }),
    ...(statePath === undefined ? {} : { statePath }),
  };
};

export const integrationTasksForRequest = (
  tasks: readonly BrainTaskContract[],
  requestedTaskIds?: readonly string[],
): readonly BrainTaskContract[] => {
  if (requestedTaskIds === undefined) return tasks;
  const requested = new Set(requestedTaskIds);
  return tasks.filter((task) => requested.has(task.taskId));
};

export const requireRequestedCandidates = (
  requestedTaskIds: readonly string[] | undefined,
  candidateTaskIds: readonly string[],
): void => {
  if (requestedTaskIds === undefined) return;
  const candidates = new Set(candidateTaskIds);
  const missing = requestedTaskIds.filter((taskId) => !candidates.has(taskId));
  if (missing.length > 0) {
    throw new Error(
      `requested tasks are not integration-ready: ${missing.join(", ")}`,
    );
  }
};

export const previewOrLaunchIntegrationWave = <Preview, Launch>(input: {
  readonly launch: () => Launch;
  readonly preview: boolean;
  readonly previewValue: Preview;
}): Preview | Launch => (input.preview ? input.previewValue : input.launch());
