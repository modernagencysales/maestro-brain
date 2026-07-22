import type {
  BrainTaskContract,
  ClassifiedCodeStartDependency,
  ProjectedBrainTaskContract,
  TaskCollisionMetadata,
} from "./manifest.js";

export interface SelectionInput {
  readonly activeTaskIds: ReadonlySet<string>;
  readonly completedTaskIds: ReadonlySet<string>;
  readonly contractArtifactSha256ByProducer?: ReadonlyMap<string, string>;
  readonly greenTaskIds?: ReadonlySet<string>;
  readonly maximum: number;
  readonly requestedTaskIds?: ReadonlySet<string>;
  readonly tasks: readonly BrainTaskContract[];
  readonly task6RegistryReady?: boolean;
}

export interface SchedulerBlocker {
  readonly reasons: readonly string[];
  readonly taskId: string;
}

export interface SelectionResult {
  readonly activeSerializedPaths: readonly string[];
  readonly blockers: readonly SchedulerBlocker[];
  readonly limitingTrueEdges: readonly string[];
  readonly mandatoryIntegrationGroups: readonly (readonly string[])[];
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
    for (const dependency of dependenciesFor(task)
      .filter((edge) => edge.classification === "true")
      .map((edge) => edge.producerTaskId)) {
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
  readonly atomicGroups: readonly ReadonlySet<string>[];
  readonly candidates: readonly BrainTaskContract[];
  readonly conflicts: (
    left: BrainTaskContract,
    right: BrainTaskContract,
  ) => boolean;
  readonly maximum: number;
  readonly preselectedTaskIds: ReadonlySet<string>;
  readonly weightedLevels: ReadonlyMap<string, number>;
}): readonly BrainTaskContract[] => {
  if (input.maximum <= 0) return [];
  const candidates = [...input.candidates].sort((left, right) =>
    left.taskId.localeCompare(right.taskId),
  );
  let best: readonly BrainTaskContract[] = [];
  let bestScore: SelectionScore | undefined;

  const visit = (
    index: number,
    selected: BrainTaskContract[],
    weightedBottomLevel: number,
  ): void => {
    if (index === candidates.length || selected.length === input.maximum) {
      const selectedIds = new Set([
        ...input.preselectedTaskIds,
        ...selected.map((task) => task.taskId),
      ]);
      if (
        input.atomicGroups.some((group) => {
          const count = [...group].filter((taskId) =>
            selectedIds.has(taskId),
          ).length;
          return count > 0 && count !== group.size;
        })
      ) {
        return;
      }
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
    visit(index + 1, selected, weightedBottomLevel);
    if (selected.some((other) => input.conflicts(task, other))) return;

    selected.push(task);
    visit(
      index + 1,
      selected,
      weightedBottomLevel + (input.weightedLevels.get(task.taskId) ?? 0),
    );
    selected.pop();
  };

  visit(0, [], 0);
  return best;
};

const isProjectedTask = (
  task: BrainTaskContract,
): task is ProjectedBrainTaskContract =>
  "classifiedCodeStartAfter" in task &&
  Array.isArray(task.classifiedCodeStartAfter) &&
  "collisions" in task &&
  Array.isArray(task.collisions);

const dependenciesFor = (
  task: BrainTaskContract,
): readonly ClassifiedCodeStartDependency[] =>
  isProjectedTask(task)
    ? task.classifiedCodeStartAfter
    : task.codeStartAfter.map((producerTaskId) => ({
        classification: "true" as const,
        consumerTaskId: task.taskId,
        producerTaskId,
      }));

const collisionBetween = (
  left: BrainTaskContract,
  right: BrainTaskContract,
): TaskCollisionMetadata | undefined =>
  isProjectedTask(left)
    ? left.collisions.find(
        (collision) => collision.otherTaskId === right.taskId,
      )
    : isProjectedTask(right)
      ? right.collisions.find(
          (collision) => collision.otherTaskId === left.taskId,
        )
      : undefined;

const sharesLock = (
  left: BrainTaskContract,
  right: BrainTaskContract,
): boolean => {
  const rightLocks = new Set(right.fileLocks);
  return left.fileLocks.some((lock) => rightLocks.has(lock));
};

const serializedCollision = (
  collision: TaskCollisionMetadata | undefined,
  task6RegistryReady: boolean,
): boolean =>
  collision?.policy === "serialize" ||
  collision?.policy === "dependency_order" ||
  (collision?.policy === "registry_after_task6" && !task6RegistryReady);

const schedulingConflict = (
  left: BrainTaskContract,
  right: BrainTaskContract,
  task6RegistryReady: boolean,
): boolean => {
  const collision = collisionBetween(left, right);
  return collision
    ? serializedCollision(collision, task6RegistryReady)
    : sharesLock(left, right);
};

const mandatoryGroups = (
  tasks: readonly BrainTaskContract[],
  task6RegistryReady: boolean,
): readonly ReadonlySet<string>[] => {
  const adjacency = new Map<string, Set<string>>();
  const taskIds = new Set(tasks.map((task) => task.taskId));
  for (const task of tasks) {
    const predecessor = task.mandatorySameWaveAfter;
    if (!predecessor || !taskIds.has(predecessor)) continue;
    const taskPeers = adjacency.get(task.taskId) ?? new Set<string>();
    const predecessorPeers = adjacency.get(predecessor) ?? new Set<string>();
    taskPeers.add(predecessor);
    predecessorPeers.add(task.taskId);
    adjacency.set(task.taskId, taskPeers);
    adjacency.set(predecessor, predecessorPeers);
  }
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    const left = tasks[leftIndex];
    if (!left) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < tasks.length;
      rightIndex += 1
    ) {
      const right = tasks[rightIndex];
      if (!right) continue;
      const collision = collisionBetween(left, right);
      const mandatory =
        collision?.policy === "same_wave_fail_closed" ||
        (collision?.policy === "registry_after_task6" && task6RegistryReady);
      if (!mandatory) continue;
      const leftPeers = adjacency.get(left.taskId) ?? new Set<string>();
      const rightPeers = adjacency.get(right.taskId) ?? new Set<string>();
      leftPeers.add(right.taskId);
      rightPeers.add(left.taskId);
      adjacency.set(left.taskId, leftPeers);
      adjacency.set(right.taskId, rightPeers);
    }
  }
  const groups: ReadonlySet<string>[] = [];
  const seen = new Set<string>();
  for (const taskId of [...adjacency.keys()].sort()) {
    if (seen.has(taskId)) continue;
    const group = new Set<string>([taskId]);
    const queue = [taskId];
    seen.add(taskId);
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      for (const peer of [...(adjacency.get(current) ?? [])].sort()) {
        group.add(peer);
        if (!seen.has(peer)) {
          seen.add(peer);
          queue.push(peer);
        }
      }
    }
    groups.push(group);
  }
  return groups;
};

