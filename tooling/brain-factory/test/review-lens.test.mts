import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  aggregateReviewLenses,
  type ReviewAggregate,
  type ReviewLensArtifact,
  type ReviewLensExpected,
  validateReviewLens,
} from "../src/review-lens.js";
import { updateProofFromReviewLenses } from "../src/review-aggregate.mjs";
import { withAggregatedReview } from "../src/proof.js";

const expected: ReviewLensExpected = {
  taskId: "S03-T03",
  planSha256: "plan",
  taskBlockHash: "contract",
  baseSha: "base",
  headSha: "head",
  treeSha: "tree",
  rubricIds: {
    contract: ["contract.api", "contract.ownership"],
    safety: ["safety.tenancy"],
    quality: ["quality.tests"],
  },
  reviewerRunIds: {
    contract: "run-contract",
    safety: "run-safety",
    quality: "run-quality",
  },
};

const lens = (
  name: ReviewLensArtifact["lens"],
  overrides: Partial<ReviewLensArtifact> = {},
): ReviewLensArtifact => {
  const rubricDispositions = expected.rubricIds[name].map((rubricId) => ({
    rubricId,
    disposition: "pass" as const,
    evidence: [`${name}.md#${rubricId}`],
  }));
  return {
    ...expected,
    lens: name,
    reviewerRunId: `run-${name}`,
    rubricDispositions,
    priorFindingDispositions: [],
    findings: [],
    verdict: "pass",
    ...overrides,
  };
};

const priorFinding = {
  id: "wave-000056-S03-T03-editor-sync-contract",
  taskId: expected.taskId,
  candidateHeadSha: "a".repeat(40),
  summary: "Editor sync identifiers drifted.",
  details: "The public contract and implementation use different identifiers.",
  severity: "high",
  affectedPaths: ["apps/web/src/features/brain/editor-sync.ts"],
  expectedBehavior: "The implementation uses the public contract identifiers.",
  requiredRegressionProof: "The editor sync contract regression passes.",
  priorEvidenceSha256: ["b".repeat(64)],
  changeExpectation: "source_or_test_delta" as const,
};

const findingExpected: ReviewLensExpected = {
  ...expected,
  priorFindings: [priorFinding],
};

const resolvedPriorFinding = {
  findingId: priorFinding.id,
  status: "resolved" as const,
  evidence: ["apps/web/src/features/brain/editor-sync.ts:42"],
  regressionTestPaths: ["apps/web/src/features/brain/editor-sync.test.ts"],
  changedPaths: ["apps/web/src/features/brain/editor-sync.ts"],
};

