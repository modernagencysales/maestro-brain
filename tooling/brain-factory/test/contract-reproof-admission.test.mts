import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { admitContractReproof } from "../src/contract-reproof-admission.js";
import { buildContractReproofRequest } from "../src/contract-reproof.js";

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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("contract reproof admission", () => {
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
