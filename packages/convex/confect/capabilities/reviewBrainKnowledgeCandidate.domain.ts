export type ExactCandidateEvidence = {
  readonly sourceKey: string;
  readonly revisionKey: string;
  readonly contentHash: string;
  readonly quote: string;
  readonly startOffset: number;
  readonly endOffset: number;
};

export const isExactEvidenceReopenable = (
  candidate: {
    readonly sourceKey: string;
    readonly sourceRevisionKey: string;
    readonly extractionPolicyVersion: string;
  },
  evidence: ExactCandidateEvidence,
  current: {
    readonly sourceKey: string;
    readonly revisionKey: string;
    readonly contentHash: string;
    readonly markdown: string;
    readonly semanticStatus?: string | undefined;
    readonly semanticPolicyVersion?: string | undefined;
  },
): boolean =>
  current.sourceKey === candidate.sourceKey &&
  evidence.sourceKey === candidate.sourceKey &&
  current.revisionKey === candidate.sourceRevisionKey &&
  evidence.revisionKey === current.revisionKey &&
  evidence.contentHash === current.contentHash &&
  current.semanticStatus === "completed" &&
  current.semanticPolicyVersion === candidate.extractionPolicyVersion &&
  Number.isInteger(evidence.startOffset) &&
  Number.isInteger(evidence.endOffset) &&
  evidence.startOffset >= 0 &&
  evidence.endOffset > evidence.startOffset &&
  current.markdown.slice(evidence.startOffset, evidence.endOffset) ===
    evidence.quote;

export const acceptedReviewBody = (input: {
  readonly action: "accept" | "edit_and_accept" | "reject";
  readonly candidateBody: string;
  readonly editedBody?: string | undefined;
}): string =>
  input.action === "edit_and_accept"
    ? (input.editedBody ?? "").trim()
    : input.candidateBody;