describe("exact-head review lens contract", () => {
  it("rejects task, plan, contract, base, head, and tree mismatches", () => {
    for (const [field, value] of [
      ["taskId", "S03-T04"],
      ["planSha256", "other-plan"],
      ["taskBlockHash", "other-contract"],
      ["baseSha", "other-base"],
      ["headSha", "other-head"],
      ["treeSha", "other-tree"],
    ] as const) {
      expect(() =>
        validateReviewLens({ ...lens("contract"), [field]: value }, expected),
      ).toThrow(`${field} mismatch`);
    }
  });

  it("rejects a missing lens", () => {
    expect(() =>
      aggregateReviewLenses({
        expected,
        lenses: [lens("contract"), lens("safety")],
      }),
    ).toThrow("missing review lens quality");
  });

  it("rejects duplicate reviewer runs", () => {
    const duplicateRunExpected: ReviewLensExpected = {
      ...expected,
      reviewerRunIds: {
        contract: "same-run",
        safety: "same-run",
        quality: "run-quality",
      },
    };
    expect(() =>
      aggregateReviewLenses({
        expected: duplicateRunExpected,
        lenses: [
          lens("contract", { reviewerRunId: "same-run" }),
          lens("safety", { reviewerRunId: "same-run" }),
          lens("quality"),
        ],
      }),
    ).toThrow("duplicate reviewer run same-run");
  });

  it("requires a complete non-blank trusted reviewer run map at runtime", () => {
    const withoutReviewerRuns = Object.fromEntries(
      Object.entries(expected).filter(([key]) => key !== "reviewerRunIds"),
    );
    for (const reviewerRunIds of [
      undefined,
      {},
      { contract: "run-contract" },
    ]) {
      const candidate =
        reviewerRunIds === undefined
          ? withoutReviewerRuns
          : { ...expected, reviewerRunIds };
      expect(() =>
        aggregateReviewLenses({
          expected: candidate as unknown as ReviewLensExpected,
          lenses: [lens("contract"), lens("safety"), lens("quality")],
        }),
      ).toThrow("reviewerRunIds must be a complete trusted map");
    }

    for (const reviewerRunId of ["", "   "]) {
      expect(() =>
        aggregateReviewLenses({
          expected: {
            ...expected,
            reviewerRunIds: {
              ...expected.reviewerRunIds,
              contract: reviewerRunId,
            },
          },
          lenses: [lens("contract"), lens("safety"), lens("quality")],
        }),
      ).toThrow("reviewerRunIds.contract must be a non-empty string");
    }

    expect(() =>
      validateReviewLens(lens("contract", { reviewerRunId: "   " }), expected),
    ).toThrow("reviewerRunId must be a non-empty string");
  });

  it("requires exact own data keys on a plain reviewer run record", () => {
    const requiredRuns = {
      contract: "run-contract",
      safety: "run-safety",
      quality: "run-quality",
    };
    const inheritedRequiredKeys = Object.assign(
      Object.create(requiredRuns) as Record<string, string>,
      { unrelatedA: "a", unrelatedB: "b", unrelatedC: "c" },
    );
    const enumerableExtra = { ...requiredRuns, extra: "run-extra" };
    const nonEnumerableExtra = { ...requiredRuns };
    Object.defineProperty(nonEnumerableExtra, "extra", {
      value: "run-extra",
      enumerable: false,
    });
    const symbolExtra = { ...requiredRuns } as Record<PropertyKey, string>;
    symbolExtra[Symbol("extra")] = "run-extra";
    class ReviewerRuns {
      contract = "run-contract";
      safety = "run-safety";
      quality = "run-quality";
    }
    const pollutedPrototype = { ...requiredRuns };
    Object.setPrototypeOf(pollutedPrototype, { polluted: true });
    const accessorRun = { ...requiredRuns };
    Object.defineProperty(accessorRun, "contract", {
      get: () => "run-contract",
      enumerable: true,
    });

    for (const reviewerRunIds of [
      inheritedRequiredKeys,
      enumerableExtra,
      nonEnumerableExtra,
      symbolExtra,
      new ReviewerRuns(),
      pollutedPrototype,
      accessorRun,
    ]) {
      expect(() =>
        aggregateReviewLenses({
          expected: {
            ...expected,
            reviewerRunIds,
          } as unknown as ReviewLensExpected,
          lenses: [lens("contract"), lens("safety"), lens("quality")],
        }),
      ).toThrow("reviewerRunIds must be a plain record");
    }
  });

  it("requires an explicit disposition for every configured rubric", () => {
    expect(() =>
      validateReviewLens(
        { ...lens("contract"), rubricDispositions: [] },
        expected,
      ),
    ).toThrow("missing rubric disposition contract.api");
  });

  it("requires exactly one disposition for every prior finding", () => {
    expect(() => validateReviewLens(lens("contract"), findingExpected)).toThrow(
      /missing prior finding disposition/,
    );
    expect(() =>
      validateReviewLens(
        {
          ...lens("contract"),
          priorFindingDispositions: [
            resolvedPriorFinding,
            resolvedPriorFinding,
          ],
        },
        findingExpected,
      ),
    ).toThrow(/duplicate prior finding disposition/);
    expect(() =>
      validateReviewLens(
        {
          ...lens("contract"),
          priorFindingDispositions: [
            { ...resolvedPriorFinding, findingId: "unknown-finding" },
          ],
        },
        findingExpected,
      ),
    ).toThrow(/unknown prior finding/);
  });

  it("resolves a prior finding only when all three lenses resolve it", () => {
    const reviewed = (name: ReviewLensArtifact["lens"], status = "resolved") =>
      lens(name, {
        priorFindingDispositions: [
          {
            ...resolvedPriorFinding,
            status: status as "resolved" | "unresolved",
          },
        ],
      });
    const resolved = aggregateReviewLenses({
      expected: findingExpected,
      lenses: [reviewed("contract"), reviewed("safety"), reviewed("quality")],
    });
    expect(resolved.resolvedPriorFindingIds).toEqual([priorFinding.id]);
    expect(resolved.reviewVerdict).toBe("pass");

    const unresolved = aggregateReviewLenses({
      expected: findingExpected,
      lenses: [
        reviewed("contract"),
        reviewed("safety", "unresolved"),
        reviewed("quality"),
      ],
    });
    expect(unresolved.resolvedPriorFindingIds).toEqual([]);
    expect(unresolved.reviewVerdict).toBe("rework");
  });

  it("rejects duplicate finding IDs across lenses", () => {
    const finding = {
      id: "S03-T03-RV-001",
      severity: "blocker" as const,
      summary: "Revision fence is mutable",
      evidence: ["brain-workspace.tsx:10"],
    };
    expect(() =>
      aggregateReviewLenses({
        expected,
        lenses: [
          lens("contract", {
            rubricDispositions: [
              {
                rubricId: "contract.api",
                disposition: "finding",
                findingIds: [finding.id],
                evidence: finding.evidence,
              },
              {
                rubricId: "contract.ownership",
                disposition: "pass",
                evidence: ["task.md#ownership"],
              },
            ],
            findings: [finding],
            verdict: "rework",
          }),
          lens("safety", {
            rubricDispositions: [
              {
                rubricId: "safety.tenancy",
                disposition: "finding",
                findingIds: [finding.id],
                evidence: finding.evidence,
              },
            ],
            findings: [finding],
            verdict: "rework",
          }),
          lens("quality"),
        ],
      }),
    ).toThrow("duplicate finding ID S03-T03-RV-001");
  });

  it("sorts findings stably by ID regardless of lens order", () => {
    const withFinding = (
      name: "contract" | "safety",
      id: string,
      rubricId: string,
    ) =>
      lens(name, {
        rubricDispositions: [
          ...(name === "contract"
            ? [
                {
                  rubricId: "contract.ownership",
                  disposition: "pass" as const,
                  evidence: ["task.md#ownership"],
                },
              ]
            : []),
          {
            rubricId,
            disposition: "finding" as const,
            findingIds: [id],
            evidence: [`src.ts:${id}`],
          },
        ],
        findings: [
          {
            id,
            severity: "major",
            summary: id,
            evidence: [`src.ts:${id}`],
          },
        ],
        verdict: "rework",
      });

    const aggregate = aggregateReviewLenses({
      expected,
      lenses: [
        lens("quality"),
        withFinding("safety", "S03-T03-RV-010", "safety.tenancy"),
        withFinding("contract", "S03-T03-RV-002", "contract.api"),
      ],
    });
    expect(aggregate.reviewFindings.map(({ id }) => id)).toEqual([
      "S03-T03-RV-002",
      "S03-T03-RV-010",
    ]);
  });

  it("passes only after all three independent lenses pass", () => {
    expect(
      aggregateReviewLenses({
        expected,
        lenses: [lens("contract"), lens("safety"), lens("quality")],
      }).reviewVerdict,
    ).toBe("pass");
  });

  it("aggregates any finding into rework", () => {
    const finding = {
      id: "S03-T03-RV-001",
      severity: "major" as const,
      summary: "Missing concurrency test",
      evidence: ["brain-workspace.test.ts:20"],
    };
    const quality = lens("quality", {
      rubricDispositions: [
        {
          rubricId: "quality.tests",
          disposition: "finding",
          findingIds: [finding.id],
          evidence: finding.evidence,
        },
      ],
      findings: [finding],
      verdict: "rework",
    });
    expect(
      aggregateReviewLenses({
        expected,
        lenses: [lens("contract"), lens("safety"), quality],
      }).reviewVerdict,
    ).toBe("rework");
  });

  it("rejects forged aggregates and a validated aggregate for another tree", () => {
    const aggregate = aggregateReviewLenses({
      expected,
      lenses: [lens("contract"), lens("safety"), lens("quality")],
    });
    const proof = {
      taskId: expected.taskId,
      planSha256: expected.planSha256,
      taskBlockHash: expected.taskBlockHash,
      baseSha: expected.baseSha,
      headSha: expected.headSha,
    };
    const forged = JSON.parse(JSON.stringify(aggregate)) as ReviewAggregate;

    expect(() =>
      withAggregatedReview(proof, forged, { treeSha: expected.treeSha }),
    ).toThrow("review aggregate was not runtime validated");
    expect(() =>
      withAggregatedReview(proof, aggregate, { treeSha: "other-tree" }),
    ).toThrow("review aggregate treeSha mismatch");
  });
});

