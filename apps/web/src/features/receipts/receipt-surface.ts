import type { WorkflowRunReceipt } from "@maestro-template/template-core";

export type ReceiptDocumentSection = {
  readonly heading: string;
  readonly body: readonly string[];
};

export const buildReceiptDocumentSections = (
  receipt: WorkflowRunReceipt,
): readonly ReceiptDocumentSection[] => [
  {
    heading: "Receipt identity",
    body: [
      `${receipt.trustReceiptId} proves ${receipt.trustReceipt.trustClaim}.`,
      `Workflow run: ${receipt.workflowRunId}.`,
    ],
  },
  {
    heading: "Source provenance",
    body: receipt.trustReceipt.sourceTitles.map(
      (title) => `Source used: ${title}.`,
    ),
  },
  {
    heading: "Policy and model",
    body: [
      `Policy snapshot: ${receipt.trustReceipt.policySnapshotId}.`,
      `Model posture: ${receipt.trustReceipt.model}.`,
    ],
  },
  {
    heading: "Audit trail",
    body: receipt.auditEvents,
  },
];
