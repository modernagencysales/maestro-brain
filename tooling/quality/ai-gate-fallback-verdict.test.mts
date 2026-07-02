import { describe, expect, it } from "vitest";

import {
  commentPublishBlockedVerdict,
  fallbackGateVerdict,
  formatFallbackGateVerdict,
} from "./ai-gate-fallback-verdict.mts";

describe("ai-gate-fallback-verdict", () => {
  it("formats missing taste verdicts as blocking PR findings", () => {
    const verdict = fallbackGateVerdict({
      gate: "taste",
      log: "starting taste\nprovider crashed before verdict",
    });

    expect(verdict.verdict).toBe("block");
    expect(verdict.files[0]?.file).toBe("tooling/quality/taste-review.mts");
    expect(verdict.files[0]?.verdict.findings[0]?.issue).toMatch(
      /TASTE_VERDICT_JSON/,
    );
    expect(verdict.files[0]?.verdict.findings[0]?.fix).toMatch(
      /provider crashed before verdict/,
    );
  });

  it("formats missing contract verdicts with full contract-review metadata", () => {
    const verdict = fallbackGateVerdict({
      gate: "contract-review",
      log: "contract-review crashed before verdict",
    });

    expect(verdict.verdict).toBe("block");
    expect(verdict.findings[0]?.path).toBe(
      "tooling/quality/contract-review.mts",
    );
    expect(verdict.findings[0]?.clause).toBe("AI_GATE_MISSING_VERDICT");
    expect(verdict.findings[0]?.mechanicalGateCandidate).toBe("none");
    expect(
      formatFallbackGateVerdict({
        gate: "contract-review",
        log: "contract-review crashed before verdict",
      }),
    ).toMatch(/AI_GATE_MISSING_VERDICT/);
  });

  it("serializes the exact fallback verdict shapes consumed by PR comments", () => {
    expect(
      JSON.parse(
        formatFallbackGateVerdict({
          gate: "taste",
          log: "taste crashed before verdict",
        }),
      ),
    ).toEqual({
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
                fix: "Inspect the CI AI gate log and fix the command failure. Last log lines:\ntaste crashed before verdict",
              },
            ],
          },
        },
      ],
    });
    expect(
      JSON.parse(
        formatFallbackGateVerdict({
          gate: "contract-review",
          log: "contract-review crashed before verdict",
        }),
      ),
    ).toEqual({
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
          fix: "Inspect the CI AI gate log and fix the command failure. Last log lines:\ncontract-review crashed before verdict",
          clause: "AI_GATE_MISSING_VERDICT",
          confidence: "high",
          mechanicalGateCandidate: "none",
          applyability: "needs-human",
        },
      ],
    });
  });

  it("keeps fallback log evidence bounded to the tail", () => {
    const log = Array.from(
      { length: 45 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const verdict = fallbackGateVerdict({ gate: "taste", log });
    const fix = verdict.files[0]?.verdict.findings[0]?.fix ?? "";
    const tailLines = fix
      .split("\n")
      .filter((line) => line.startsWith("line "));

    expect(tailLines.includes("line 1")).toBe(false);
    expect(tailLines[0]).toBe("line 6");
    expect(tailLines[tailLines.length - 1]).toBe("line 45");
  });

  it("formats comment-publish infrastructure failures as blocking verdicts", () => {
    const taste = commentPublishBlockedVerdict({
      gate: "taste",
      reason: "GITHUB_TOKEN is not set.",
    });
    expect(taste.verdict).toBe("block");
    expect(taste.files[0]?.file).toBe(
      "tooling/quality/post-ai-gate-comment.mts",
    );
    expect(taste.files[0]?.verdict.findings[0]?.issue).toMatch(
      /PR comment publish failed/,
    );

    const contract = commentPublishBlockedVerdict({
      gate: "contract-review",
      reason: "GitHub API rejected the sticky comment update.",
    });
    expect(contract.verdict).toBe("block");
    expect(contract.findings[0]?.path).toBe(
      "tooling/quality/post-ai-gate-comment.mts",
    );
    expect(contract.findings[0]?.clause).toBe(
      "AI_GATE_COMMENT_PUBLISH_BLOCKED",
    );
  });
});
