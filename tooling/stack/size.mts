/**
 * size — the BINDING changed-source-line count for a slice (spec §5). Counts
 * added+deleted lines in production AND test .ts/.tsx under packages/ and apps/,
 * against the slice's PARENT base. Excludes generated, lockfiles, fixtures, and
 * non-code. This is the real gate; plan.estLines is only an estimate.
 */
import { type Runner } from "./exec.mts";

const INCLUDE = /^(packages|apps)\/.*\.(ts|tsx)$/;
const EXCLUDE = /(\/_generated\/|\/__fixtures__\/|(^|\/)pnpm-lock\.yaml$)/;

function pathOf(numstatPath: string): string {
  // Rename rows look like "dir/{a => b}.ts"; resolve to the new path.
  const renamed = numstatPath
    .replace(/\{[^}]*=>\s*([^}]*)\}/g, "$1")
    .replace(/\/{2,}/g, "/");
  return renamed.trim();
}

export function changedSourceLines(run: Runner, base: string): number {
  const raw = run("git", ["diff", "--numstat", `${base}...HEAD`]);
  let total = 0;
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const added = m[1] === "-" ? 0 : Number(m[1]);
    const deleted = m[2] === "-" ? 0 : Number(m[2]);
    const path = pathOf(m[3]);
    if (INCLUDE.test(path) && !EXCLUDE.test(path)) total += added + deleted;
  }
  return total;
}
