export interface AuthorityTransitionSelection {
  readonly authorityRefresh: boolean;
  readonly authorityRepair: boolean;
  readonly checkpointReproof: boolean;
  readonly laneGreenAuthorityReproof: boolean;
  readonly ownershipRehome: boolean;
  readonly planOnlyAuthority: boolean;
}

export const selectAuthorityTransition = (
  argv: readonly string[],
  taskId: string,
): AuthorityTransitionSelection => {
  const selection = {
    authorityRefresh: argv.includes("--authority-refresh"),
    authorityRepair: argv.includes("--authority-repair"),
    checkpointReproof: argv.includes("--checkpoint-reproof"),
    laneGreenAuthorityReproof: argv.includes("--lane-green-authority-reproof"),
    ownershipRehome: argv.includes("--ownership-rehome"),
    planOnlyAuthority: argv.includes("--plan-only-authority"),
  };
  if (Object.values(selection).filter(Boolean).length > 1) {
    throw new Error(`${taskId}: choose exactly one authority transition`);
  }
  return selection;
};
