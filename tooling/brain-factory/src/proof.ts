import {
  assertRuntimeValidatedReviewAggregate,
  type ReviewAggregate,
} from "./review-lens.js";
import type { PriorFindingDisposition } from "./review-lens.js";
import type { ContractReproofFinding } from "./contract-reproof.js";

export const isCompatibleProofHead = ({
  ancestorExit,
  currentHead,
  proofHead,
  treeDiffExit,
}: {
  readonly ancestorExit: number | null;
  readonly currentHead: string;
  readonly proofHead: string;
  readonly treeDiffExit: number | null;
}): boolean =>
  proofHead === currentHead || (ancestorExit === 0 && treeDiffExit === 0);

export const proofChangedFilesMatch = (
  recorded: readonly string[],
  actual: readonly string[],
): boolean => {
  if (new Set(recorded).size !== recorded.length) return false;
  return (
    JSON.stringify([...recorded].sort()) ===
    JSON.stringify([...new Set(actual)].sort())
  );
};

export const CI_PROOF_SCHEMA_VERSION = "maestro-brain-ci-proof/v1";

export interface ProofContractIdentity {
  readonly taskBlockHash: string;
  readonly taskId: string;
}

export const validateProofContract = (
  proof: Record<string, unknown>,
  identity: ProofContractIdentity,
): string => {
  if (proof.schemaVersion !== CI_PROOF_SCHEMA_VERSION) {
    throw new Error(`${identity.taskId}: unexpected CI proof schema`);
  }
  if (proof.taskId !== identity.taskId) {
    throw new Error(`${identity.taskId}: proof task mismatch`);
  }
  if (typeof proof.planSha256 !== "string" || proof.planSha256.length === 0)
    throw new Error(`${identity.taskId}: proof plan provenance missing`);
  if (proof.taskBlockHash !== identity.taskBlockHash) {
    throw new Error(`${identity.taskId}: proof task block hash mismatch`);
  }
  return proof.planSha256;
};

export const withAggregatedReview = (
  proof: Record<string, unknown>,
  aggregate: ReviewAggregate,
  expected: { readonly treeSha: string },
): Record<string, unknown> => {
  assertRuntimeValidatedReviewAggregate(aggregate, expected);
  for (const field of [
    "taskId",
    "planSha256",
    "taskBlockHash",
    "baseSha",
    "headSha",
  ] as const) {
    if (proof[field] !== aggregate[field])
      throw new Error(`${aggregate.taskId}: proof ${field} mismatch`);
  }
  return {
    ...proof,
    reviewVerdict: aggregate.reviewVerdict,
    reviewFindings: aggregate.reviewFindings,
    reviewHeadSha: aggregate.headSha,
    priorFindingDispositions: aggregate.priorFindingDispositions,
    resolvedPriorFindingIds: aggregate.resolvedPriorFindingIds,
  };
};

export const validateBehavioralReproofClosure = (input: {
  readonly findings: readonly ContractReproofFinding[];
  readonly dispositions: readonly PriorFindingDisposition[];
  readonly changedPaths: readonly string[];
  readonly ownedPaths: readonly string[];
}): void => {
  const changedPaths = new Set(input.changedPaths);
  const ownedPaths = new Set(input.ownedPaths);
  const findingIds = new Set(input.findings.map(({ id }) => id));
  const dispositionIds = new Set<string>();
  for (const disposition of input.dispositions) {
    if (!findingIds.has(disposition.findingId)) {
      throw new Error(`unknown prior finding ${disposition.findingId}`);
    }
    if (dispositionIds.has(disposition.findingId)) {
      throw new Error(
        `duplicate prior finding disposition ${disposition.findingId}`,
      );
    }
    dispositionIds.add(disposition.findingId);
  }
  for (const finding of input.findings) {
    const disposition = input.dispositions.find(
      ({ findingId }) => findingId === finding.id,
    );
    if (!disposition) {
      throw new Error(`missing prior finding disposition ${finding.id}`);
    }
    if (disposition.status !== "resolved") {
      throw new Error(`${finding.id}: prior finding is unresolved`);
    }
    if (finding.changeExpectation === "source_or_test_delta") {
      const changedAffectedPath = finding.affectedPaths.some((path) =>
        changedPaths.has(path),
      );
      const changedOwnedRegressionTest = disposition.regressionTestPaths.some(
        (path) => changedPaths.has(path) && ownedPaths.has(path),
      );
      if (!changedAffectedPath || !changedOwnedRegressionTest) {
        throw new Error(
          `${finding.id}: behavioral reproof lacks code and test delta`,
        );
      }
    }
  }
};
