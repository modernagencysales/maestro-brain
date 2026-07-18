import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type {
  ControllerSnapshot,
  ControllerTaskState,
  ControllerWaveState,
} from "./factory-state.js";
import { buildManifest } from "./manifest.js";
import { availableDispatchSlots, selectReadyTasks } from "./scheduler.js";

type JsonRecord = Record<string, unknown>;

export interface ControllerPolicy {
  readonly totalActiveCapacity: number;
  readonly maximumBatchSize: number;
  readonly minimumBatchSize: number;
}

export type ControllerActionKind =
  | "archive_terminal"
  | "recover_lane"
  | "promote_wave"
  | "recover_wave"
  | "integrate_batch"
  | "dispatch_tasks"
  | "wait";

export interface ControllerActionIdentity {
  readonly schemaVersion: "maestro-brain-controller-action/v1";
  readonly kind: ControllerActionKind;
  readonly controlHeadSha: string;
  readonly manifestSha256: string;
  readonly targetIds: readonly string[];
  readonly sourceRunIds: readonly string[];
  readonly sourceHeadShas: readonly string[];
  readonly findingSha256: string;
  readonly policySha256: string;
}

export interface ControllerAction extends ControllerActionIdentity {
  readonly actionId: string;
  readonly totalActiveCapacity: number;
}

export type ControllerActionReceiptStatus =
  "reserved" | "executing" | "succeeded" | "failed" | "superseded";

export interface ControllerActionReceipt {
  readonly schemaVersion: "maestro-brain-controller-action-receipt/v1";
  readonly actionId: string;
  readonly kind: ControllerActionKind;
  readonly status: ControllerActionReceiptStatus;
  readonly tickId: string;
  readonly exitCode?: number;
  readonly stdoutSha256?: string;
  readonly stderrSha256?: string;
  readonly providerErrorCategory?: string;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
};

export const canonicalControllerJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const digest = (value: unknown): string =>
  sha256(canonicalControllerJson(value));

const validatePolicy = (policy: ControllerPolicy): void => {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
  if (policy.minimumBatchSize > policy.maximumBatchSize) {
    throw new Error("minimumBatchSize cannot exceed maximumBatchSize");
  }
};

const values = (inputs: readonly (string | undefined)[]): readonly string[] =>
  [
    ...new Set(inputs.filter((value): value is string => value !== undefined)),
  ].sort();

const orderedValues = (
  inputs: readonly (string | undefined)[],
): readonly string[] => [
  ...new Set(inputs.filter((value): value is string => value !== undefined)),
];

const policyDigest = (policy: ControllerPolicy): string => digest(policy);

const makeAction = (input: {
  readonly findingSha256?: string;
  readonly kind: ControllerActionKind;
  readonly policy: ControllerPolicy;
  readonly snapshot: ControllerSnapshot;
  readonly sourceHeadShas?: readonly (string | undefined)[];
  readonly sourceRunIds?: readonly (string | undefined)[];
  readonly targetIds: readonly string[];
}): ControllerAction => {
  const identity: ControllerActionIdentity = {
    schemaVersion: "maestro-brain-controller-action/v1",
    kind: input.kind,
    controlHeadSha: input.snapshot.controlHeadSha,
    manifestSha256: input.snapshot.manifestSha256,
    targetIds: values(input.targetIds),
    sourceRunIds: values(input.sourceRunIds ?? []),
    sourceHeadShas: orderedValues(input.sourceHeadShas ?? []),
    findingSha256: input.findingSha256 ?? digest([]),
    policySha256: policyDigest(input.policy),
  };
  return {
    ...identity,
    actionId: digest(identity),
    totalActiveCapacity: input.policy.totalActiveCapacity,
  };
};

const taskAction = (
  kind: ControllerActionKind,
  task: ControllerTaskState,
  snapshot: ControllerSnapshot,
  policy: ControllerPolicy,
): ControllerAction =>
  makeAction({
    ...(task.findingSha256 === undefined
      ? {}
      : { findingSha256: task.findingSha256 }),
    kind,
    policy,
    snapshot,
    sourceHeadShas: [task.baseSha, task.headSha],
    sourceRunIds: [task.runId],
    targetIds: [task.taskId],
  });

