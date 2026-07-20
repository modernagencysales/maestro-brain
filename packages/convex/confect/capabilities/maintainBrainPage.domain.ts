// Pure domain seam for maintainBrainPage. Specialize these starter fields with
// reviewed capability input, keep normalize/validate pure, and keep provider
// calls out of this file (they belong in the impl behind services).
export type MaintainBrainPageInput = {
  readonly workspaceSlug: string;
  readonly input: string;
};

export const normalizeMaintainBrainPageInput = (
  input: MaintainBrainPageInput,
): MaintainBrainPageInput => ({
  workspaceSlug: input.workspaceSlug.trim(),
  input: input.input.trim(),
});

export const validateMaintainBrainPageInput = (
  input: MaintainBrainPageInput,
): readonly string[] => {
  const errors: string[] = [];

  if (input.workspaceSlug.length === 0) {
    errors.push("workspaceSlug must not be blank.");
  }

  if (input.input.length === 0) {
    errors.push("input must not be blank.");
  }

  return errors;
};
