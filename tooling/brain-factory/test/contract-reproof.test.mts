import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CONTRACT_REPROOF_FINDINGS_SCHEMA,
  CONTRACT_REPROOF_FINDINGS_REFRESH_SCHEMA,
  CONTRACT_REPROOF_REFRESH_SCHEMA,
  CONTRACT_REPROOF_TERMINAL_REFRESH_SCHEMA,
  buildContractReproofFindingsRequest,
  buildContractReproofRequest,
  buildRefreshedContractReproofRequest,
  buildTerminalContractReproofRefreshRequest,
  validateContractReproofRequest,
} from "../src/contract-reproof.js";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const identity = {
  controlHeadSha: "a".repeat(40),
  planSha256: "b".repeat(64),
  taskBlockHash: "c".repeat(64),
  taskId: "S13-T01",
};

const request = () =>
  buildContractReproofRequest({
    ...identity,
    priorArchiveSha256: "d".repeat(64),
    priorIntegrationHeadSha: "e".repeat(40),
    priorIntegrationId: "C1-contract-spine",
    priorIntegrationResultSha256: "f".repeat(64),
    priorLaneResultSha256: "1".repeat(64),
    priorEvidencePath: "/tmp/evidence/prior.json",
    reason: "canonical task block gained stronger fixture requirements",
  });

const finding = {
  id: "wave-000056-S04-T04-tenant-key-auth-mismatch",
  taskId: identity.taskId,
  candidateHeadSha: "2".repeat(40),
  summary: "Authorization uses the provider key as a durable ID",
  details: "Resolve the stable provider key before membership authorization.",
  severity: "high",
  affectedPaths: ["packages/convex/confect/slack/channelPolicies.impl.ts"],
  expectedBehavior: "Authorize against the durable organization ID.",
  requiredRegressionProof:
    "An organization admin can use its agency key without cross-tenant access.",
  priorEvidenceSha256: ["3".repeat(64)],
  changeExpectation: "source_or_test_delta" as const,
};

const findingsRequest = (overrides: Record<string, unknown> = {}) =>
  buildContractReproofFindingsRequest({
    ...request(),
    findings: [{ ...finding, ...overrides }],
  });

describe("contract reproof provenance", () => {
  it("binds a deterministic request to old and current authority", () => {
    const value = request();
    expect(validateContractReproofRequest(value, identity)).toEqual(value);
    expect(request()).toEqual(value);
  });

  it.each([
    ["task", { ...identity, taskId: "S13-T02" }],
    ["control head", { ...identity, controlHeadSha: "2".repeat(40) }],
    ["plan", { ...identity, planSha256: "2".repeat(64) }],
    ["task block", { ...identity, taskBlockHash: "2".repeat(64) }],
  ])("rejects mismatched current %s authority", (_label, expected) => {
    expect(() => validateContractReproofRequest(request(), expected)).toThrow(
      /current authority/,
    );
  });

  it("rejects mutation and unsafe identities", () => {
    expect(() =>
      validateContractReproofRequest(
        { ...request(), reason: "mutated after signing" },
        identity,
      ),
    ).toThrow(/hash mismatch/);
    expect(() =>
      buildContractReproofRequest({ ...request(), taskId: "../S13-T01" }),
    ).toThrow(/safe segment/);
  });

  it("rejects fields outside the signed request payload", () => {
    expect(() =>
      validateContractReproofRequest(
        { ...request(), unsignedNote: "mutable" },
        identity,
      ),
    ).toThrow(/unknown fields/);
  });
});

