import {
  createSampleWorkflowRunReceipt,
  type WorkflowRunReceipt,
} from "@maestro-template/template-core";

export type WorkflowRunViewModel = {
  readonly statusLine: string;
  readonly stageLines: readonly string[];
  readonly evidenceLine: string;
  readonly policyLine: string;
  readonly trustReceiptLine: string;
  readonly auditLine: string;
};

export type WorkflowRunDocumentSection = {
  readonly heading: string;
  readonly body: readonly string[];
};

export type FakeWorkflowRunCommand = {
  readonly type: "trigger_fake_workflow_run";
  readonly workspaceSlug: string;
  readonly workflowId: string;
  readonly requestedBy: string;
};

export type FakeWorkflowRunResult = {
  readonly mode: "fake/local";
  readonly commandLine: string;
  readonly receipt: WorkflowRunReceipt;
  readonly auditLine: string;
};

export const buildWorkflowRunViewModel = (
  receipt: WorkflowRunReceipt,
): WorkflowRunViewModel => ({
  statusLine: `${receipt.status} ${receipt.workflowRunId} in workspace ${receipt.workspaceSlug}`,
  stageLines: receipt.steps.map((step) => {
    const executor = step.capability ?? step.agent;

    return executor
      ? `${step.label} ${step.status} through ${executor}`
      : `${step.label} ${step.status}`;
  }),
  evidenceLine: receipt.trustReceipt.sourceTitles.join(", "),
  policyLine: `${receipt.trustReceipt.policySnapshotId} using ${receipt.trustReceipt.model}`,
  trustReceiptLine: `${receipt.trustReceipt.receiptId} proves ${receipt.trustReceipt.trustClaim} for ${receipt.workflowRunId}`,
  auditLine: receipt.auditEvents.join(" -> "),
});

export const buildWorkflowRunDocumentSections = (
  receipt: WorkflowRunReceipt,
): readonly WorkflowRunDocumentSection[] => {
  const viewModel = buildWorkflowRunViewModel(receipt);

  return [
    {
      heading: "Run status",
      body: [
        viewModel.statusLine,
        `Workflow ${receipt.workflowName} v${receipt.workflowVersion} started at ${receipt.startedAt} and completed at ${receipt.completedAt}.`,
      ],
    },
    {
      heading: "Stage list",
      body: viewModel.stageLines,
    },
    {
      heading: "Evidence snapshot",
      body: [
        viewModel.evidenceLine,
        "Evidence is carried as source titles and receipt references in the template. A client fork can replace this with persisted evidence snapshot rows without changing the UI model.",
      ],
    },
    {
      heading: "Policy and model snapshot",
      body: [viewModel.policyLine, `Audit events: ${viewModel.auditLine}`],
    },
    {
      heading: "Trust Receipt",
      body: [viewModel.trustReceiptLine, receipt.trustReceipt.claim],
    },
  ];
};

export const reduceFakeWorkflowRunCommand = (
  command: FakeWorkflowRunCommand,
): FakeWorkflowRunResult => {
  const receipt = createSampleWorkflowRunReceipt();

  if (command.workflowId !== receipt.workflowId) {
    throw new Error(`Unknown fake workflow: ${command.workflowId}`);
  }

  return {
    mode: "fake/local",
    commandLine: `maestro-template workflow run --workflow ${command.workflowId} --workspace ${command.workspaceSlug} --mode fake`,
    receipt,
    auditLine: [
      `requested_by:${command.requestedBy}`,
      `workspace:${command.workspaceSlug}`,
      `workflow:${command.workflowId}`,
      `receipt:${receipt.trustReceiptId}`,
    ].join(" -> "),
  };
};
