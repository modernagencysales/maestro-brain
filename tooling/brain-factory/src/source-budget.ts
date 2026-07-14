const sourceExtension = /\.(?:js|jsx|mjs|mts|ts|tsx)$/;
const excludedPath =
  /(?:^|\/)(?:__fixtures__|fixtures|generated|repos|test|tests|_generated)(?:\/|$)|\.test\./;

export const isHandAuthoredSource = (path: string): boolean =>
  /^(?:apps|packages|tooling)\//.test(path) &&
  sourceExtension.test(path) &&
  !excludedPath.test(path);

export const changedHandAuthoredSourceLines = (numstat: string): number =>
  numstat
    .trim()
    .split("\n")
    .filter(Boolean)
    .reduce((total, line) => {
      const [added, removed, path] = line.split("\t");
      if (!path || !isHandAuthoredSource(path)) return total;
      const additions = Number(added);
      const deletions = Number(removed);
      return (
        total +
        (Number.isFinite(additions) ? additions : 0) +
        (Number.isFinite(deletions) ? deletions : 0)
      );
    }, 0);

export const validSourceSlices = (
  sourceLines: readonly number[],
  sliceBudget = 300,
  maximumSlices = 4,
): boolean =>
  sourceLines.length >= 1 &&
  sourceLines.length <= maximumSlices &&
  sourceLines.every((lines) => lines >= 0 && lines <= sliceBudget);
