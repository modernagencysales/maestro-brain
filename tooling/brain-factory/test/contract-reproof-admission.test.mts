import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  admitContractReproof,
  isReproofablePriorIntegrationResult,
  validateContractReproofRefreshArtifacts,
} from "../src/contract-reproof-admission.js";
import {
  buildContractReproofRefreshRequest,
  buildContractReproofFindingsRequest,
  buildContractReproofRequest,
  buildRefreshedContractReproofRequest,
  buildTerminalContractReproofRefreshRequest,
} from "../src/contract-reproof.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const roots: string[] = [];

const fixture = () => {
  const root = mkdtempSync(resolve(tmpdir(), "brain-reproof-admission-"));
  roots.push(root);
  const evidenceDirectory = resolve(root, "evidence");
  const integrationId = "wave-000007";
  const taskId = "S04-T02";
  const requestControlHead = "1".repeat(40);
  const currentControlHead = "2".repeat(40);
  const priorIntegrationHead = "3".repeat(40);
  const planSha256 = "4".repeat(64);
  const taskBlockHash = "5".repeat(64);
  const laneResult = {
    acceptanceBlocker: "acceptance prerequisites remain outstanding",
    accepted: false,
    headSha: "6".repeat(40),
    integrationHeadSha: priorIntegrationHead,
    integrationId,
    schemaVersion: "maestro-brain-lane-result/v1",
    status: "integrated",
    taskId,
  };
  const integrationResult = {
    headSha: priorIntegrationHead,
    integrationId,
    status: "passed",
  };
  const integrationResultContent = json(integrationResult);
  const archive = {
    integrationId,
    integrationResult,
    laneEvidence: [{ result: laneResult, taskId }],
    schemaVersion: "maestro-brain-evidence-archive/v1",
  };
  const archiveContent = json(archive);
  const priorArchiveSha256 = sha256(archiveContent);
  const priorEvidencePath = resolve(
    evidenceDirectory,
    "archive",
    integrationId,
    `${priorArchiveSha256}.json`,
  );
  const request = buildContractReproofRequest({
    controlHeadSha: requestControlHead,
    planSha256,
    priorArchiveSha256,
    priorEvidencePath,
    priorIntegrationHeadSha: priorIntegrationHead,
    priorIntegrationId: integrationId,
    priorIntegrationResultSha256: sha256(integrationResultContent),
    priorLaneResultSha256: sha256(json(laneResult)),
    reason: "control-only factory changes require a fresh proof",
    taskBlockHash,
    taskId,
  });
  const requestPath = resolve(
    evidenceDirectory,
    "reproof-requests",
    taskId,
    "request.json",
  );
  const requestContent = json(request);
  mkdirSync(resolve(evidenceDirectory, "integration", integrationId), {
    recursive: true,
  });
  mkdirSync(resolve(evidenceDirectory, "archive", integrationId), {
    recursive: true,
  });
  mkdirSync(resolve(evidenceDirectory, "reproof-requests", taskId), {
    recursive: true,
  });
  writeFileSync(
    resolve(
      evidenceDirectory,
      "integration",
      integrationId,
      "integration-result.json",
    ),
    integrationResultContent,
  );
  writeFileSync(priorEvidencePath, archiveContent);
  writeFileSync(requestPath, requestContent);

  const input = {
    changedFilesBetween: () => ["tooling/brain-factory/src/dispatch.mts"],
    currentControlHead,
    evidenceDirectory,
    fileLocks: ["packages/convex/confect/slack/directory.impl.ts"],
    isAncestor: (ancestor: string, descendant: string) =>
      (descendant === currentControlHead &&
        [requestControlHead, priorIntegrationHead].includes(ancestor)) ||
      (ancestor === priorIntegrationHead && descendant === requestControlHead),
    laneRequestSha256: request.requestSha256,
    lanePriorIntegrationHeadSha: priorIntegrationHead,
    lanePriorIntegrationId: integrationId,
    planSha256,
    proofBaseSha: requestControlHead,
    requestPath,
    taskBlockHash,
    taskId,
  };
  return {
    archive,
    archiveContent,
    evidenceDirectory,
    input,
    integrationResult,
    integrationResultContent,
    laneResult,
    priorEvidencePath,
    request,
    requestContent,
    requestPath,
    root,
  };
};

