import type {
  AuthorityRepairTransition,
  OwnershipRehomeTransition,
} from "./manifest.js";

const validateRehomeRewrite = (input: {
  readonly changedFiles: readonly string[];
  readonly fileLocks: readonly string[];
  readonly label: "authority-repair" | "ownership-rehome";
  readonly supersededPaths: AuthorityRepairTransition["supersededPaths"];
}): void => {
  const changed = new Set(input.changedFiles);
  const owned = new Set(input.fileLocks);
  for (const mapping of input.supersededPaths) {
    if (changed.has(mapping.path))
      throw new Error(
        `${input.label} superseded path remains: ${mapping.path}`,
      );
    if (!changed.has(mapping.replacementPath))
      throw new Error(
        `${input.label} replacement path is absent: ${mapping.replacementPath}`,
      );
  }
  const unowned = input.changedFiles.filter((path) => !owned.has(path));
  if (unowned.length > 0)
    throw new Error(
      `${input.label} paths not declared in current manifest fileLocks: ${unowned.join(", ")}`,
    );
};

export const validateAuthorityRepairRewrite = (input: {
  readonly changedFiles: readonly string[];
  readonly fileLocks: readonly string[];
  readonly transition: AuthorityRepairTransition;
}): void => {
  validateRehomeRewrite({
    changedFiles: input.changedFiles,
    fileLocks: input.fileLocks,
    label: "authority-repair",
    supersededPaths: input.transition.supersededPaths,
  });
};

export const validateOwnershipRehomeRewrite = (input: {
  readonly changedFiles: readonly string[];
  readonly fileLocks: readonly string[];
  readonly transition: OwnershipRehomeTransition;
}): void => {
  validateRehomeRewrite({
    changedFiles: input.changedFiles,
    fileLocks: input.fileLocks,
    label: "ownership-rehome",
    supersededPaths: input.transition.supersededPaths,
  });
};
