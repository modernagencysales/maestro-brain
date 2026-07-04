import type {
  WorkflowFlowModel,
  WorkflowFlowNode,
  WorkflowFlowNodeData,
  WorkflowNodeStatus,
  WorkflowNodeStatusOverlay,
  WorkflowStageKeyMap,
  WorkflowStageRunForCanvas,
  WorkflowStageStatus,
} from "./workflowCanvasState";

type WorkflowNodeOptionalData = Pick<
  WorkflowFlowNodeData,
  "capability" | "agent" | "delayMs"
>;

type UndefinedStripped<Value extends Record<string, unknown>> = {
  readonly [Key in keyof Value]?: Exclude<Value[Key], undefined>;
};

const compactUndefined = <Value extends Record<string, unknown>>(
  value: Value,
): UndefinedStripped<Value> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as UndefinedStripped<Value>;

const optionalNodeData = (
  data: WorkflowNodeOptionalData,
): Partial<WorkflowNodeOptionalData> =>
  compactUndefined({
    capability: data.capability,
    agent: data.agent,
    delayMs: data.delayMs,
  });

const resetRunData = (data: WorkflowFlowNodeData): WorkflowFlowNodeData => ({
  label: data.label,
  kind: data.kind,
  ...optionalNodeData(data),
  validationHints: data.validationHints,
});

const stageRunMetadata = (
  run: WorkflowStageRunForCanvas,
): Pick<WorkflowNodeStatusOverlay, "summary" | "errorCode"> =>
  compactUndefined({
    summary: run.summary ?? undefined,
    errorCode: run.errorCode ?? undefined,
  });

const overlayRunData = (
  overlay: WorkflowNodeStatusOverlay,
): Pick<WorkflowFlowNodeData, "runSummary" | "runErrorCode"> =>
  compactUndefined({
    runSummary: overlay.summary,
    runErrorCode: overlay.errorCode,
  });

export const mapWorkflowStageStatus = (
  status: WorkflowStageStatus,
): WorkflowNodeStatus => {
  switch (status) {
    case "succeeded":
    case "completed":
      return "completed";
    case "failed":
    case "canceled":
      return "failed";
    case "running":
      return "running";
    case "queued":
    case "skipped":
      return "pending";
  }
};

const latestRunWins = (
  run: WorkflowStageRunForCanvas,
  current: WorkflowStageRunForCanvas | undefined,
): boolean =>
  run.attemptNumber >= (current?.attemptNumber ?? Number.NEGATIVE_INFINITY);

const latestRunsByStageKey = (
  stageRuns: readonly WorkflowStageRunForCanvas[],
): ReadonlyMap<string, WorkflowStageRunForCanvas> => {
  const latestRuns = new Map<string, WorkflowStageRunForCanvas>();

  for (const run of stageRuns) {
    const current = latestRuns.get(run.stageKey);
    if (latestRunWins(run, current)) {
      latestRuns.set(run.stageKey, run);
    }
  }

  return latestRuns;
};

const mappedStageEntries = (
  stageMap: WorkflowStageKeyMap,
  nodeIds: ReadonlySet<string>,
): readonly (readonly [string, string])[] =>
  Object.entries(stageMap).filter(([, nodeId]) => nodeIds.has(nodeId));

const pendingOverlay = (nodeId: string): WorkflowNodeStatusOverlay => ({
  nodeId,
  status: "pending",
});

const stageRunOverlay = (
  nodeId: string,
  run: WorkflowStageRunForCanvas,
): WorkflowNodeStatusOverlay => ({
  nodeId,
  status: mapWorkflowStageStatus(run.status),
  ...stageRunMetadata(run),
});

const overlayForStageRun = (
  nodeId: string,
  run: WorkflowStageRunForCanvas | undefined,
): WorkflowNodeStatusOverlay =>
  run === undefined ? pendingOverlay(nodeId) : stageRunOverlay(nodeId, run);

export const mapStageRunsToOverlay = (
  stageRuns: readonly WorkflowStageRunForCanvas[],
  stageMap: WorkflowStageKeyMap,
  nodeIds: readonly string[],
): readonly WorkflowNodeStatusOverlay[] => {
  const latestRuns = latestRunsByStageKey(stageRuns);
  const nodeIdSet = new Set(nodeIds);

  return mappedStageEntries(stageMap, nodeIdSet).map(([stageKey, nodeId]) =>
    overlayForStageRun(nodeId, latestRuns.get(stageKey)),
  );
};

const overlayMapByNodeId = (
  overlays: readonly WorkflowNodeStatusOverlay[],
): ReadonlyMap<string, WorkflowNodeStatusOverlay> =>
  new Map(overlays.map((overlay) => [overlay.nodeId, overlay]));

const nodeWithOverlay = (
  node: WorkflowFlowNode,
  overlay: WorkflowNodeStatusOverlay,
): WorkflowFlowNode => ({
  ...node,
  data: {
    ...resetRunData(node.data),
    status: overlay.status,
    ...overlayRunData(overlay),
  },
});

const applyNodeOverlay = (
  node: WorkflowFlowNode,
  overlays: ReadonlyMap<string, WorkflowNodeStatusOverlay>,
): WorkflowFlowNode => {
  const overlay = overlays.get(node.id);
  return overlay === undefined ? node : nodeWithOverlay(node, overlay);
};

const modelWithStatusOverlays = (
  model: WorkflowFlowModel,
  overlays: readonly WorkflowNodeStatusOverlay[],
): WorkflowFlowModel => {
  const overlaysByNodeId = overlayMapByNodeId(overlays);

  return {
    ...model,
    nodes: model.nodes.map((node) => applyNodeOverlay(node, overlaysByNodeId)),
  };
};

export const applyStatusOverlay = (
  model: WorkflowFlowModel,
  overlays: readonly WorkflowNodeStatusOverlay[],
): WorkflowFlowModel =>
  overlays.length === 0 ? model : modelWithStatusOverlays(model, overlays);