const waveAction = (
  kind: ControllerActionKind,
  wave: ControllerWaveState,
  snapshot: ControllerSnapshot,
  policy: ControllerPolicy,
): ControllerAction =>
  makeAction({
    kind,
    policy,
    snapshot,
    sourceHeadShas: [wave.headSha],
    sourceRunIds: [wave.runId],
    targetIds: [wave.integrationId],
  });

const waitAction = (
  reasons: readonly string[],
  snapshot: ControllerSnapshot,
  policy: ControllerPolicy,
): ControllerAction =>
  makeAction({ kind: "wait", policy, snapshot, targetIds: reasons });

const activeTaskStages = new Set([
  "preparing",
  "running",
  "recoverable",
  "terminal",
  "lane_green",
  "false_green",
  "unknown",
]);

export const planControllerTick = (
  snapshot: ControllerSnapshot,
  policy: ControllerPolicy,
): readonly ControllerAction[] => {
  validatePolicy(policy);
  if (snapshot.schemaVersion !== "maestro-brain-controller-snapshot/v1") {
    throw new Error("unsupported controller snapshot schema");
  }

  const archives = snapshot.tasks
    .filter(({ stage }) => stage === "terminal")
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map((item) => taskAction("archive_terminal", item, snapshot, policy));
  const withFrontier = (
    action?: ControllerAction,
  ): readonly ControllerAction[] =>
    action ? [...archives, action] : archives.length > 0 ? archives : [];

  const recoverable = snapshot.tasks.find(
    ({ stage }) => stage === "recoverable",
  );
  if (recoverable) {
    return withFrontier(
      taskAction("recover_lane", recoverable, snapshot, policy),
    );
  }

  const providerReasons = snapshot.providerErrors.map(
    ({ category, provider }) => `provider_error:${provider}:${category}`,
  );
  if (providerReasons.length > 0) {
    return withFrontier(waitAction(providerReasons, snapshot, policy));
  }

  const activeWaves = snapshot.waves.filter(({ stage }) => stage !== "unknown");
  if (activeWaves.length > 1) {
    throw new Error(
      `simultaneous active integration waves: ${activeWaves
        .map(({ integrationId }) => integrationId)
        .join(", ")}`,
    );
  }
  const promotable = snapshot.waves.find(({ stage }) => stage === "promotable");
  if (promotable) {
    return withFrontier(
      waveAction("promote_wave", promotable, snapshot, policy),
    );
  }
  const failedWave = snapshot.waves.find(
    ({ stage }) => stage === "recoverable",
  );
  if (failedWave) {
    return withFrontier(
      waveAction("recover_wave", failedWave, snapshot, policy),
    );
  }
  const unresolvedWave = snapshot.waves[0];
  if (unresolvedWave) {
    return withFrontier(
      waitAction(
        [`integration_active:${unresolvedWave.integrationId}`],
        snapshot,
        policy,
      ),
    );
  }

  const falseGreen = snapshot.tasks.filter(
    ({ stage }) => stage === "false_green",
  );
  if (falseGreen.length > 0) {
    return withFrontier(
      waitAction(
        falseGreen.map(({ taskId }) => `false_green:${taskId}`),
        snapshot,
        policy,
      ),
    );
  }
  const unknownTasks = snapshot.tasks.filter(
    ({ stage }) => stage === "unknown",
  );
  if (unknownTasks.length > 0) {
    return withFrontier(
      waitAction(
        unknownTasks.map(({ taskId }) => `task_unknown:${taskId}`),
        snapshot,
        policy,
      ),
    );
  }

  if (snapshot.gateQueue.inUse >= snapshot.gateQueue.capacity) {
    return withFrontier(waitAction(["gate_queue_saturated"], snapshot, policy));
  }

  const green = snapshot.tasks.filter(({ stage }) => stage === "lane_green");
  if (green.length >= policy.minimumBatchSize) {
    const selected = green.slice(0, policy.maximumBatchSize);
    return withFrontier(
      makeAction({
        kind: "integrate_batch",
        policy,
        snapshot,
        sourceHeadShas: selected.map(({ headSha }) => headSha),
        sourceRunIds: selected.map(({ runId }) => runId),
        targetIds: selected.map(({ taskId }) => taskId),
      }),
    );
  }
  if (green.length > 0) {
    return withFrontier(
      waitAction(["integration_batch_below_minimum"], snapshot, policy),
    );
  }

  const activeTaskIds = new Set(
    snapshot.tasks
      .filter(({ stage }) => activeTaskStages.has(stage))
      .map(({ taskId }) => taskId),
  );
  const completedTaskIds = new Set(
    snapshot.tasks
      .filter(({ stage }) => stage === "integrated" || stage === "accepted")
      .map(({ taskId }) => taskId),
  );
  const pendingTaskIds = new Set(
    snapshot.tasks
      .filter(({ stage }) => stage === "pending")
      .map(({ taskId }) => taskId),
  );
  if (pendingTaskIds.size === 0) {
    return withFrontier(waitAction(["frontier_empty"], snapshot, policy));
  }
  const available = availableDispatchSlots(
    policy.totalActiveCapacity,
    activeTaskIds.size,
  );
  if (available === 0) {
    return withFrontier(
      waitAction(["dispatch_capacity_exhausted"], snapshot, policy),
    );
  }
  const selected = selectReadyTasks({
    activeTaskIds,
    completedTaskIds,
    maximum: available,
    requestedTaskIds: pendingTaskIds,
    tasks: buildManifest().tasks,
  }).selected;
  if (selected.length > 0) {
    return withFrontier(
      makeAction({
        kind: "dispatch_tasks",
        policy,
        snapshot,
        targetIds: selected.map(({ taskId }) => taskId),
      }),
    );
  }
  return withFrontier(waitAction(["frontier_empty"], snapshot, policy));
};

