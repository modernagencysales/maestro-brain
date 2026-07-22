import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertCleanFindingAdoptionWorktree,
  buildIntegrationFindingAdoption,
  materializeIntegrationFindingAdoption,
  validateResolvedIntegrationFindingAdoption,
  validateIntegrationFindingAdoption,
} from "../src/integration-finding-adoption.js";
import {
  readIntegrationWaveSelection,
  selectionFileSha256,
  selectionPayload,
  selectionPayloadSha256,
} from "../src/integration-wave.js";
import { planIntegrationOwnerReworkRoute } from "../src/route-integration-rework.js";
import { validateIntegrationReproofFindings } from "../src/failed-integration-rework-validation.js";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const fixture = (findingOverrides: Record<string, unknown> = {}) => {
  const taskId = "S04-T04";
  const candidateHeadSha = "3".repeat(40);
  const task = {
    changedFiles: ["packages/policy.ts"],
    codeStartAfter: [],
    fileLocks: ["packages/policy.test.ts", "packages/policy.ts"],
    gateHeadSha: "4".repeat(40),
    gateSha256: "5".repeat(64),
    headSha: "4".repeat(40),
    laneResultSha256: "6".repeat(64),
    planSha256: "7".repeat(64),
    proofHeadSha: "4".repeat(40),
    proofSha256: "8".repeat(64),
    taskBlockHash: "9".repeat(64),
    taskId,
    tranche: "D2-domain-bodies",
  };
  const payload = selectionPayload({
    baseSha: "1".repeat(40),
    deferredTaskIds: [],
    integrationId: "wave-000056",
    planSha256: "7".repeat(64),
    requestedTaskIds: [taskId],
    selectedTasks: [task],
  });
  const payloadSha256 = selectionPayloadSha256(payload);
  const selectionContent = json({
    ...payload,
    selectionPayloadSha256: payloadSha256,
  });
  const legacyFinding = {
    id: "wave-000056-S04-T04-tenant-key-auth-mismatch",
    taskId,
    summary: "Stable provider key is reused as a durable organization ID.",
    details: "Authorization and provider lookup require distinct identities.",
    severity: "blocker",
    ...findingOverrides,
  };
  const resultContent = json({
    baseSha: payload.baseSha,
    generatedFiles: [],
    headSha: candidateHeadSha,
    integrationId: payload.integrationId,
    remainingFindings: [legacyFinding],
    reviewVerdict: "rework",
    schemaVersion: "maestro-brain-integration-result/v3",
    selectionFileSha256: selectionFileSha256(selectionContent),
    selectionPayloadSha256: payloadSha256,
    status: "ready_for_review",
  });
  const input = {
    affectedPaths: ["packages/policy.ts", "packages/policy.test.ts"],
    candidateHeadSha,
    changeExpectation: "source_or_test_delta" as const,
    expectedBehavior:
      "Resolve the provider key before authorizing the durable organization.",
    findingId: legacyFinding.id,
    integrationId: payload.integrationId,
    ownerKind: "task" as const,
    requiredRegressionProof:
      "An organization admin can use its provider key without cross-tenant access.",
    resultContent,
    selectionContent,
    taskId,
    worktreeHeadSha: candidateHeadSha,
  };
  return { input, legacyFinding, resultContent, selectionContent };
};

