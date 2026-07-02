/**
 * stack:submit — the binding pre-submit refusals (spec §5, §9). NON-authoritative
 * preflight runs elsewhere; here we enforce what is mechanical and local:
 * mergeability (no conflict vs the fetched origin/main) and actual changed-line
 * budget. CI's required checks remain the only gate.
 */
import process from "node:process";
import { MAX_EST_LINES } from "./plan.mts";
import { conflictsAgainstMain } from "./mergeability.mts";
import { changedSourceLines } from "./size.mts";
import { realRunner, type Runner } from "./exec.mts";

type SubmitContext = {
  readonly base: string; // the slice's PR base (origin/main for bottom, parent otherwise)
  readonly head: string;
  readonly isBottom: boolean;
};

type SubmitDecision = { ok: true } | { ok: false; reason: string };
type SubmitCommand = { readonly cmd: string; readonly args: readonly string[] };

export function evaluateSubmit(
  run: Runner,
  ctx: SubmitContext,
): SubmitDecision {
  // Mergeability: bottom vs origin/main directly; upper slices' cumulative prefix
  // is also replayed onto origin/main by the caller fetching first (spec §9). The
  // conflict probe is the same primitive either way.
  const conflicts = conflictsAgainstMain(run, ctx.head);
  if (conflicts.length > 0)
    return {
      ok: false,
      reason: `conflict with origin/main in ${conflicts.join(", ")}`,
    };

  const lines = changedSourceLines(run, ctx.base);
  if (lines > MAX_EST_LINES)
    return {
      ok: false,
      reason: `changed lines ${lines} exceed budget ${MAX_EST_LINES}`,
    };

  return { ok: true };
}

export function submitCommand(
  lefthookExclude: string | undefined,
): SubmitCommand {
  const exclusions = lefthookExclude
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  const mergedExclusions = new Set([...(exclusions ?? []), "deterministic"]);

  return {
    cmd: "env",
    args: [
      `LEFTHOOK_EXCLUDE=${Array.from(mergedExclusions).join(",")}`,
      "gt",
      "submit",
      "--draft",
      "--no-interactive",
    ],
  };
}

// CLI: `tsx tooling/stack/submit.mts <base> [--bottom]`. Fetches origin/main
// first (no stale TOCTOU), evaluates, and on success runs gt submit.
if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] ?? "origin/main";
  const isBottom = process.argv.includes("--bottom");
  realRunner("git", ["fetch", "origin", "main"]);
  const decision = evaluateSubmit(realRunner, { base, head: "HEAD", isBottom });
  if (!decision.ok) {
    console.error(`✗ stack:submit refused — ${decision.reason}`);
    process.exit(1);
  }
  const submit = submitCommand(process.env.LEFTHOOK_EXCLUDE);
  realRunner(submit.cmd, submit.args);
  console.log("✓ submitted (CI is the gate)");
}
