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
