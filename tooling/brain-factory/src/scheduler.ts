import type { BrainTaskContract } from "./manifest.js";

export interface SelectionInput {
  readonly activeTaskIds: ReadonlySet<string>;
  readonly completedTaskIds: ReadonlySet<string>;
  readonly maximum: number;
  readonly requestedTaskIds?: ReadonlySet<string>;
  readonly tasks: readonly BrainTaskContract[];
}

export interface SelectionResult {
  readonly ready: readonly BrainTaskContract[];
  readonly selected: readonly BrainTaskContract[];
}

export const selectReadyTasks = ({
  activeTaskIds,
  completedTaskIds,
  maximum,
  requestedTaskIds = new Set(),
  tasks,
}: SelectionInput): SelectionResult => {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const heldLocks = new Set(
    [...activeTaskIds].flatMap((taskId) => byId.get(taskId)?.fileLocks ?? []),
  );
  const ready = tasks.filter(
    (task) =>
      task.fileInventoryStatus === "ready" &&
      task.kind !== "external" &&
      task.kind !== "release" &&
      (requestedTaskIds.size === 0 || requestedTaskIds.has(task.taskId)) &&
      !activeTaskIds.has(task.taskId) &&
      !completedTaskIds.has(task.taskId) &&
      task.codeStartAfter.every((dependency) =>
        completedTaskIds.has(dependency),
      ),
  );
  const selected: BrainTaskContract[] = [];
  for (const task of ready) {
    if (selected.length >= maximum) break;
    if (task.fileLocks.some((lock) => heldLocks.has(lock))) continue;
    selected.push(task);
    for (const lock of task.fileLocks) heldLocks.add(lock);
  }
  return { ready, selected };
};