export const tickIdForController = (
  snapshot: ControllerSnapshot,
  policy: ControllerPolicy,
): string => {
  validatePolicy(policy);
  return digest({ policy, snapshot });
};

export const commandForControllerAction = (
  action: ControllerAction,
  stateRoot: string,
): readonly string[] | undefined => {
  const target = action.targetIds[0];
  switch (action.kind) {
    case "archive_terminal":
    case "wait":
      return undefined;
    case "recover_lane": {
      const base = action.sourceHeadShas[0];
      const head = action.sourceHeadShas.at(-1);
      if (!target || !base || !head)
        throw new Error("recover_lane coordinates missing");
      return [
        "pnpm",
        "brain:factory:resume",
        "--",
        "--task",
        target,
        "--ref",
        head,
        "--base",
        base,
        "--conflict-aware",
        "--state",
        stateRoot,
      ];
    }
    case "promote_wave":
      if (!target) throw new Error("promote_wave target missing");
      return [
        "pnpm",
        "brain:factory:promote-wave",
        "--",
        "--integration-id",
        target,
        "--state",
        stateRoot,
      ];
    case "recover_wave":
      if (!target) throw new Error("recover_wave target missing");
      return [
        "pnpm",
        "brain:factory:recover-wave",
        "--",
        "--integration-id",
        target,
        "--recovery-reason",
        `controller:${action.actionId}`,
        "--state",
        stateRoot,
      ];
    case "integrate_batch":
      return [
        "pnpm",
        "brain:factory:integrate-wave",
        "--",
        "--tasks",
        action.targetIds.join(","),
        "--state",
        stateRoot,
      ];
    case "dispatch_tasks":
      return [
        "pnpm",
        "brain:factory:dispatch",
        "--",
        "--launch",
        "--tasks",
        action.targetIds.join(","),
        "--max",
        String(action.totalActiveCapacity),
        "--state",
        stateRoot,
      ];
  }
};

const writeExclusive = (path: string, bytes: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "wx");
  try {
    writeFileSync(descriptor, bytes, "utf8");
  } finally {
    closeSync(descriptor);
  }
};

const stableBytes = (value: unknown): string =>
  `${canonicalControllerJson(value)}\n`;

const materializeImmutable = (
  path: string,
  value: unknown,
  label: string,
): void => {
  const bytes = stableBytes(value);
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== bytes) {
      throw new Error(`${label} identity collision at ${path}`);
    }
    return;
  }
  writeExclusive(path, bytes);
};

const receiptAt = (path: string): ControllerActionReceipt =>
  JSON.parse(readFileSync(path, "utf8")) as ControllerActionReceipt;