describe("legacy integration finding adoption", () => {
  it("adopts the exact immutable Wave 56 finding identity", () => {
    const fixtureRoot = resolve(process.cwd(), "test/fixtures/wave-000056");
    const resultContent = readFileSync(
      resolve(fixtureRoot, "integration-result.json.raw"),
      "utf8",
    );
    const selectionContent = readFileSync(
      resolve(fixtureRoot, "selection.json.raw"),
      "utf8",
    );
    expect(sha256(resultContent)).toBe(
      "5477b2cb14f224af207ef5317abb0ea17d51472c7fd33fdfd36d1f7e52b4cd76",
    );
    expect(selectionFileSha256(selectionContent)).toBe(
      "53be5a90f8430e265b9be8cc1582c696dd8de79e6ca29112b41e3fb5aeecd800",
    );
    const adoption = buildIntegrationFindingAdoption({
      affectedPaths: [
        "packages/convex/confect/slack/channelPolicies.impl.ts",
        "packages/convex/test/channel-policies.test.ts",
      ],
      candidateHeadSha: "3fadece4758f0e122afebeabac01a3260c1743c8",
      changeExpectation: "source_or_test_delta",
      expectedBehavior:
        "Resolve the stable Slack organization key before tenant authorization.",
      findingId: "wave-000056-S04-T04-tenant-key-auth-mismatch",
      integrationId: "wave-000056",
      ownerKind: "task",
      requiredRegressionProof:
        "Exercise Confect authorization and persistence with distinct tenant identities.",
      resultContent,
      selectionContent,
      taskId: "S04-T04",
      worktreeHeadSha: "3fadece4758f0e122afebeabac01a3260c1743c8",
    });
    expect(adoption).toMatchObject({
      candidateHeadSha: "3fadece4758f0e122afebeabac01a3260c1743c8",
      integrationId: "wave-000056",
      legacyFinding: {
        id: "wave-000056-S04-T04-tenant-key-auth-mismatch",
        taskId: "S04-T04",
      },
      resultSha256:
        "5477b2cb14f224af207ef5317abb0ea17d51472c7fd33fdfd36d1f7e52b4cd76",
      selectionFileSha256:
        "53be5a90f8430e265b9be8cc1582c696dd8de79e6ca29112b41e3fb5aeecd800",
      selectionPayloadSha256:
        "e958f278dd13373969440b6264691408853e3563bc7960bde8bb911a680a89fa",
    });
  });

  it("rejects dirty candidate bytes outside the bound HEAD", () => {
    expect(() => assertCleanFindingAdoptionWorktree(" M package.ts\n")).toThrow(
      "finding adoption candidate worktree is not clean",
    );
    expect(() => assertCleanFindingAdoptionWorktree("\n")).not.toThrow();
  });

  it("fails closed when resolved adoption evidence is deleted or drifts", () => {
    const value = fixture();
    const adoption = buildIntegrationFindingAdoption(value.input);
    const evidence = [`finding-adoption-sha256:${adoption.adoptionSha256}`];
    const validate = (adoptionContent?: string) =>
      validateResolvedIntegrationFindingAdoption({
        ...(adoptionContent ? { adoptionContent } : {}),
        evidence,
        resultContent: value.resultContent,
        selectionContent: value.selectionContent,
        worktreeHeadSha: value.input.worktreeHeadSha,
      });
    expect(() => validate()).toThrow("resolved finding adoption is missing");
    expect(() => validate(`${json(adoption)} `)).toThrow();
    expect(() => validate(json(adoption))).not.toThrow();
  });

  it("registers the normal adoption command", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "../../package.json"), "utf8"),
    ) as { readonly scripts?: Record<string, string> };
    expect(
      packageJson.scripts?.["brain:factory:adopt-integration-finding"],
    ).toBe("tsx tooling/brain-factory/src/adopt-integration-finding.mts");
  });

  it("builds and validates an exact immutable adoption", () => {
    const value = fixture();
    const adoption = buildIntegrationFindingAdoption(value.input);
    expect(adoption).toMatchObject({
      integrationId: "wave-000056",
      resultSha256: sha256(value.resultContent),
      finding: {
        id: value.legacyFinding.id,
        ownerKind: "task",
        taskId: "S04-T04",
      },
    });
    expect(adoption.finding.priorEvidenceSha256).toEqual(
      expect.arrayContaining([
        sha256(value.resultContent),
        selectionFileSha256(value.selectionContent),
      ]),
    );
    expect(() =>
      validateIntegrationFindingAdoption({
        adoptionContent: json(adoption),
        resultContent: value.resultContent,
        selectionContent: value.selectionContent,
        worktreeHeadSha: value.input.worktreeHeadSha,
      }),
    ).not.toThrow();
  });

  it("routes a legacy finding only through its exact adoption sidecar", () => {
    const value = fixture();
    const adoption = buildIntegrationFindingAdoption(value.input);
    const route = planIntegrationOwnerReworkRoute({
      adoptionContent: json(adoption),
      expectedHeadSha: value.input.worktreeHeadSha,
      expectedIntegrationId: value.input.integrationId,
      expectedResultSha256: sha256(value.resultContent),
      expectedSelectionFileSha256: selectionFileSha256(value.selectionContent),
      expectedSelectionPayloadSha256: JSON.parse(value.selectionContent)
        .selectionPayloadSha256 as string,
      integrationOwnedPaths: [],
      integrationResultContent: value.resultContent,
      selectionContent: value.selectionContent,
      stateRoot: "/tmp/state",
    });
    expect(route).toMatchObject({
      adoptionSha256: adoption.adoptionSha256,
      ownerTaskIds: ["S04-T04"],
    });
    expect(route.commands[0]).toEqual(
      expect.arrayContaining([
        "--finding-adoption-sha256",
        adoption.adoptionSha256,
        "--evidence",
        `integration-result-sha256:${sha256(value.resultContent)}`,
        `finding-adoption-sha256:${adoption.adoptionSha256}`,
      ]),
    );
    expect(route.preflightCommands).toHaveLength(1);
    expect(route.preflightCommands[0]).not.toContain("--launch");
    expect(route.preflightCommands[0]).toEqual(
      expect.arrayContaining([
        "--failed-integration",
        "wave-000056",
        "--finding-adoption-sha256",
        adoption.adoptionSha256,
      ]),
    );
    expect(route.commands[1]).toEqual(
      expect.arrayContaining([
        "--finding-adoption-sha256",
        adoption.adoptionSha256,
        "--launch",
      ]),
    );
  });

  it("binds both original result and adoption bytes into reproof evidence", () => {
    const value = fixture();
    const adoption = buildIntegrationFindingAdoption(value.input);
    const adoptionContent = json(adoption);
    const selected = readIntegrationWaveSelection(value.selectionContent)
      .selection.selectedTasks[0];
    if (!selected) throw new Error("selected task is missing");
    const findings = validateIntegrationReproofFindings({
      candidateHeadSha: value.input.candidateHeadSha,
      evidenceContents: [value.resultContent, adoptionContent],
      findings: [adoption.finding],
      integrationId: value.input.integrationId,
      reason: "adopt exact legacy finding",
      selected,
      taskId: value.input.taskId,
    });
    expect(findings[0]?.priorEvidenceSha256).toEqual(
      expect.arrayContaining([
        sha256(value.resultContent),
        sha256(adoptionContent),
      ]),
    );
  });

  it.each([
    ["result hash", { resultContent: `${fixture().resultContent} ` }],
    ["candidate head", { worktreeHeadSha: "a".repeat(40) }],
  ])("rejects mismatched %s", (_name, overrides) => {
    const value = fixture();
    const adoption = buildIntegrationFindingAdoption(value.input);
    expect(() =>
      validateIntegrationFindingAdoption({
        adoptionContent: json(adoption),
        resultContent: value.resultContent,
        selectionContent: value.selectionContent,
        worktreeHeadSha: value.input.worktreeHeadSha,
        ...overrides,
      }),
    ).toThrow();
  });

  it.each([
    ["task", { taskId: "S03-T03" }],
    ["path", { affectedPaths: ["packages/outside.ts"] }],
  ])("rejects a mismatched %s", (_name, overrides) => {
    const value = fixture();
    expect(() =>
      buildIntegrationFindingAdoption({ ...value.input, ...overrides }),
    ).toThrow();
  });

  it("rejects a runtime-invalid change expectation", () => {
    const value = fixture();
    expect(() =>
      buildIntegrationFindingAdoption({
        ...value.input,
        changeExpectation: "arbitrary",
      } as unknown as Parameters<typeof buildIntegrationFindingAdoption>[0]),
    ).toThrow("finding adoption change expectation is invalid");
  });

  it("refuses to override a modern structured finding", () => {
    const value = fixture({ ownerKind: "integration" });
    expect(() => buildIntegrationFindingAdoption(value.input)).toThrow(
      "modern finding cannot be adopted",
    );
  });

  it("refuses a legacy adoption beside any modern structured finding", () => {
    const legacy = fixture();
    const adoption = buildIntegrationFindingAdoption(legacy.input);
    const modern = fixture({
      affectedPaths: ["packages/policy.ts"],
      changeExpectation: "source_or_test_delta",
      expectedBehavior: "Keep the modern finding authoritative.",
      ownerKind: "task",
      requiredRegressionProof: "Prove the modern finding independently.",
    });
    expect(() =>
      planIntegrationOwnerReworkRoute({
        adoptionContent: json(adoption),
        expectedHeadSha: modern.input.worktreeHeadSha,
        expectedIntegrationId: modern.input.integrationId,
        expectedResultSha256: sha256(modern.resultContent),
        expectedSelectionFileSha256: selectionFileSha256(
          modern.selectionContent,
        ),
        expectedSelectionPayloadSha256: JSON.parse(modern.selectionContent)
          .selectionPayloadSha256 as string,
        integrationOwnedPaths: [],
        integrationResultContent: modern.resultContent,
        selectionContent: modern.selectionContent,
        stateRoot: "/tmp/state",
      }),
    ).toThrow("modern structured findings cannot use legacy adoption");
  });

  it.each([
    ["schema", { schemaVersion: "maestro-brain-integration-result/v2" }],
    ["status", { status: "rework" }],
    ["verdict", { reviewVerdict: "pass" }],
  ])("rejects a non-authoritative result %s", (_name, resultOverrides) => {
    const value = fixture();
    const result = {
      ...(JSON.parse(value.resultContent) as Record<string, unknown>),
      ...resultOverrides,
    };
    expect(() =>
      buildIntegrationFindingAdoption({
        ...value.input,
        resultContent: json(result),
      }),
    ).toThrow("finding adoption result is not authoritative rework");
  });

  it("rejects a result with another finding the sidecar cannot adopt", () => {
    const value = fixture();
    const result = JSON.parse(value.resultContent) as Record<string, unknown>;
    result.remainingFindings = [
      value.legacyFinding,
      {
        ...value.legacyFinding,
        id: "modern-finding",
        ownerKind: "task",
      },
    ];
    expect(() =>
      buildIntegrationFindingAdoption({
        ...value.input,
        resultContent: json(result),
      }),
    ).toThrow("finding adoption requires one exact legacy finding");
  });

  it("materializes once and rejects replay byte drift", () => {
    const value = fixture();
    const adoption = buildIntegrationFindingAdoption(value.input);
    const root = mkdtempSync(resolve(tmpdir(), "finding-adoption-"));
    const path = resolve(root, "adoption.json");
    materializeIntegrationFindingAdoption(path, adoption);
    expect(() =>
      materializeIntegrationFindingAdoption(path, adoption),
    ).not.toThrow();
    writeFileSync(path, readFileSync(path, "utf8").replace("  ", "   "));
    expect(() => materializeIntegrationFindingAdoption(path, adoption)).toThrow(
      "immutable finding adoption byte drift",
    );
    rmSync(root, { recursive: true });
  });
});
