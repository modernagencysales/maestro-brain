import { readFileSync } from "node:fs";
import process from "node:process";

import { isDirectRun } from "./src/direct-run.mts";

// Emits the same compact machine-readable verdict shapes consumed by
// post-ai-gate-comment when a gate exits before printing its verdict marker.
export type Gate = "taste" | "contract-review";
export const TASTE_VERDICT_JSON = "TASTE_VERDICT_JSON";
export const CONTRACT_VERDICT_JSON = "CONTRACT_VERDICT_JSON";
export const AI_GATE_MISSING_VERDICT = "AI_GATE_MISSING_VERDICT";
export const AI_GATE_COMMENT_PUBLISH_BLOCKED =
  "AI_GATE_COMMENT_PUBLISH_BLOCKED";

type TasteFallbackVerdict = {
  readonly verdict: "block";
  readonly files: readonly [
    {
      readonly file: "tooling/quality/taste-review.mts";
      readonly verdict: {
        readonly verdict: "block";
        readonly findings: readonly [
          {
            readonly line: 1;
            readonly severity: "block";
            readonly issue: string;
            readonly fix: string;
          },
        ];
      };
    },
  ];
};

type ContractFallbackVerdict = {
  readonly verdict: "block";
  readonly findings: readonly [
    {
      readonly severity: "red";
      readonly path: "tooling/quality/contract-review.mts";
      readonly line: 1;
      readonly issue: string;
      readonly contract: string;
      readonly fix: string;
      readonly clause: typeof AI_GATE_MISSING_VERDICT;
      readonly confidence: "high";
      readonly mechanicalGateCandidate: "none";
      readonly applyability: "needs-human";
    },
  ];
};

type TasteCommentPublishBlockedVerdict = {
  readonly verdict: "block";
  readonly files: readonly [
    {
      readonly file: "tooling/quality/post-ai-gate-comment.mts";
      readonly verdict: {
        readonly verdict: "block";
        readonly findings: readonly [
          {
            readonly line: 1;
            readonly severity: "block";
            readonly issue: string;
            readonly fix: string;
          },
        ];
      };
    },
  ];
};

type ContractCommentPublishBlockedVerdict = {
  readonly verdict: "block";
  readonly findings: readonly [
    {
      readonly severity: "red";
      readonly path: "tooling/quality/post-ai-gate-comment.mts";
      readonly line: 1;
      readonly issue: string;
      readonly contract: string;
      readonly fix: string;
      readonly clause: typeof AI_GATE_COMMENT_PUBLISH_BLOCKED;
      readonly confidence: "high";
      readonly mechanicalGateCandidate: "none";
      readonly applyability: "needs-human";
    },
  ];
};

type FallbackInput = {
  readonly gate: Gate;
  readonly log: string;
};

type FallbackVerdictFor<G extends Gate> = G extends "taste"
  ? TasteFallbackVerdict
  : ContractFallbackVerdict;
type CommentPublishBlockedVerdictFor<G extends Gate> = G extends "taste"
  ? TasteCommentPublishBlockedVerdict
  : ContractCommentPublishBlockedVerdict;

const TAIL_LINES = 40;
const MAX_FIX_LENGTH = 4_000;

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value === undefined || value.trim() === "" ? null : value;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function parseGate(raw: string | null): Gate {
  if (raw === "taste" || raw === "contract-review") return raw;
  throw new Error(`Invalid --gate "${raw ?? ""}".`);
}

function logTail(log: string): string {
  return log
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-TAIL_LINES)
    .join("\n");
}

function fallbackFix(log: string): string {
  const tail = logTail(log);
  const fix =
    tail === ""
      ? "Inspect the CI AI gate log and fix the command failure. No log output was captured before the gate exited."
      : `Inspect the CI AI gate log and fix the command failure. Last log lines:\n${tail}`;
  if (fix.length <= MAX_FIX_LENGTH) return fix;
  return `${fix.slice(0, MAX_FIX_LENGTH - 25)}\n... [tail truncated]`;
}

function commentPublishBlockedFix(reason: string): string {
  const detail =
    reason.trim() === "" ? "No failure detail was captured." : reason;
  return `Restore the GitHub PR comment publishing path, then rerun the AI gate. Detail: ${detail}`;
}

export function fallbackGateVerdict<G extends Gate>(input: {
  readonly gate: G;
  readonly log: string;
}): FallbackVerdictFor<G> {
  if (input.gate === "taste") {
    return {
      verdict: "block",
      files: [
        {
          file: "tooling/quality/taste-review.mts",
          verdict: {
            verdict: "block",
            findings: [
              {
                line: 1,
                severity: "block",
                issue: "Taste gate exited without emitting TASTE_VERDICT_JSON.",
                fix: fallbackFix(input.log),
              },
            ],
          },
        },
      ],
    } as FallbackVerdictFor<G>;
  }

  return {
    verdict: "block",
    findings: [
      {
        severity: "red",
        path: "tooling/quality/contract-review.mts",
        line: 1,
        issue:
          "Contract-review gate exited without emitting CONTRACT_VERDICT_JSON.",
        contract:
          "Required AI gates must produce PR-visible, machine-readable feedback when they fail.",
        fix: fallbackFix(input.log),
        clause: AI_GATE_MISSING_VERDICT,
        confidence: "high",
        mechanicalGateCandidate: "none",
        applyability: "needs-human",
      },
    ],
  } as FallbackVerdictFor<G>;
}

export function commentPublishBlockedVerdict<G extends Gate>(input: {
  readonly gate: G;
  readonly reason: string;
}): CommentPublishBlockedVerdictFor<G> {
  const issue = "AI gate PR comment publish failed.";
  const fix = commentPublishBlockedFix(input.reason);
  if (input.gate === "taste") {
    return {
      verdict: "block",
      files: [
        {
          file: "tooling/quality/post-ai-gate-comment.mts",
          verdict: {
            verdict: "block",
            findings: [
              {
                line: 1,
                severity: "block",
                issue,
                fix,
              },
            ],
          },
        },
      ],
    } as CommentPublishBlockedVerdictFor<G>;
  }

  return {
    verdict: "block",
    findings: [
      {
        severity: "red",
        path: "tooling/quality/post-ai-gate-comment.mts",
        line: 1,
        issue,
        contract:
          "Required AI gates must surface PR-visible feedback; comment publishing infrastructure failures are gate infrastructure failures.",
        fix,
        clause: AI_GATE_COMMENT_PUBLISH_BLOCKED,
        confidence: "high",
        mechanicalGateCandidate: "none",
        applyability: "needs-human",
      },
    ],
  } as CommentPublishBlockedVerdictFor<G>;
}

export function formatFallbackGateVerdict(input: FallbackInput): string {
  return JSON.stringify(fallbackGateVerdict(input));
}

function main(): void {
  const gate = parseGate(option("--gate"));
  if (flag("--comment-publish-blocked")) {
    process.stdout.write(
      `${JSON.stringify(
        commentPublishBlockedVerdict({
          gate,
          reason: option("--reason") ?? "AI gate PR comment publish failed.",
        }),
      )}\n`,
    );
    return;
  }
  const logFile = option("--log-file");
  if (logFile === null) throw new Error("Missing --log-file.");
  process.stdout.write(
    `${formatFallbackGateVerdict({
      gate,
      log: readFileSync(logFile, "utf8"),
    })}\n`,
  );
}

if (isDirectRun(import.meta.url)) main();