describe("review aggregate proof update", () => {
  it("atomically changes only review fields using exact git identities", () => {
    const root = mkdtempSync(resolve(tmpdir(), "review-aggregate-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "review@example.test"], {
      cwd: root,
    });
    execFileSync("git", ["config", "user.name", "Review Test"], {
      cwd: root,
    });
    writeFileSync(resolve(root, "README.md"), "review\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "test"],
      { cwd: root },
    );
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const treeSha = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const taskId = "S03-T03";
    const evidence = resolve(root, "evidence");
    const laneDirectory = resolve(evidence, "lane-results", taskId);
    const proofPath = resolve(laneDirectory, "ci-proof-packet.json");
    const proof = {
      schemaVersion: "maestro-brain-ci-proof/v1",
      taskId,
      planSha256: "plan",
      taskBlockHash: "contract",
      baseSha: "base",
      headSha,
      focusedCommands: ["pnpm test"],
      reviewVerdict: "pending",
      reviewFindings: [{ id: "stale" }],
      reviewHeadSha: "stale",
    };
    mkdirSync(laneDirectory, { recursive: true });
    writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);

    const cliExpected: ReviewLensExpected = {
      taskId,
      planSha256: "plan",
      taskBlockHash: "contract",
      baseSha: "base",
      headSha,
      treeSha,
      rubricIds: expected.rubricIds,
      reviewerRunIds: expected.reviewerRunIds,
    };
    const reviewDirectory = resolve(laneDirectory, "review-lenses", headSha);
    mkdirSync(reviewDirectory, { recursive: true });
    for (const name of ["contract", "safety", "quality"] as const) {
      writeFileSync(
        resolve(reviewDirectory, `${name}.json`),
        `${JSON.stringify(
          {
            ...lens(name),
            ...cliExpected,
            rubricDispositions: cliExpected.rubricIds[name].map((rubricId) => ({
              rubricId,
              disposition: "pass",
              evidence: [`${name}.md#${rubricId}`],
            })),
          },
          null,
          2,
        )}\n`,
      );
    }

    expect(() =>
      updateProofFromReviewLenses({
        taskId,
        workdir: root,
        evidence,
        rubricIds: cliExpected.rubricIds,
        reviewerRunIds: {
          contract: "trusted-contract-run",
          safety: "trusted-safety-run",
          quality: "trusted-quality-run",
        },
      }),
    ).toThrow("reviewerRunId mismatch");

    expect(JSON.parse(readFileSync(proofPath, "utf8"))).toEqual(proof);

    updateProofFromReviewLenses({
      taskId,
      workdir: root,
      evidence,
      rubricIds: cliExpected.rubricIds,
      reviewerRunIds: {
        contract: "run-contract",
        safety: "run-safety",
        quality: "run-quality",
      },
    });

    expect(JSON.parse(readFileSync(proofPath, "utf8"))).toEqual({
      ...proof,
      reviewVerdict: "pass",
      reviewFindings: [],
      reviewHeadSha: headSha,
      priorFindingDispositions: [],
      resolvedPriorFindingIds: [],
    });
  });
});