describe("terminal contract reproof authority refresh", () => {
  const previous = findingsRequest();
  const terminalHeadSha = "7".repeat(40);
  const currentControlHeadSha = "8".repeat(40);
  const currentPlanSha256 = "9".repeat(64);
  const proof = {
    baseSha: previous.controlHeadSha,
    changedFiles: ["packages/convex/confect/slack/channelPolicies.impl.ts"],
    focusedCommands: ["rtk pnpm --dir packages/convex typecheck"],
    headSha: terminalHeadSha,
    planSha256: previous.planSha256,
    reviewHeadSha: terminalHeadSha,
    reviewVerdict: "pending",
    schemaVersion: "maestro-brain-ci-proof/v1",
    taskBlockHash: previous.taskBlockHash,
    taskId: previous.taskId,
  };
  const gate = {
    currentHeadSha: terminalHeadSha,
    currentTreeSha: "a".repeat(40),
    headSha: terminalHeadSha,
    planSha256: previous.planSha256,
    schemaVersion: "maestro-brain-lane-gate/v1",
    stage: "pre-review",
    status: "passed",
    taskBlockHash: previous.taskBlockHash,
    taskId: previous.taskId,
  };
  const build = (overrides: Record<string, unknown> = {}) =>
    buildTerminalContractReproofRefreshRequest({
      authorityDeltaPaths: [
        "docs/superpowers/plans/current.md",
        "tooling/brain-factory/src/lane-gates.mts",
      ],
      authorityDeltaBaseSha: previous.controlHeadSha,
      currentControlHeadSha,
      currentPlanSha256,
      currentTaskBlockHash: previous.taskBlockHash,
      currentTaskFileLocks: [
        "packages/convex/confect/slack/channelPolicies.impl.ts",
      ],
      previousRequest: previous,
      previousRequestContent: json(previous),
      previousRequestPath: "/tmp/evidence/reproofs/S13-T01/old/request.json",
      proof,
      proofContent: json(proof),
      proofPath: "/tmp/evidence/reproofs/S13-T01/terminal/proof.json",
      finalGateReport: gate,
      finalGateContent: json(gate),
      finalGatePath: "/tmp/evidence/reproofs/S13-T01/terminal/gate.json",
      terminalRunId: "01KY6H4EDRW1M3CA8Z6T4DR3BP",
      terminalRunStatus: "failed",
      terminalSourceHeadSha: terminalHeadSha,
      taskId: previous.taskId,
      reason: "refresh terminal proof against current authority",
      ...overrides,
    });

  it("signs terminal lineage without requiring a lane result", () => {
    const refreshed = build();
    expect(refreshed).toMatchObject({
      schemaVersion: CONTRACT_REPROOF_TERMINAL_REFRESH_SCHEMA,
      controlHeadSha: previous.controlHeadSha,
      currentControlHeadSha,
      planSha256: currentPlanSha256,
      taskBlockHash: previous.taskBlockHash,
      terminalRunId: "01KY6H4EDRW1M3CA8Z6T4DR3BP",
      terminalRunStatus: "failed",
      terminalSourceHeadSha: terminalHeadSha,
      authorityDeltaPaths: [
        "docs/superpowers/plans/current.md",
        "tooling/brain-factory/src/lane-gates.mts",
      ],
      authorityDeltaBaseSha: previous.controlHeadSha,
      priorReproofRequestSha256: sha256(json(previous)),
      priorReproofProofSha256: sha256(json(proof)),
      priorReproofFinalGateSha256: sha256(json(gate)),
      findings: previous.findings,
    });
    expect(
      validateContractReproofRequest(refreshed, {
        controlHeadSha: previous.controlHeadSha,
        planSha256: currentPlanSha256,
        taskBlockHash: previous.taskBlockHash,
        taskId: previous.taskId,
        fileLocks: ["packages/convex/confect/slack/channelPolicies.impl.ts"],
      }),
    ).toEqual(refreshed);
  });

  it.each([
    ["live run", { terminalRunStatus: "running" }],
    ["proof head", { proof: { ...proof, headSha: "b".repeat(40) } }],
    ["gate plan", { finalGateReport: { ...gate, planSha256: "c".repeat(64) } }],
    [
      "product authority delta",
      {
        authorityDeltaPaths: [
          "packages/convex/confect/slack/channelPolicies.impl.ts",
        ],
      },
    ],
  ])("rejects drifted %s lineage", (_label, overrides) => {
    expect(() => build(overrides)).toThrow();
  });

  it("binds chained refresh delta to the immediately prior control authority", () => {
    const first = build();
    const nextHeadSha = "d".repeat(40);
    const nextProof = {
      ...proof,
      headSha: nextHeadSha,
      planSha256: first.planSha256,
      reviewHeadSha: nextHeadSha,
    };
    const nextGate = {
      ...gate,
      currentHeadSha: nextHeadSha,
      headSha: nextHeadSha,
      planSha256: first.planSha256,
    };
    const nextInput = {
      authorityDeltaBaseSha: first.currentControlHeadSha as string,
      authorityDeltaPaths: ["tooling/brain-factory/src/manifest.ts"],
      currentControlHeadSha: "e".repeat(40),
      currentPlanSha256: "f".repeat(64),
      currentTaskBlockHash: first.taskBlockHash,
      currentTaskFileLocks: [
        "packages/convex/confect/slack/channelPolicies.impl.ts",
      ],
      finalGateContent: json(nextGate),
      finalGatePath: "/tmp/evidence/terminal-2/gate.json",
      finalGateReport: nextGate,
      previousRequest: first,
      previousRequestContent: json(first),
      previousRequestPath: "/tmp/evidence/terminal-1/request.json",
      proof: nextProof,
      proofContent: json(nextProof),
      proofPath: "/tmp/evidence/terminal-2/proof.json",
      reason: "advance terminal authority again",
      taskId: first.taskId,
      terminalRunId: "01KY7H4EDRW1M3CA8Z6T4DR3BP",
      terminalRunStatus: "failed",
      terminalSourceHeadSha: nextHeadSha,
    } as const;
    expect(buildTerminalContractReproofRefreshRequest(nextInput)).toMatchObject(
      {
        authorityDeltaBaseSha: first.currentControlHeadSha,
      },
    );
    expect(() =>
      buildTerminalContractReproofRefreshRequest({
        ...nextInput,
        authorityDeltaBaseSha: first.controlHeadSha,
      }),
    ).toThrow("immediately prior control authority");
  });
});

