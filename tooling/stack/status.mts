/**
 * stack:status — report each slice's AUTHORITATIVE state: the GitHub
 * required-check conclusions (spec §5). Local evidence is never consulted here.
 */
import process from "node:process";
import {
  ghCheckStatuses,
  realRunner,
  type CheckConclusion,
  REQUIRED_CHECKS,
} from "./exec.mts";

export function sliceGreen(statuses: Record<string, CheckConclusion>): boolean {
  return REQUIRED_CHECKS.every((name) => statuses[name] === "SUCCESS");
}

// CLI: `tsx tooling/stack/status.mts <prNumber> [<prNumber> ...]`
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const arg of process.argv.slice(2)) {
    const pr = Number(arg);
    const statuses = ghCheckStatuses(realRunner, pr);
    const mark = sliceGreen(statuses) ? "✓ green" : "… not green";
    console.log(`PR #${pr}: ${mark} ${JSON.stringify(statuses)}`);
  }
}
