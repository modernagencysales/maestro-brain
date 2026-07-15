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

// Source estimates intentionally omit tests and documentation. Give every task
// a small non-zero scheduling cost so a contract or documentation task that
// unlocks substantial product work is not treated as free or deprioritized.
export const MINIMUM_SCHEDULING_WEIGHT = 50;

interface SelectionScore {
  readonly cardinality: number;
  readonly taskIds: readonly string[];
  readonly weightedBottomLevel: number;
}

export const availableDispatchSlots = (
  totalActiveCapacity: number,
  activeTaskCount: number,
): number => {
  if (!Number.isInteger(totalActiveCapacity) || totalActiveCapacity < 1)
    throw new Error("total active capacity must be a positive integer");
  if (!Number.isInteger(activeTaskCount) || activeTaskCount < 0)
    throw new Error("active task count must be a non-negative integer");
  return Math.max(0, totalActiveCapacity - activeTaskCount);
};

const weightedBottomLevels = (
  tasks: readonly BrainTaskContract[],
  completedTaskIds: ReadonlySet<string>,
): ReadonlyMap<string, number> => {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const children = new Map(
    tasks.map((task) => [task.taskId, [] as string[]] as const),
  );
  for (const task of tasks) {
    for (const dependency of task.codeStartAfter) {
      children.get(dependency)?.push(task.taskId);
    }
  }

  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const levelFor = (taskId: string): number => {
    if (completedTaskIds.has(taskId)) return 0;
    const known = levels.get(taskId);
    if (known !== undefined) return known;
    if (visiting.has(taskId)) {
      throw new Error(`${taskId}: code-start dependency cycle`);
    }
    const task = byId.get(taskId);
    if (!task) return 0;
    visiting.add(taskId);
    const downstream = (children.get(taskId) ?? [])
      .filter((childId) => !completedTaskIds.has(childId))
      .map(levelFor);
    visiting.delete(taskId);
    const ownWeight = Math.max(
      MINIMUM_SCHEDULING_WEIGHT,
      task.estimatedSourceLines,
    );
    const value = ownWeight + (downstream.length ? Math.max(...downstream) : 0);
    levels.set(taskId, value);
    return value;
  };

  for (const task of tasks) levelFor(task.taskId);
  return levels;
};

const lexicographicallyEarlier = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
  for (let index = 0; index < left.length; index += 1) {
    const leftId = left[index];
    const rightId = right[index];
    if (leftId === rightId) continue;
    if (leftId === undefined) return true;
    if (rightId === undefined) return false;
    return leftId < rightId;
  }
  return left.length < right.length;
};

const isBetterScore = (
  candidate: SelectionScore,
  incumbent: SelectionScore | undefined,
): boolean => {
  if (!incumbent) return true;
  if (candidate.cardinality !== incumbent.cardinality) {
    return candidate.cardinality > incumbent.cardinality;
  }
  if (candidate.weightedBottomLevel !== incumbent.weightedBottomLevel) {
    return candidate.weightedBottomLevel > incumbent.weightedBottomLevel;
  }
  return lexicographicallyEarlier(candidate.taskIds, incumbent.taskIds);
};

const exactConflictFreeSelection = (input: {
  readonly candidates: readonly BrainTaskContract[];
  readonly heldLocks: ReadonlySet<string>;
  readonly maximum: number;
  readonly weightedLevels: ReadonlyMap<string, number>;
}): readonly BrainTaskContract[] => {
  if (input.maximum <= 0) return [];
  const candidates = [...input.candidates]
    .filter((task) => !task.fileLocks.some((lock) => input.heldLocks.has(lock)))
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
  let best: readonly BrainTaskContract[] = [];
  let bestScore: SelectionScore | undefined;

  const visit = (
    index: number,
    selected: BrainTaskContract[],
    selectedLocks: Set<string>,
    weightedBottomLevel: number,
  ): void => {
    if (index === candidates.length || selected.length === input.maximum) {
      const score = {
        cardinality: selected.length,
        taskIds: selected.map((task) => task.taskId),
        weightedBottomLevel,
      } satisfies SelectionScore;
      if (isBetterScore(score, bestScore)) {
        best = [...selected];
        bestScore = score;
      }
      return;
    }

    const task = candidates[index];
    if (!task) return;
    visit(index + 1, selected, selectedLocks, weightedBottomLevel);
    if (task.fileLocks.some((lock) => selectedLocks.has(lock))) return;

    selected.push(task);
    const addedLocks = task.fileLocks.filter(
      (lock) => !selectedLocks.has(lock),
    );
    for (const lock of addedLocks) selectedLocks.add(lock);
    visit(
      index + 1,
      selected,
      selectedLocks,
      weightedBottomLevel + (input.weightedLevels.get(task.taskId) ?? 0),
    );
    for (const lock of addedLocks) selectedLocks.delete(lock);
    selected.pop();
  };

  visit(0, [], new Set(), 0);
  return best;
};

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
  const selected = exactConflictFreeSelection({
    candidates: ready,
    heldLocks,
    maximum,
    weightedLevels: weightedBottomLevels(tasks, completedTaskIds),
  });
  return { ready, selected };
};