const rewriteArchive = (
  value: ReturnType<typeof fixture>,
  archive: Record<string, unknown>,
) => {
  const archiveContent = json(archive);
  const priorArchiveSha256 = sha256(archiveContent);
  const priorEvidencePath = resolve(
    value.evidenceDirectory,
    "archive",
    value.request.priorIntegrationId,
    `${priorArchiveSha256}.json`,
  );
  writeFileSync(priorEvidencePath, archiveContent);
  const request = buildContractReproofRequest({
    ...value.request,
    priorArchiveSha256,
    priorEvidencePath,
  });
  writeFileSync(value.requestPath, json(request));
  return {
    ...value.input,
    laneRequestSha256: request.requestSha256,
  };
};

const rewritePriorIntegrationResult = (
  value: ReturnType<typeof fixture>,
  integrationResult: Record<string, unknown>,
) => {
  const integrationResultContent = json(integrationResult);
  writeFileSync(
    resolve(
      value.evidenceDirectory,
      "integration",
      value.request.priorIntegrationId,
      "integration-result.json",
    ),
    integrationResultContent,
  );
  const request = buildContractReproofRequest({
    ...value.request,
    priorIntegrationResultSha256: sha256(integrationResultContent),
  });
  writeFileSync(value.requestPath, json(request));
  return { ...value.input, laneRequestSha256: request.requestSha256 };
};

