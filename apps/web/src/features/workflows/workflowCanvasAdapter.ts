import {
  applyStatusOverlay,
  deriveWorkflowCanvasView,
  mapStageRunsToOverlay,
  type DurableWorkflowGraphForCanvas,
  type WorkflowCanvasView,
  type WorkflowStageKeyMap,
  type WorkflowStageRunForCanvas,
  type WorkflowValidationHint,
} from "@maestro-template/workflow-ui/workflowCanvasState";

export type WorkflowCanvasAdapterInput = {
  readonly graph: DurableWorkflowGraphForCanvas | undefined;
  readonly stages: readonly WorkflowStageRunForCanvas[] | undefined;
  readonly stageMap?: WorkflowStageKeyMap;
  readonly validationHints?: readonly WorkflowValidationHint[];
};

export const deriveWorkflowCanvasAdapterView = (
  input: WorkflowCanvasAdapterInput,
): WorkflowCanvasView => {
  const view = deriveWorkflowCanvasView(
    input.graph,
    input.validationHints ?? [],
  );
  if (view.status !== "ready") return view;
  const overlays = mapStageRunsToOverlay(
    input.stages ?? [],
    input.stageMap ?? {},
    view.model.nodes.map((node) => node.id),
  );
  return { ...view, model: applyStatusOverlay(view.model, overlays) };
};