const validateReceiptIdentity = (
  receipt: ControllerActionReceipt,
  action: ControllerAction,
  tickId: string,
): void => {
  if (
    receipt.schemaVersion !== "maestro-brain-controller-action-receipt/v1" ||
    receipt.actionId !== action.actionId ||
    receipt.kind !== action.kind ||
    receipt.tickId !== tickId
  ) {
    throw new Error(`action receipt identity mismatch for ${action.actionId}`);
  }
  if (
    !new Set<ControllerActionReceiptStatus>([
      "reserved",
      "executing",
      "succeeded",
      "failed",
      "superseded",
    ]).has(receipt.status)
  ) {
    throw new Error(`action receipt status is invalid for ${action.actionId}`);
  }
};

const validReceiptTransition = (
  prior: ControllerActionReceiptStatus,
  next: ControllerActionReceiptStatus,
): boolean =>
  (prior === "reserved" &&
    new Set<ControllerActionReceiptStatus>([
      "executing",
      "succeeded",
      "failed",
      "superseded",
    ]).has(next)) ||
  (prior === "executing" &&
    new Set<ControllerActionReceiptStatus>([
      "succeeded",
      "failed",
      "superseded",
    ]).has(next));

const recoverPendingReceiptTransition = (
  path: string,
  receipt: ControllerActionReceipt,
  action: ControllerAction,
  tickId: string,
): ControllerActionReceipt => {
  const temporary = `${path}.next`;
  if (!existsSync(temporary)) return receipt;
  const pending = JSON.parse(
    readFileSync(temporary, "utf8"),
  ) as ControllerActionReceipt;
  validateReceiptIdentity(pending, action, tickId);
  if (!validReceiptTransition(receipt.status, pending.status)) {
    throw new Error(
      `invalid pending receipt transition for ${action.actionId}`,
    );
  }
  renameSync(temporary, path);
  return pending;
};

const transitionReceipt = (
  path: string,
  prior: ControllerActionReceipt,
  next: ControllerActionReceipt,
): void => {
  const current = readFileSync(path, "utf8");
  if (current !== stableBytes(prior)) {
    throw new Error(
      `action receipt changed concurrently for ${prior.actionId}`,
    );
  }
  const temporary = `${path}.next`;
  if (existsSync(temporary)) {
    if (readFileSync(temporary, "utf8") !== stableBytes(next)) {
      throw new Error(`pending action receipt conflicts for ${prior.actionId}`);
    }
    renameSync(temporary, path);
    return;
  }
  writeFileSync(temporary, stableBytes(next), { encoding: "utf8", flag: "wx" });
  renameSync(temporary, path);
};

export interface ControllerReconciliation {
  readonly kind: "not-started" | "succeeded" | "unresolved";
}

export interface ControllerCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly providerErrorCategory?: string;
}

