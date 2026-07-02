/**
 * stack:sync — keep the stack current (spec §8, §9). Refuses to restack while
 * any required check on an affected PR is still in flight (null conclusion),
 * because a force-push cancels in-progress checks and invalidates bot reviews.
 */
import process from "node:process";
import {
  ghCheckStatuses,
  realRunner,
  type CheckConclusion,
  type Runner,
  REQUIRED_CHECKS,
} from "./exec.mts";

/** True only when every required check that exists has a final conclusion. */
export function mayRestack(statuses: Record<string, CheckConclusion>): boolean {
  return REQUIRED_CHECKS.every((name) => {
    const c = statuses[name];
    return c === undefined || (c !== null && c !== "PENDING");
  });
}

type SyncDecision = { ok: true } | { ok: false; reason: string };

export function syncStack(
  run: Runner,
  affectedPrs: readonly number[],
  override: boolean,
): SyncDecision {
  run("git", ["fetch", "origin", "main"]);
  for (const pr of affectedPrs) {
    const statuses = ghCheckStatuses(run, pr);
    if (!override && !mayRestack(statuses)) {
      return {
        ok: false,
        reason: `PR #${String(pr)} has in-flight required checks`,
      };
    }
  }
  run("gt", ["sync"]);
  run("gt", ["restack"]);
  return { ok: true };
}

function parsePrNumbers(args: readonly string[]): number[] {
  return args
    .filter((arg) => arg !== "--override")
    .map((arg) => Number(arg))
    .filter((value) => Number.isInteger(value) && value > 0);
}

// CLI: `tsx tooling/stack/sync.mts <prNumber> [<prNumber> ...] [--override]`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const override = process.argv.includes("--override");
  const prs = parsePrNumbers(process.argv.slice(2));
  if (prs.length === 0) {
    console.error("usage: stack:sync <prNumber> [<prNumber> ...] [--override]");
    process.exit(2);
  }
  const decision = syncStack(realRunner, prs, override);
  if (!decision.ok) {
    console.error(`✗ stack:sync refused — ${decision.reason}`);
    process.exit(1);
  }
  console.log("✓ stack synced and restacked");
}