describe("finding-bound contract reproof provenance", () => {
  it("sorts and hashes the complete canonical finding payload", () => {
    const affectedPath = finding.affectedPaths[0];
    if (!affectedPath) throw new Error("fixture affected path missing");
    const second = {
      ...finding,
      id: "wave-000056-S04-T04-a-second-finding",
      priorEvidenceSha256: ["4".repeat(64)],
    };
    const value = buildContractReproofFindingsRequest({
      ...request(),
      findings: [finding, second],
    });
    expect(value.schemaVersion).toBe(CONTRACT_REPROOF_FINDINGS_SCHEMA);
    expect(value.findings?.map(({ id }) => id)).toEqual([
      second.id,
      finding.id,
    ]);
    expect(
      validateContractReproofRequest(value, {
        ...identity,
        fileLocks: [affectedPath],
      }),
    ).toEqual(value);
  });

  it.each([
    ["empty finding ID", { id: "" }, /id must be a non-empty string/],
    ["task mismatch", { taskId: "S04-T04" }, /task mismatch/],
    [
      "non-SHA candidate",
      { candidateHeadSha: "candidate" },
      /candidateHeadSha/,
    ],
    ["missing expected behavior", { expectedBehavior: "" }, /expectedBehavior/],
    [
      "missing regression proof",
      { requiredRegressionProof: "" },
      /requiredRegressionProof/,
    ],
    [
      "duplicate prior evidence",
      { priorEvidenceSha256: ["3".repeat(64), "3".repeat(64)] },
      /duplicate prior evidence hash/,
    ],
    [
      "evidence-only without rationale",
      { changeExpectation: "evidence_only" },
      /evidenceOnlyRationale/,
    ],
  ])("rejects %s", (_label, overrides, expected) => {
    expect(() => findingsRequest(overrides)).toThrow(expected);
  });

  it("rejects an affected path outside the exact owner locks", () => {
    const value = findingsRequest();
    expect(() =>
      validateContractReproofRequest(value, {
        ...identity,
        fileLocks: ["packages/convex/test/channel-policies.test.ts"],
      }),
    ).toThrow(/outside owner locks/);
  });

  it("preserves byte-for-byte v1 request hashing", () => {
    expect(request().requestSha256).toBe(
      "a045e72e78b08686152833b208d94dcd10f784be9c3294c699da75dd7ef7db80",
    );
  });
});