const contractReason = (
  edge: Extract<ClassifiedCodeStartDependency, { classification: "contract" }>,
  artifacts: ReadonlyMap<string, string> | undefined,
): string | undefined => {
  const actual = artifacts?.get(edge.producerTaskId);
  const identity = `${edge.producerTaskId} task-packet ${edge.artifact.path}#${edge.artifact.anchor}`;
  return actual === edge.artifact.sha256
    ? undefined
    : actual === undefined
      ? `${identity} expected ${edge.artifact.sha256} is missing`
      : `${identity} expected ${edge.artifact.sha256}, got ${actual}`;
};

const isTrueDependencyProducer = (
  producerTaskId: string,
  consumer: BrainTaskContract,
): boolean =>
  dependenciesFor(consumer).some(
    (edge) =>
      edge.classification === "true" && edge.producerTaskId === producerTaskId,
  );

export const frontierDiagnostics = (result: SelectionResult): string =>
  [
    `ready width: ${result.ready.length}`,
    `limiting true edges: ${result.limitingTrueEdges.join(", ") || "none"}`,
    `active serialized paths: ${result.activeSerializedPaths.join(", ") || "none"}`,
  ].join("\n");

export const selectReadyTasks = ({
  activeTaskIds,
  completedTaskIds,
  contractArtifactSha256ByProducer,
  greenTaskIds = new Set(),
  maximum,
  requestedTaskIds = new Set(),
  tasks,
  task6RegistryReady = false,
}: SelectionInput): SelectionResult => {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const activeTasks = [...activeTaskIds]
    .map((taskId) => byId.get(taskId))
    .filter((task): task is BrainTaskContract => task !== undefined);
  const blockerMap = new Map<string, string[]>();
  const limitingTrueEdges = new Set<string>();
  const activeSerializedPaths = new Set<string>();
  const otherwiseEligible = tasks.filter((task) => {
    if (
      task.fileInventoryStatus === "ready" &&
      task.kind !== "external" &&
      task.kind !== "release" &&
      (task.kind !== "control" || task.greenHeadAfter !== undefined) &&
      !activeTaskIds.has(task.taskId) &&
      !completedTaskIds.has(task.taskId)
    ) {
      const reasons: string[] = [];
      if (
        task.greenHeadAfter !== undefined &&
        (!greenTaskIds.has(task.greenHeadAfter) ||
          !activeTaskIds.has(task.greenHeadAfter))
      ) {
        reasons.push(
          `green-head prerequisite ${task.greenHeadAfter} is not active`,
        );
      }
      for (const edge of dependenciesFor(task)) {
        if (edge.classification === "true") {
          if (!completedTaskIds.has(edge.producerTaskId)) {
            const reason = `${edge.consumerTaskId}<-${edge.producerTaskId}`;
            limitingTrueEdges.add(reason);
            reasons.push(`true dependency ${reason} is not integrated`);
          }
        } else {
          const reason = contractReason(edge, contractArtifactSha256ByProducer);
          if (reason) reasons.push(reason);
        }
      }
      for (const active of activeTasks) {
        const collision = collisionBetween(task, active);
        const activeConsumerAwaitsTask =
          collision?.policy === "dependency_order" &&
          isTrueDependencyProducer(task.taskId, active);
        if (
          serializedCollision(collision, task6RegistryReady) &&
          !activeConsumerAwaitsTask
        ) {
          const pair = [task.taskId, active.taskId].sort().join("|");
          for (const path of collision?.paths ?? []) {
            activeSerializedPaths.add(`${pair}:${path}`);
          }
          reasons.push(
            `${pair} is serialized on ${(collision?.paths ?? []).join(", ")}`,
          );
        } else if (!collision && sharesLock(task, active)) {
          reasons.push(
            `${task.taskId} shares a held legacy file lock with ${active.taskId}`,
          );
        }
      }
      if (reasons.length === 0) return true;
      blockerMap.set(task.taskId, reasons);
    }
    return false;
  });
  const groupsWithin = (
    taskIds: ReadonlySet<string>,
  ): readonly ReadonlySet<string>[] =>
    mandatoryGroups(
      tasks.filter((task) => taskIds.has(task.taskId)),
      task6RegistryReady,
    ).filter((group) => group.size > 1);
  const eligibleOrActiveIds = new Set([
    ...activeTaskIds,
    ...otherwiseEligible.map((task) => task.taskId),
  ]);
  const allReadyGroups = groupsWithin(eligibleOrActiveIds);
  if (requestedTaskIds.size > 0) {
    for (const group of allReadyGroups) {
      const requestable = [...group].filter(
        (taskId) => !activeTaskIds.has(taskId),
      );
      const requestedCount = requestable.filter((taskId) =>
        requestedTaskIds.has(taskId),
      ).length;
      if (requestedCount > 0 && requestedCount !== requestable.length) {
        throw new Error(
          `partial mandatory same-wave request: ${requestable.sort().join(",")}`,
        );
      }
    }
  }
  const ready = otherwiseEligible.filter(
    (task) => requestedTaskIds.size === 0 || requestedTaskIds.has(task.taskId),
  );
  const atomicGroups = groupsWithin(
    new Set([...activeTaskIds, ...ready.map((task) => task.taskId)]),
  );
  const selected = exactConflictFreeSelection({
    atomicGroups,
    candidates: ready,
    conflicts: (left, right) =>
      schedulingConflict(left, right, task6RegistryReady),
    maximum,
    preselectedTaskIds: activeTaskIds,
    weightedLevels: weightedBottomLevels(tasks, completedTaskIds),
  });
  const scheduled = [...activeTasks, ...selected];
  const mandatoryIntegrationGroups = groupsWithin(
    new Set(scheduled.map((task) => task.taskId)),
  ).map((group) => [...group].sort());
  return {
    activeSerializedPaths: [...activeSerializedPaths].sort(),
    blockers: [...blockerMap]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([taskId, reasons]) => ({ reasons: [...reasons].sort(), taskId })),
    limitingTrueEdges: [...limitingTrueEdges].sort(),
    mandatoryIntegrationGroups,
    ready,
    selected,
  };
};