export const executeControllerTick = (input: {
  readonly action: ControllerAction;
  readonly afterReceiptTransition?: (receipt: ControllerActionReceipt) => void;
  readonly now: string;
  readonly observe: () => ControllerSnapshot;
  readonly plannedSnapshot: ControllerSnapshot;
  readonly policy: ControllerPolicy;
  readonly reconcile: (action: ControllerAction) => ControllerReconciliation;
  readonly run: (
    command: readonly string[] | undefined,
    action: ControllerAction,
  ) => ControllerCommandResult;
  readonly stateRoot: string;
}): ControllerActionReceipt => {
  const tickId = tickIdForController(input.plannedSnapshot, input.policy);
  const plannedActions = planControllerTick(
    input.plannedSnapshot,
    input.policy,
  );
  const plannedAction = plannedActions.find(
    ({ actionId }) => actionId === input.action.actionId,
  );
  if (!plannedAction) {
    throw new Error(
      `action ${input.action.actionId} is not present in planned tick ${tickId}`,
    );
  }
  if (
    canonicalControllerJson(plannedAction) !==
    canonicalControllerJson(input.action)
  ) {
    throw new Error(
      `action bytes differ from planned tick for ${input.action.actionId}`,
    );
  }
  const tick = {
    schemaVersion: "maestro-brain-controller-tick/v1",
    tickId,
    snapshotSha256: digest(input.plannedSnapshot),
    actions: plannedActions,
  };
  const tickPath = join(
    input.stateRoot,
    "controller",
    "ticks",
    `${tickId}.json`,
  );
  materializeImmutable(tickPath, tick, "controller tick");

  const receiptPath = join(
    input.stateRoot,
    "controller",
    "actions",
    `${input.action.actionId}.json`,
  );
  let receipt: ControllerActionReceipt;
  if (existsSync(receiptPath)) {
    receipt = receiptAt(receiptPath);
    validateReceiptIdentity(receipt, input.action, tickId);
    receipt = recoverPendingReceiptTransition(
      receiptPath,
      receipt,
      input.action,
      tickId,
    );
    if (
      receipt.status === "succeeded" ||
      receipt.status === "failed" ||
      receipt.status === "superseded"
    ) {
      return receipt;
    }
  } else {
    receipt = {
      schemaVersion: "maestro-brain-controller-action-receipt/v1",
      actionId: input.action.actionId,
      kind: input.action.kind,
      status: "reserved",
      tickId,
    };
    writeExclusive(receiptPath, stableBytes(receipt));
    input.afterReceiptTransition?.(receipt);
  }

  const observedTickId = tickIdForController(input.observe(), input.policy);
  if (observedTickId !== tickId) {
    const next = { ...receipt, status: "superseded" } as const;
    transitionReceipt(receiptPath, receipt, next);
    input.afterReceiptTransition?.(next);
    return next;
  }

  const priorResult = input.reconcile(input.action);
  if (priorResult.kind === "succeeded") {
    const next = { ...receipt, status: "succeeded" } as const;
    transitionReceipt(receiptPath, receipt, next);
    input.afterReceiptTransition?.(next);
    return next;
  }
  if (priorResult.kind === "unresolved") return receipt;

  if (receipt.status === "reserved") {
    const next = { ...receipt, status: "executing" } as const;
    transitionReceipt(receiptPath, receipt, next);
    receipt = next;
    input.afterReceiptTransition?.(receipt);
  }

  const result = input.run(
    commandForControllerAction(input.action, input.stateRoot),
    input.action,
  );
  const proved = input.reconcile(input.action).kind === "succeeded";
  const next: ControllerActionReceipt = {
    ...receipt,
    status: result.exitCode === 0 && proved ? "succeeded" : "failed",
    exitCode: result.exitCode,
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
    ...(result.providerErrorCategory
      ? { providerErrorCategory: result.providerErrorCategory }
      : {}),
  };
  transitionReceipt(receiptPath, receipt, next);
  input.afterReceiptTransition?.(next);
  return next;
};

export interface ControllerTelemetry {
  readonly schemaVersion: "maestro-brain-controller-telemetry/v1";
  readonly at: string;
  readonly tickId: string;
  readonly actionId: string;
  readonly actionKind: ControllerActionKind;
  readonly durationMs: number;
  readonly outcome: string;
  readonly readyToLaunchLatencyMs: number;
  readonly activeCounts: Readonly<Record<string, number>>;
  readonly gateQueue: ControllerSnapshot["gateQueue"];
  readonly providerErrorCategories: readonly string[];
}

export const telemetryForControllerAction = (input: {
  readonly action: ControllerAction;
  readonly durationMs: number;
  readonly now: string;
  readonly outcome: string;
  readonly readyToLaunchLatencyMs: number;
  readonly snapshot: ControllerSnapshot;
  readonly tickId: string;
}): ControllerTelemetry => {
  for (const [label, value] of [
    ["durationMs", input.durationMs],
    ["readyToLaunchLatencyMs", input.readyToLaunchLatencyMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
  }
  const activeCounts: Record<string, number> = {};
  for (const item of input.snapshot.tasks) {
    if (!activeTaskStages.has(item.stage)) continue;
    activeCounts[item.stage] = (activeCounts[item.stage] ?? 0) + 1;
  }
  return {
    schemaVersion: "maestro-brain-controller-telemetry/v1",
    at: input.now,
    tickId: input.tickId,
    actionId: input.action.actionId,
    actionKind: input.action.kind,
    durationMs: input.durationMs,
    outcome: input.outcome,
    readyToLaunchLatencyMs: input.readyToLaunchLatencyMs,
    activeCounts,
    gateQueue: { ...input.snapshot.gateQueue },
    providerErrorCategories: input.snapshot.providerErrors.map(
      ({ category, provider }) => `${provider}:${category}`,
    ),
  };
};