const refreshFixture = () => {
  const value = fixture();
  const sourceHeadSha = "6".repeat(40);
  const lane = {
    headSha: sourceHeadSha,
    reproof: {
      priorIntegrationHeadSha: value.request.priorIntegrationHeadSha,
      priorIntegrationId: value.request.priorIntegrationId,
      requestPath: value.requestPath,
      requestSha256: value.request.requestSha256,
    },
    schemaVersion: "maestro-brain-lane-result/v1",
    status: "lane_green",
    taskId: value.request.taskId,
    tranche: "C1-contract-spine",
  };
  const proof = {
    baseSha: value.request.controlHeadSha,
    headSha: sourceHeadSha,
    planSha256: value.request.planSha256,
    reviewFindings: [],
    reviewHeadSha: sourceHeadSha,
    reviewVerdict: "pass",
    schemaVersion: "maestro-brain-ci-proof/v1",
    taskBlockHash: value.request.taskBlockHash,
    taskId: value.request.taskId,
  };
  const laneTreeSha = "7".repeat(40);
  const finalGate = {
    currentHeadSha: sourceHeadSha,
    currentTreeSha: laneTreeSha,
    headSha: sourceHeadSha,
    planSha256: value.request.planSha256,
    schemaVersion: "maestro-brain-lane-gate/v1",
    stage: "final",
    status: "passed",
    taskBlockHash: value.request.taskBlockHash,
    taskId: value.request.taskId,
  };
  const refreshDirectory = resolve(
    value.evidenceDirectory,
    "reproof-requests",
    value.request.taskId,
    "refresh",
  );
  mkdirSync(refreshDirectory, { recursive: true });
  const lanePath = resolve(refreshDirectory, "prior-lane-result.json");
  const proofPath = resolve(refreshDirectory, "prior-proof.json");
  const finalGatePath = resolve(refreshDirectory, "prior-final-gate.json");
  const refreshedRequestPath = resolve(refreshDirectory, "request.json");
  const laneContent = json(lane);
  const proofContent = json(proof);
  const finalGateContent = json(finalGate);
  const refreshedRequest = buildRefreshedContractReproofRequest({
    currentControlHeadSha: value.input.currentControlHead,
    currentPlanSha256: value.request.planSha256,
    currentTaskBlockHash: value.request.taskBlockHash,
    finalGateContent,
    finalGatePath,
    finalGateReport: finalGate,
    lane,
    laneContent,
    lanePath,
    laneTreeSha,
    previousRequest: value.request,
    previousRequestContent: value.requestContent,
    previousRequestPath: value.requestPath,
    priorReproofSourceHeadSha: sourceHeadSha,
    proof,
    proofContent,
    proofPath,
    reason: "refresh against current authority",
    taskId: value.request.taskId,
  });
  writeFileSync(lanePath, laneContent);
  writeFileSync(proofPath, proofContent);
  writeFileSync(finalGatePath, finalGateContent);
  writeFileSync(refreshedRequestPath, json(refreshedRequest));
  return {
    ...value,
    finalGatePath,
    lanePath,
    proofPath,
    refreshedRequest,
    refreshedRequestPath,
    refreshInput: {
      ...value.input,
      isAncestor: (ancestor: string, descendant: string) =>
        ancestor === descendant || value.input.isAncestor(ancestor, descendant),
      laneRequestSha256: refreshedRequest.requestSha256,
      proofBaseSha: value.input.currentControlHead,
      requestPath: refreshedRequestPath,
    },
  };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("contract reproof admission", () => {
  it("validates an exact terminal refresh without requiring a lane result", () => {
    const value = fixture();
    const affectedPath = value.input.fileLocks[0] as string;
    const previous = buildContractReproofFindingsRequest({
      ...value.request,
      findings: [
        {
          affectedPaths: [affectedPath],
          candidateHeadSha: "6".repeat(40),
          changeExpectation: "source_or_test_delta",
          details: "restore the exact terminal contract",
          expectedBehavior: "the contract remains exact",
          id: "S04-T02-terminal",
          priorEvidenceSha256: [value.request.priorArchiveSha256],
          requiredRegressionProof: "focused terminal regression",
          severity: "important",
          summary: "terminal contract finding",
          taskId: value.input.taskId,
        },
      ],
    });
    const directory = resolve(value.evidenceDirectory, "terminal-refresh");
    mkdirSync(directory, { recursive: true });
    const previousPath = resolve(directory, "prior-request.json");
    const previousContent = json(previous);
    writeFileSync(previousPath, previousContent);
    const terminalHeadSha = "6".repeat(40);
    const proof = {
      baseSha: previous.controlHeadSha,
      changedFiles: [affectedPath],
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
      currentTreeSha: "7".repeat(40),
      headSha: terminalHeadSha,
      planSha256: previous.planSha256,
      schemaVersion: "maestro-brain-lane-gate/v1",
      stage: "pre-review",
      status: "passed",
      taskBlockHash: previous.taskBlockHash,
      taskId: previous.taskId,
    };
    const proofPath = resolve(directory, "prior-proof.json");
    const gatePath = resolve(directory, "prior-gate.json");
    const proofContent = json(proof);
    const gateContent = json(gate);
    writeFileSync(proofPath, proofContent);
    writeFileSync(gatePath, gateContent);
    const authorityDeltaPaths = [
      "docs/superpowers/plans/current.md",
      "tooling/brain-factory/src/lane-gates.mts",
    ];
    const refreshed = buildTerminalContractReproofRefreshRequest({
      authorityDeltaBaseSha: previous.controlHeadSha,
      authorityDeltaPaths,
      currentControlHeadSha: value.input.currentControlHead,
      currentPlanSha256: "8".repeat(64),
      currentTaskBlockHash: previous.taskBlockHash,
      currentTaskFileLocks: value.input.fileLocks,
      finalGateContent: gateContent,
      finalGatePath: gatePath,
      finalGateReport: gate,
      previousRequest: previous,
      previousRequestContent: previousContent,
      previousRequestPath: previousPath,
      proof,
      proofContent,
      proofPath,
      reason: "refresh terminal authority",
      taskId: previous.taskId,
      terminalRunId: "01KY6H4EDRW1M3CA8Z6T4DR3BP",
      terminalRunStatus: "failed",
      terminalSourceHeadSha: terminalHeadSha,
    });
    expect(() =>
      validateContractReproofRefreshArtifacts({
        authorityDeltaPathsBetween: () => authorityDeltaPaths,
        evidenceDirectory: value.evidenceDirectory,
        fileLocks: value.input.fileLocks,
        isAncestor: () => true,
        request: refreshed,
        taskId: previous.taskId,
      }),
    ).not.toThrow();

    writeFileSync(proofPath, `${proofContent} `);
    expect(() =>
      validateContractReproofRefreshArtifacts({
        authorityDeltaPathsBetween: () => authorityDeltaPaths,
        evidenceDirectory: value.evidenceDirectory,
        fileLocks: value.input.fileLocks,
        isAncestor: () => true,
        request: refreshed,
        taskId: previous.taskId,
      }),
    ).toThrow("prior reproof proof digest drift");
  });

  it("admits a findings-aware authority refresh without shedding findings", () => {
    const value = refreshFixture();
    const finding = {
      id: "wave-000007-S04-T02-directory-authorization",
      taskId: value.request.taskId,
      candidateHeadSha: "3".repeat(40),
      summary: "Directory authorization used the wrong organization identity.",
      details: "Resolve the stable key before membership authorization.",
      severity: "high",
      affectedPaths: ["packages/convex/confect/slack/directory.impl.ts"],
      expectedBehavior: "Authorization uses the durable organization ID.",
      requiredRegressionProof: "The agency-key tenant regression passes.",
      priorEvidenceSha256: ["8".repeat(64)],
      changeExpectation: "source_or_test_delta" as const,
    };
    const findingRequest = buildContractReproofFindingsRequest({
      ...value.request,
      findings: [finding],
    });
    writeFileSync(value.requestPath, json(findingRequest));
    const lane = JSON.parse(readFileSync(value.lanePath, "utf8")) as Record<
      string,
      unknown
    >;
    lane.reproof = {
      ...(lane.reproof as Record<string, unknown>),
      requestSha256: findingRequest.requestSha256,
    };
    const proof = JSON.parse(readFileSync(value.proofPath, "utf8")) as Record<
      string,
      unknown
    >;
    proof.priorFindingDispositions = [
      {
        findingId: finding.id,
        status: "resolved",
        evidence: ["directory.impl.ts:42"],
        regressionTestPaths: ["packages/convex/test/slack-directory.test.ts"],
        changedPaths: finding.affectedPaths,
      },
    ];
    proof.resolvedPriorFindingIds = [finding.id];
    const finalGate = JSON.parse(
      readFileSync(value.finalGatePath, "utf8"),
    ) as Record<string, unknown>;
    const refreshed = buildRefreshedContractReproofRequest({
      currentControlHeadSha: value.input.currentControlHead,
      currentPlanSha256: value.request.planSha256,
      currentTaskBlockHash: value.request.taskBlockHash,
      finalGateContent: json(finalGate),
      finalGatePath: value.finalGatePath,
      finalGateReport: finalGate,
      lane,
      laneContent: json(lane),
      lanePath: value.lanePath,
      laneTreeSha: String(finalGate.currentTreeSha),
      previousRequest: findingRequest,
      previousRequestContent: json(findingRequest),
      previousRequestPath: value.requestPath,
      priorReproofSourceHeadSha: String(lane.headSha),
      proof,
      proofContent: json(proof),
      proofPath: value.proofPath,
      reason: "refresh finding-bound authority",
      taskId: finding.taskId,
    });
    writeFileSync(value.lanePath, json(lane));
    writeFileSync(value.proofPath, json(proof));
    writeFileSync(value.finalGatePath, json(finalGate));
    writeFileSync(value.refreshedRequestPath, json(refreshed));

    expect(
      admitContractReproof({
        ...value.refreshInput,
        laneRequestSha256: refreshed.requestSha256,
      }).request.findings,
    ).toEqual([finding]);
  });

  it("admits semantic pass with a failed broad gate", () => {
    expect(
      isReproofablePriorIntegrationResult({
        status: "ready_for_review",
        reviewVerdict: "pass",
        broadGate: {
          schemaVersion: "maestro-brain-broad-gate-receipt/v1",
          status: "failed",
        },
      }),
    ).toBe(true);
  });

  it("binds the canonical payload instead of the raw request file", () => {
    const value = fixture();
    const admitted = admitContractReproof(value.input);
    expect(admitted.request).toEqual(value.request);
    expect(admitted.reproofRequestSha256).toBe(value.request.requestSha256);
    expect(admitted.reproofRequestSha256).not.toBe(
      sha256(value.requestContent),
    );
  });

  it("accepts the authorized manifest and package control-plane delta", () => {
    const value = fixture();
    const admitted = admitContractReproof({
      ...value.input,
      changedFilesBetween: () => [
        "docs/superpowers/execution/maestro-brain/task-manifest.json",
        "docs/superpowers/execution/maestro-brain/parallelism-contract.json",
        ".superpowers/sdd/task-5-slice-c-report.md",
        "package.json",
        "tooling/brain-factory/src/manifest.ts",
      ],
    });
    expect(admitted.request.taskId).toBe(value.request.taskId);
  });

  it("allows a task-disjoint product advance only for authority refresh", () => {
    const value = fixture();
    const changedFilesBetween = () => [
      "packages/convex/confect/brain/pages.impl.ts",
    ];
    expect(() =>
      admitContractReproof({ ...value.input, changedFilesBetween }),
    ).toThrow(/control-plane/);
    expect(
      admitContractReproof({
        ...value.input,
        allowAuthorityRefreshAdvance: true,
        changedFilesBetween,
      }).request.taskId,
    ).toBe(value.request.taskId);
  });

  it("allows lock advances only when a fresh lane proof will be required", () => {
    const value = fixture();
    expect(
      admitContractReproof({
        ...value.input,
        allowAuthorityRefreshAdvance: true,
        changedFilesBetween: () => [
          "packages/convex/confect/slack/directory.impl.ts",
        ],
      }).request.taskId,
    ).toBe(value.request.taskId);
  });

  it.each([
    ["non-ancestor request control", { isAncestor: () => false }, /ancestor/],
    [
      "non-control delta",
      { changedFilesBetween: () => ["packages/ui/src/button.tsx"] },
      /control-plane/,
    ],
    [
      "exact task-lock collision",
      {
        changedFilesBetween: () => ["tooling/brain-factory/src/dispatch.mts"],
        fileLocks: ["tooling/brain-factory/src/dispatch.mts"],
      },
      /task-lock/,
    ],
    ["proof-base drift", { proofBaseSha: "7".repeat(40) }, /current authority/],
    ["plan drift", { planSha256: "7".repeat(64) }, /current authority/],
    ["task drift", { taskId: "S04-T03" }, /current authority/],
    [
      "task-block drift",
      { taskBlockHash: "8".repeat(64) },
      /current authority/,
    ],
  ])("rejects %s", (_label, overrides, expected) => {
    const value = fixture();
    expect(() =>
      admitContractReproof({ ...value.input, ...overrides }),
    ).toThrow(expected);
  });

  it("rejects payload-hash versus raw-file-hash confusion", () => {
    const value = fixture();
    expect(() =>
      admitContractReproof({
        ...value.input,
        laneRequestSha256: sha256(value.requestContent),
      }),
    ).toThrow(/payload binding/);
  });

  it("requires both request control and prior integration ancestry", () => {
    const value = fixture();
    expect(() =>
      admitContractReproof({
        ...value.input,
        isAncestor: (ancestor, descendant) =>
          ancestor === value.request.controlHeadSha &&
          descendant === value.input.currentControlHead,
      }),
    ).toThrow(/ancestor/);
  });

  it("rejects sibling history even when both heads precede current control", () => {
    const value = fixture();
    expect(() =>
      admitContractReproof({
        ...value.input,
        isAncestor: (ancestor, descendant) =>
          descendant === value.input.currentControlHead &&
          [
            value.request.controlHeadSha,
            value.request.priorIntegrationHeadSha,
          ].includes(ancestor),
      }),
    ).toThrow(/prior integration.*request control/);
  });

  it.each([
    ["integration ID", { lanePriorIntegrationId: "wave-000008" }],
    ["integration head", { lanePriorIntegrationHeadSha: "9".repeat(40) }],
  ])("rejects lane reproof %s drift", (_label, overrides) => {
    const value = fixture();
    expect(() =>
      admitContractReproof({ ...value.input, ...overrides }),
    ).toThrow(/lane reproof lineage drift/);
  });

  it.each([
    ["prior result drift", /integration result drift/],
    ["archive hash drift", /archive hash drift/],
  ])("rejects %s", (label, expected) => {
    const value = fixture();
    if (label === "prior result drift") {
      writeFileSync(
        resolve(
          value.evidenceDirectory,
          "integration",
          value.request.priorIntegrationId,
          "integration-result.json",
        ),
        `${value.integrationResultContent} `,
      );
    } else {
      writeFileSync(value.priorEvidencePath, `${value.archiveContent} `);
    }
    expect(() => admitContractReproof(value.input)).toThrow(expected);
  });

  it.each([
    [
      "archive id drift",
      (value: ReturnType<typeof fixture>) => ({
        ...value.archive,
        integrationId: "wave-000008",
      }),
      /archive identity drift/,
    ],
    [
      "archive head drift",
      (value: ReturnType<typeof fixture>) => ({
        ...value.archive,
        integrationResult: {
          ...value.integrationResult,
          headSha: "9".repeat(40),
        },
      }),
      /archive head drift/,
    ],
    [
      "archived lane drift",
      (value: ReturnType<typeof fixture>) => ({
        ...value.archive,
        laneEvidence: [
          {
            result: { ...value.laneResult, headSha: "a".repeat(40) },
            taskId: value.request.taskId,
          },
        ],
      }),
      /archived lane drift/,
    ],
  ])("rejects independently re-hashed %s", (_label, mutate, expected) => {
    const value = fixture();
    const input = rewriteArchive(value, mutate(value));
    expect(() => admitContractReproof(input)).toThrow(expected);
  });

  it.each([
    [
      "integration-result ID",
      (value: ReturnType<typeof fixture>) => ({
        ...value.integrationResult,
        integrationId: "wave-000008",
      }),
      /prior integration result identity/,
    ],
    [
      "integration-result head",
      (value: ReturnType<typeof fixture>) => ({
        ...value.integrationResult,
        headSha: "9".repeat(40),
      }),
      /prior integration result identity/,
    ],
    [
      "integration-result failed status",
      (value: ReturnType<typeof fixture>) => ({
        ...value.integrationResult,
        status: "failed",
      }),
      /prior integration result identity/,
    ],
  ])("rejects self-consistently re-hashed %s", (_label, mutate, expected) => {
    const value = fixture();
    const input = rewritePriorIntegrationResult(value, mutate(value));
    expect(() => admitContractReproof(input)).toThrow(expected);
  });

  it.each([
    [
      "lane inner task ID",
      (value: ReturnType<typeof fixture>) => ({
        ...value.laneResult,
        taskId: "S04-T03",
      }),
      /archived lane identity/,
    ],
    [
      "lane inner integration ID",
      (value: ReturnType<typeof fixture>) => ({
        ...value.laneResult,
        integrationId: "wave-000008",
      }),
      /archived lane identity/,
    ],
    [
      "lane inner integration head",
      (value: ReturnType<typeof fixture>) => ({
        ...value.laneResult,
        integrationHeadSha: "9".repeat(40),
      }),
      /archived lane identity/,
    ],
    [
      "lane inner head shape",
      (value: ReturnType<typeof fixture>) => ({
        ...value.laneResult,
        headSha: "not-a-sha",
      }),
      /archived lane identity/,
    ],
    [
      "lane acceptance status",
      (value: ReturnType<typeof fixture>) => ({
        ...value.laneResult,
        acceptanceBlocker: undefined,
        accepted: true,
      }),
      /integrated task must remain accepted:false/,
    ],
  ])("rejects self-consistently re-hashed %s", (_label, mutate, expected) => {
    const value = fixture();
    const laneResult = mutate(value);
    const archive = {
      ...value.archive,
      laneEvidence: [{ result: laneResult, taskId: value.request.taskId }],
    };
    const archiveContent = json(archive);
    const priorArchiveSha256 = sha256(archiveContent);
    const priorEvidencePath = resolve(
      value.evidenceDirectory,
      "archive",
      value.request.priorIntegrationId,
      `${priorArchiveSha256}.json`,
    );
    writeFileSync(priorEvidencePath, archiveContent);
    const request = buildContractReproofRequest({
      ...value.request,
      priorArchiveSha256,
      priorEvidencePath,
      priorLaneResultSha256: sha256(json(laneResult)),
    });
    writeFileSync(value.requestPath, json(request));
    expect(() =>
      admitContractReproof({
        ...value.input,
        laneRequestSha256: request.requestSha256,
      }),
    ).toThrow(expected);
  });

  it("rejects duplicate archived task identities", () => {
    const value = fixture();
    const duplicateArchive = {
      ...value.archive,
      laneEvidence: [
        ...value.archive.laneEvidence,
        value.archive.laneEvidence[0],
      ],
    };
    expect(() =>
      admitContractReproof(rewriteArchive(value, duplicateArchive)),
    ).toThrow(/exactly one archived lane identity/);
  });

  it.each([
    ["request", "requestPath"],
    ["lane", "lanePath"],
    ["proof", "proofPath"],
    ["final gate", "finalGatePath"],
  ])("rejects refreshed prior %s digest drift", (_label, pathKey) => {
    const value = refreshFixture();
    const path = value[pathKey as keyof typeof value];
    if (typeof path !== "string") throw new Error("fixture path is invalid");
    writeFileSync(path, `${readFileSync(path, "utf8")} `);
    expect(() => admitContractReproof(value.refreshInput)).toThrow(
      /digest drift/,
    );
  });

  it("admits an exact refreshed lineage", () => {
    const value = refreshFixture();
    expect(admitContractReproof(value.refreshInput).request).toEqual(
      value.refreshedRequest,
    );
  });

  it("recursively admits an exact v2-to-v2 refresh lineage", () => {
    const value = refreshFixture();
    const sourceHeadSha = "8".repeat(40);
    const lane = {
      headSha: sourceHeadSha,
      reproof: {
        priorIntegrationHeadSha: value.refreshedRequest.priorIntegrationHeadSha,
        priorIntegrationId: value.refreshedRequest.priorIntegrationId,
        requestPath: value.refreshedRequestPath,
        requestSha256: value.refreshedRequest.requestSha256,
      },
      schemaVersion: "maestro-brain-lane-result/v1",
      status: "lane_green",
      taskId: value.refreshedRequest.taskId,
      tranche: "C1-contract-spine",
    };
    const proof = {
      baseSha: value.refreshedRequest.controlHeadSha,
      headSha: sourceHeadSha,
      planSha256: value.refreshedRequest.planSha256,
      reviewFindings: [],
      reviewHeadSha: sourceHeadSha,
      reviewVerdict: "pass",
      schemaVersion: "maestro-brain-ci-proof/v1",
      taskBlockHash: value.refreshedRequest.taskBlockHash,
      taskId: value.refreshedRequest.taskId,
    };
    const laneTreeSha = "a".repeat(40);
    const finalGate = {
      currentHeadSha: sourceHeadSha,
      currentTreeSha: laneTreeSha,
      headSha: sourceHeadSha,
      planSha256: value.refreshedRequest.planSha256,
      schemaVersion: "maestro-brain-lane-gate/v1",
      stage: "final",
      status: "passed",
      taskBlockHash: value.refreshedRequest.taskBlockHash,
      taskId: value.refreshedRequest.taskId,
    };
    const directory = resolve(value.evidenceDirectory, "reproof-v2-second");
    mkdirSync(directory, { recursive: true });
    const lanePath = resolve(directory, "prior-lane-result.json");
    const proofPath = resolve(directory, "prior-proof.json");
    const finalGatePath = resolve(directory, "prior-final-gate.json");
    const requestPath = resolve(directory, "request.json");
    const second = buildRefreshedContractReproofRequest({
      currentControlHeadSha: "b".repeat(40),
      currentPlanSha256: value.refreshedRequest.planSha256,
      currentTaskBlockHash: value.refreshedRequest.taskBlockHash,
      finalGateContent: json(finalGate),
      finalGatePath,
      finalGateReport: finalGate,
      lane,
      laneContent: json(lane),
      lanePath,
      laneTreeSha,
      previousRequest: value.refreshedRequest,
      previousRequestContent: json(value.refreshedRequest),
      previousRequestPath: value.refreshedRequestPath,
      priorReproofSourceHeadSha: sourceHeadSha,
      proof,
      proofContent: json(proof),
      proofPath,
      reason: "refresh v2 again",
      taskId: value.refreshedRequest.taskId,
    });
    writeFileSync(lanePath, json(lane));
    writeFileSync(proofPath, json(proof));
    writeFileSync(finalGatePath, json(finalGate));
    writeFileSync(requestPath, json(second));
    expect(
      admitContractReproof({
        ...value.input,
        currentControlHead: second.controlHeadSha,
        isAncestor: (ancestor, descendant) =>
          ancestor === descendant ||
          (ancestor === second.priorIntegrationHeadSha &&
            descendant === second.controlHeadSha),
        laneRequestSha256: second.requestSha256,
        planSha256: second.planSha256,
        proofBaseSha: second.controlHeadSha,
        requestPath,
      }).request,
    ).toEqual(second);
  });

  it("rejects refreshed source-commit drift", () => {
    const value = refreshFixture();
    const drifted = buildContractReproofRefreshRequest({
      ...value.refreshedRequest,
      priorReproofFinalGatePath: String(
        value.refreshedRequest.priorReproofFinalGatePath,
      ),
      priorReproofFinalGateSha256: String(
        value.refreshedRequest.priorReproofFinalGateSha256,
      ),
      priorReproofLaneResultPath: String(
        value.refreshedRequest.priorReproofLaneResultPath,
      ),
      priorReproofLaneResultSha256: String(
        value.refreshedRequest.priorReproofLaneResultSha256,
      ),
      priorReproofProofPath: String(
        value.refreshedRequest.priorReproofProofPath,
      ),
      priorReproofProofSha256: String(
        value.refreshedRequest.priorReproofProofSha256,
      ),
      priorReproofRequestPath: String(
        value.refreshedRequest.priorReproofRequestPath,
      ),
      priorReproofRequestSha256: String(
        value.refreshedRequest.priorReproofRequestSha256,
      ),
      priorReproofSourceHeadSha: "9".repeat(40),
    });
    writeFileSync(value.refreshedRequestPath, json(drifted));
    expect(() =>
      admitContractReproof({
        ...value.refreshInput,
        laneRequestSha256: drifted.requestSha256,
      }),
    ).toThrow(/source head drift/);
  });

  it("rejects a request symlink that escapes evidence before reading it", () => {
    const value = fixture();
    const outside = resolve(value.root, "outside-request.json");
    writeFileSync(outside, value.requestContent);
    rmSync(value.requestPath);
    symlinkSync(outside, value.requestPath);
    expect(() => admitContractReproof(value.input)).toThrow(/outside evidence/);
  });

  it("rejects a derived archive symlink that escapes evidence before reading it", () => {
    const value = fixture();
    const outside = resolve(value.root, "outside-archive.json");
    writeFileSync(outside, value.archiveContent);
    rmSync(value.priorEvidencePath);
    symlinkSync(outside, value.priorEvidencePath);
    expect(() => admitContractReproof(value.input)).toThrow(/outside evidence/);
  });

  it("rejects an integration-result symlink that escapes evidence before reading it", () => {
    const value = fixture();
    const resultPath = resolve(
      value.evidenceDirectory,
      "integration",
      value.request.priorIntegrationId,
      "integration-result.json",
    );
    const outside = resolve(value.root, "outside-integration-result.json");
    writeFileSync(outside, value.integrationResultContent);
    rmSync(resultPath);
    symlinkSync(outside, resultPath);
    expect(() => admitContractReproof(value.input)).toThrow(/outside evidence/);
  });
});
