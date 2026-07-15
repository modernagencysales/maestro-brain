const HAND_AUTHORED_CONVEX_FILES = new Set([
  "packages/convex/convex/auth.config.ts",
  "packages/convex/convex/convex.config.ts",
  "packages/convex/convex/http.ts",
  "packages/convex/convex/tsconfig.json",
]);

export const isIntegrationOwnedGeneratedFile = (file: string): boolean =>
  file.startsWith("packages/convex/confect/_generated/") ||
  (file.startsWith("packages/convex/convex/") &&
    !HAND_AUTHORED_CONVEX_FILES.has(file));

export const laneFileOwnershipIssues = (
  changedFiles: readonly string[],
  fileLocks: readonly string[],
): string[] => {
  const exactLocks = new Set(fileLocks.filter((lock) => !lock.startsWith("@")));
  return changedFiles.flatMap((file) =>
    isIntegrationOwnedGeneratedFile(file)
      ? [`${file}: generated output is integration-owned`]
      : exactLocks.has(file)
        ? []
        : [`${file}: not declared in manifest fileLocks`],
  );
};
