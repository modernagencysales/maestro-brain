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
