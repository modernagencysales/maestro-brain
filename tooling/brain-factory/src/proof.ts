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
