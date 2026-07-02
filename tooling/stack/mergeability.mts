/**
 * mergeability — the #64 cure (spec §9). Uses `git merge-tree` (a real 3-way
 * merge with no worktree write) against a FRESHLY fetched origin/main. The
 * caller fetches first; these helpers just interpret the merge result.
 */
import { gitMergeTree, type Runner } from "./exec.mts";

/** Conflicted file paths from a merge of `head` into origin/main; [] = clean. */
export function conflictsAgainstMain(run: Runner, head: string): string[] {
  let out: string;
  try {
    out = gitMergeTree(run, "origin/main", head);
  } catch (err) {
    // merge-tree exits non-zero on conflict; the conflict report is on stdout,
    // which execFileSync attaches to the error.
    out = String((err as { stdout?: string }).stdout ?? "");
  }
  const files = new Set<string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^CONFLICT \([^)]*\): Merge conflict in (.+)$/);
    if (m) files.add(m[1].trim());
  }
  return [...files];
}