describe("contract reproof authority refresh", () => {
  const previous = request();
  const laneHeadSha = "3".repeat(40);
  const laneTreeSha = "4".repeat(40);
  const lane = {
    headSha: laneHeadSha,
    reproof: {
      priorIntegrationHeadSha: previous.priorIntegrationHeadSha,
      priorIntegrationId: previous.priorIntegrationId,
      requestPath: "/tmp/evidence/reproofs/S13-T01/old/request.json",
      requestSha256: previous.requestSha256,
    },
    schemaVersion: "maestro-brain-lane-result/v1",
    status: "lane_green",
    taskId: previous.taskId,
    tranche: "R0-release",
  };
  const proof = {
    baseSha: previous.controlHeadSha,
    headSha: laneHeadSha,
    planSha256: previous.planSha256,
    reviewFindings: [],
    reviewHeadSha: laneHeadSha,
    reviewVerdict: "pass",
    schemaVersion: "maestro-brain-ci-proof/v1",
    taskBlockHash: previous.taskBlockHash,
    taskId: previous.taskId,
  };
  const finalGateReport = {
    currentHeadSha: laneHeadSha,
    currentTreeSha: laneTreeSha,
    headSha: laneHeadSha,
    planSha256: previous.planSha256,
    schemaVersion: "maestro-brain-lane-gate/v1",
    stage: "final",
    status: "passed",
    taskBlockHash: previous.taskBlockHash,
    taskId: previous.taskId,
  };
  const refresh = (overrides: Record<string, unknown> = {}) => {
    const input = {
      currentControlHeadSha: "5".repeat(40),
      currentPlanSha256: "6".repeat(64),
      currentTaskBlockHash: previous.taskBlockHash,
      finalGateReport,
      finalGateContent: json(finalGateReport),
      finalGatePath: "/tmp/evidence/reproofs/S13-T01/new/prior-final-gate.json",
      lane,
      laneContent: json(lane),
      lanePath: "/tmp/evidence/reproofs/S13-T01/new/prior-lane-result.json",
      laneTreeSha,
      previousRequest: previous,
      previousRequestContent: json(previous),
      previousRequestPath: lane.reproof.requestPath,
      proof,
      proofContent: json(proof),
      proofPath: "/tmp/evidence/reproofs/S13-T01/new/prior-proof.json",
      priorReproofSourceHeadSha: laneHeadSha,
      reason: "refresh proof against current control authority",
      taskId: previous.taskId,
      ...overrides,
    };
    if ("lane" in overrides && !("laneContent" in overrides)) {
      input.laneContent = json(input.lane);
    }
    if ("proof" in overrides && !("proofContent" in overrides)) {
      input.proofContent = json(input.proof);
    }
    if ("finalGateReport" in overrides && !("finalGateContent" in overrides)) {
      input.finalGateContent = json(input.finalGateReport);
    }
    return buildRefreshedContractReproofRequest(input);
  };

  it("mints a new signed authority request without changing prior lineage", () => {
    const refreshed = refresh();
    expect(refreshed).toMatchObject({
      schemaVersion: CONTRACT_REPROOF_REFRESH_SCHEMA,
      controlHeadSha: "5".repeat(40),
      planSha256: "6".repeat(64),
      priorArchiveSha256: previous.priorArchiveSha256,
      priorIntegrationHeadSha: previous.priorIntegrationHeadSha,
      priorIntegrationId: previous.priorIntegrationId,
      priorIntegrationResultSha256: previous.priorIntegrationResultSha256,
      priorLaneResultSha256: previous.priorLaneResultSha256,
      priorEvidencePath: previous.priorEvidencePath,
      taskBlockHash: previous.taskBlockHash,
      taskId: previous.taskId,
      priorReproofFinalGateSha256: sha256(json(finalGateReport)),
      priorReproofLaneResultSha256: sha256(json(lane)),
      priorReproofProofSha256: sha256(json(proof)),
      priorReproofRequestSha256: sha256(json(previous)),
      priorReproofSourceHeadSha: laneHeadSha,
    });
    expect(refreshed.requestSha256).not.toBe(previous.requestSha256);
    expect(previous.controlHeadSha).toBe(identity.controlHeadSha);
  });

  it("pins the literal legacy refresh-v2 payload and hash", () => {
    expect(refresh()).toEqual({
      schemaVersion: "maestro-brain-contract-reproof-refresh/v2",
      taskId: "S13-T01",
      reason: "refresh proof against current control authority",
      controlHeadSha: "5".repeat(40),
      planSha256: "6".repeat(64),
      taskBlockHash: "c".repeat(64),
      priorIntegrationId: "C1-contract-spine",
      priorIntegrationHeadSha: "e".repeat(40),
      priorIntegrationResultSha256: "f".repeat(64),
      priorLaneResultSha256: "1".repeat(64),
      priorArchiveSha256: "d".repeat(64),
      priorEvidencePath: "/tmp/evidence/prior.json",
      priorReproofRequestPath:
        "/tmp/evidence/reproofs/S13-T01/old/request.json",
      priorReproofRequestSha256: sha256(json(previous)),
      priorReproofLaneResultPath:
        "/tmp/evidence/reproofs/S13-T01/new/prior-lane-result.json",
      priorReproofLaneResultSha256: sha256(json(lane)),
      priorReproofProofPath:
        "/tmp/evidence/reproofs/S13-T01/new/prior-proof.json",
      priorReproofProofSha256: sha256(json(proof)),
      priorReproofFinalGatePath:
        "/tmp/evidence/reproofs/S13-T01/new/prior-final-gate.json",
      priorReproofFinalGateSha256: sha256(json(finalGateReport)),
      priorReproofSourceHeadSha: laneHeadSha,
      requestSha256:
        "6c9a8ceb9711d816529e32cd030f028d5065287f69a717d9e5edbe46f671ffaa",
    });
  });

  it("preserves complete signed findings through authority refresh", () => {
    const findingPrevious = findingsRequest();
    const priorFinding = findingPrevious.findings?.[0];
    if (!priorFinding) throw new Error("fixture finding missing");
    const findingRequestPath =
      "/tmp/evidence/reproofs/S13-T01/finding/request.json";
    const findingLane = {
      ...lane,
      reproof: {
        priorIntegrationHeadSha: findingPrevious.priorIntegrationHeadSha,
        priorIntegrationId: findingPrevious.priorIntegrationId,
        requestPath: findingRequestPath,
        requestSha256: findingPrevious.requestSha256,
      },
    };
    const findingProof = {
      ...proof,
      priorFindingDispositions: [
        {
          findingId: priorFinding.id,
          status: "resolved",
          evidence: ["channelPolicies.impl.ts:42"],
          regressionTestPaths: [
            "packages/convex/test/channel-policies.test.ts",
          ],
          changedPaths: [...priorFinding.affectedPaths],
        },
      ],
      resolvedPriorFindingIds: [priorFinding.id],
    };
    const refreshed = buildRefreshedContractReproofRequest({
      currentControlHeadSha: "5".repeat(40),
      currentPlanSha256: "6".repeat(64),
      currentTaskBlockHash: findingPrevious.taskBlockHash,
      finalGateReport,
      finalGateContent: json(finalGateReport),
      finalGatePath:
        "/tmp/evidence/reproofs/S13-T01/finding/prior-final-gate.json",
      lane: findingLane,
      laneContent: json(findingLane),
      lanePath: "/tmp/evidence/reproofs/S13-T01/finding/prior-lane-result.json",
      laneTreeSha,
      previousRequest: findingPrevious,
      previousRequestContent: json(findingPrevious),
      previousRequestPath: findingRequestPath,
      proof: findingProof,
      proofContent: json(findingProof),
      proofPath: "/tmp/evidence/reproofs/S13-T01/finding/prior-proof.json",
      priorReproofSourceHeadSha: laneHeadSha,
      reason: "refresh finding proof against current control authority",
      taskId: findingPrevious.taskId,
    });
    expect(refreshed.schemaVersion).toBe(
      CONTRACT_REPROOF_FINDINGS_REFRESH_SCHEMA,
    );
    expect(refreshed.findings).toEqual(findingPrevious.findings);
    expect(
      validateContractReproofRequest(refreshed, {
        controlHeadSha: refreshed.controlHeadSha,
        planSha256: refreshed.planSha256,
        taskBlockHash: refreshed.taskBlockHash,
        taskId: refreshed.taskId,
        fileLocks: priorFinding.affectedPaths,
      }).findings,
    ).toEqual(findingPrevious.findings);
  });

  it("accepts disposition fields on a refreshed proof", () => {
    expect(() =>
      refresh({
        proof: {
          ...proof,
          priorFindingDispositions: [],
          resolvedPriorFindingIds: [],
        },
      }),
    ).not.toThrow();
  });

  it("accepts signed supplemental command and source-slice proof fields", () => {
    expect(() =>
      refresh({
        proof: {
          ...proof,
          supplementalCommandResults: [
            { command: "rtk pnpm check:route-tree", result: "passed" },
          ],
          sourceSlices: [
            {
              commit: laneHeadSha,
              changedHandAuthoredSourceLines: 287,
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it.each([
    [
      "malformed supplemental command results",
      { supplementalCommandResults: [{ command: "", result: "passed" }] },
      /supplemental command results/,
    ],
    [
      "malformed source slices",
      {
        sourceSlices: [
          { commit: "not-a-sha", changedHandAuthoredSourceLines: -1 },
        ],
      },
      /source slices/,
    ],
  ])("rejects %s", (_label, proofFields, expected) => {
    expect(() => refresh({ proof: { ...proof, ...proofFields } })).toThrow(
      expected,
    );
  });

  it.each([
    [
      "task-block drift",
      { currentTaskBlockHash: "7".repeat(64) },
      /current authority/,
    ],
    [
      "lane request drift",
      {
        lane: {
          ...lane,
          reproof: { ...lane.reproof, requestSha256: "7".repeat(64) },
        },
      },
      /lane reproof lineage/,
    ],
    [
      "lane request path drift",
      { previousRequestPath: "/tmp/evidence/reproofs/S13-T01/other.json" },
      /lane reproof lineage/,
    ],
    [
      "proof base drift",
      { proof: { ...proof, baseSha: "7".repeat(40) } },
      /proof does not bind prior request/,
    ],
    [
      "unsigned request field",
      { previousRequest: { ...previous, unsignedNote: "mutable" } },
      /unknown fields/,
    ],
    [
      "ambiguous lane lineage",
      { lane: { ...lane, reproof: { ...lane.reproof, alternate: "request" } } },
      /unknown fields/,
    ],
    [
      "unknown lane field",
      { lane: { ...lane, unsignedNote: "mutable" } },
      /prior reproof lane has unknown fields/,
    ],
    [
      "unknown proof field",
      { proof: { ...proof, unsignedNote: "mutable" } },
      /prior reproof proof has unknown fields/,
    ],
    [
      "unknown final gate field",
      { finalGateReport: { ...finalGateReport, unsignedNote: "mutable" } },
      /prior reproof final gate has unknown fields/,
    ],
    [
      "source commit drift",
      { priorReproofSourceHeadSha: "8".repeat(40) },
      /source head drift/,
    ],
  ])("rejects %s", (_label, overrides, expected) => {
    expect(() => refresh(overrides)).toThrow(expected);
  });

  it.each([
    "priorReproofRequestSha256",
    "priorReproofLaneResultSha256",
    "priorReproofProofSha256",
    "priorReproofFinalGateSha256",
  ])("rejects a mutated signed %s", (field) => {
    const refreshed = refresh();
    expect(() =>
      validateContractReproofRequest(
        { ...refreshed, [field]: "9".repeat(64) },
        {
          controlHeadSha: refreshed.controlHeadSha,
          planSha256: refreshed.planSha256,
          taskBlockHash: refreshed.taskBlockHash,
          taskId: refreshed.taskId,
        },
      ),
    ).toThrow(/hash mismatch/);
  });
});
