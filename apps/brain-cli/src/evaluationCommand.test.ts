import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli, type CliDependencies } from "./index.js";

const configured = (
  fetch: typeof globalThis.fetch,
  now = 1_777_777_777_777,
): CliDependencies => {
  const root = mkdtempSync(join(tmpdir(), "brain-eval-cli-test-"));
  const configDirectory = join(root, "config");
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(
    join(configDirectory, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      appUrl: "https://app.example.test",
      apiUrl: "https://api.example.test",
      workspaceSlug: "apero",
      apiKey: "secret-key",
    }),
  );
  return {
    cwd: root,
    configDirectory,
    assetDirectory: join(root, "assets"),
    environment: {},
    fetch,
    now: () => now,
    platform: "linux",
    nodeVersion: "v22.18.0",
    linkAccount: vi.fn(),
    runProcess: vi.fn(() => ({ status: 0, signal: null })),
  };
};

const apiResponse = (result: unknown): Response =>
  new Response(JSON.stringify({ ok: true, result }));

const requestBody = (fetch: ReturnType<typeof vi.fn>, index: number) =>
  JSON.parse(String(fetch.mock.calls[index]?.[1]?.body)) as {
    input: Record<string, unknown>;
    idempotencyKey?: string;
  };

describe("evaluation CLI", () => {
  it("reports an empty rolling set and an empty run as insufficient-sample", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => apiResponse([]));
    const deps = configured(fetch);

    const status = await runCli(["eval", "status", "--json"], deps);
    const run = await runCli(
      ["eval", "run", "--as-of", "2026-01-01T00:00:00.000Z", "--json"],
      deps,
    );

    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      maturity: "insufficient-sample",
      counts: { total: 0, development: 0, holdout: 0, adjudicated: 0 },
    });
    expect(JSON.parse(run.stdout)).toMatchObject({
      maturity: "insufficient-sample",
      counts: { listed: 0, adjudicated: 0, evaluated: 0, requestFailures: 0 },
      metrics: {
        expectedStatus: { numerator: 0, denominator: 0, rate: null },
        citationEntailment: {
          numerator: 0,
          denominator: 0,
          rate: null,
          assessment: "not-assessed",
        },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the canonical list, get, export, and adjudication operations", async () => {
    const example = {
      evaluationExampleId: "example-1",
      exampleKey: "cli:pack-1",
      question: "What is our ICP?",
      evidenceMode: "mixed",
      riskLevel: "ordinary",
      answerStatus: "answered",
      split: "development",
      evidenceReferences: [],
      expectedEvidenceReferences: [],
      updatedAt: 42,
    };
    const canonicalExport = {
      schemaVersion: 1,
      exportHash: "sha256:export",
      evidenceExcerptsIncluded: false,
      examples: [{ exampleKey: "cli:pack-1", question: "What is our ICP?" }],
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(apiResponse([example]))
      .mockResolvedValueOnce(apiResponse(example))
      .mockResolvedValueOnce(apiResponse(canonicalExport))
      .mockResolvedValueOnce(
        apiResponse({ ...example, expectedAnswerStatus: "answered" }),
      );
    const deps = configured(fetch);

    const listed = await runCli(
      ["eval", "list", "--split", "development", "--limit", "10", "--json"],
      deps,
    );
    const shown = await runCli(["eval", "show", "cli:pack-1", "--json"], deps);
    const exported = await runCli(
      ["eval", "export", "--split", "development"],
      deps,
    );
    const adjudicated = await runCli(
      [
        "eval",
        "adjudicate",
        "cli:pack-1",
        "--expected-updated-at",
        "42",
        "--expected",
        "answered",
        "--risk",
        "ordinary",
        "--support",
        "slack:C1:message:1|revision-1|hash-1",
      ],
      deps,
    );

    expect(listed.exitCode).toBe(0);
    expect(shown.exitCode).toBe(0);
    expect(JSON.parse(exported.stdout)).toEqual(canonicalExport);
    expect(adjudicated.exitCode).toBe(0);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.test/api/brain.evaluations.list",
      "https://api.example.test/api/brain.evaluations.get",
      "https://api.example.test/api/brain.evaluations.export",
      "https://api.example.test/api/brain.evaluations.adjudicate",
    ]);
    expect(requestBody(fetch, 0).input).toEqual({
      split: "development",
      limit: 10,
    });
    expect(requestBody(fetch, 1).input).toEqual({ exampleKey: "cli:pack-1" });
    expect(requestBody(fetch, 2).input).toEqual({ split: "development" });
    expect(requestBody(fetch, 3).input).toEqual({
      exampleKey: "cli:pack-1",
      expectedUpdatedAt: 42,
      expectedAnswerStatus: "answered",
      riskLevel: "ordinary",
      expectedEvidenceReferences: [
        {
          sourceKey: "slack:C1:message:1",
          revisionKey: "revision-1",
          contentHash: "hash-1",
        },
      ],
    });
    expect(requestBody(fetch, 3).idempotencyKey).toMatch(
      /^brain-evaluation-adjudicate:[a-f0-9]{64}$/u,
    );
  });

  it("applies only the exact freeze preview the operator reviewed", async () => {
    const previewHash = `sha256:${"a".repeat(64)}`;
    const preview = {
      cutoffCreatedAt: 1_700_000_000_000,
      eligibleCount: 30,
      previewHash,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(apiResponse(preview))
      .mockResolvedValueOnce(
        apiResponse({ frozenCount: 30, freezeKey: "freeze-1" }),
      );
    const deps = configured(fetch);

    const previewResult = await runCli(
      ["eval", "freeze", "--after", "1700000000000", "--json"],
      deps,
    );
    const result = await runCli(
      [
        "eval",
        "freeze",
        "--after",
        "1700000000000",
        "--apply",
        "--preview-hash",
        previewHash,
        "--json",
      ],
      deps,
    );

    expect(previewResult.exitCode).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.test/api/brain.evaluations.freezePreview",
      "https://api.example.test/api/brain.evaluations.freezeApply",
    ]);
    expect(requestBody(fetch, 0).input).toEqual({
      cutoffCreatedAt: 1_700_000_000_000,
    });
    expect(requestBody(fetch, 1).input).toMatchObject({
      cutoffCreatedAt: 1_700_000_000_000,
      expectedPreviewHash: previewHash,
    });
    expect(requestBody(fetch, 1).input.freezeKey).toBe(
      requestBody(fetch, 1).idempotencyKey,
    );
  });

  it("refuses to apply a freeze without the reviewed cutoff and preview hash", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const deps = configured(fetch);

    const missingCutoff = await runCli(
      [
        "eval",
        "freeze",
        "--apply",
        "--preview-hash",
        `sha256:${"a".repeat(64)}`,
      ],
      deps,
    );
    const missingHash = await runCli(
      ["eval", "freeze", "--after", "1700000000000", "--apply"],
      deps,
    );

    expect(missingCutoff.exitCode).toBe(1);
    expect(missingCutoff.stderr).toContain("reviewed --after cutoff");
    expect(missingHash.exitCode).toBe(1);
    expect(missingHash.stderr).toContain("requires --preview-hash");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reruns every adjudicated example with one asOf and exact denominators", async () => {
    const references = [
      {
        sourceKey: "slack:C1:message:1",
        revisionKey: "revision-1",
        contentHash: "hash-1",
      },
    ];
    const examples = [
      {
        evaluationExampleId: "example-1",
        exampleKey: "cli:pack-1",
        question: "What is our ICP?",
        evidenceMode: "mixed",
        riskLevel: "ordinary",
        expectedAnswerStatus: "answered",
        answerStatus: "answered",
        packHash: "sha256:old-1",
        expectedEvidenceReferences: references,
        evidenceReferences: references,
        split: "holdout",
        createdAt: 1,
      },
      {
        evaluationExampleId: "example-2",
        exampleKey: "cli:pack-2",
        question: "What is missing?",
        evidenceMode: "recent_evidence",
        riskLevel: "high",
        expectedAnswerStatus: "insufficient-context",
        answerStatus: "insufficient-context",
        packHash: "sha256:old-2",
        expectedEvidenceReferences: [],
        evidenceReferences: [
          {
            sourceKey: "slack:captured-but-rejected",
            revisionKey: "revision-old",
            contentHash: "hash-old",
          },
        ],
        split: "holdout",
        createdAt: 2,
      },
    ];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(apiResponse(examples))
      .mockResolvedValueOnce(
        apiResponse({
          status: "answered",
          answerMarkdown: "Answer [1]",
          contextPack: {
            packHash: "sha256:new-1",
            citations: [{ ...references[0], reopeningStatus: "exact" }],
          },
        }),
      )
      .mockResolvedValueOnce(
        apiResponse({ ...references[0], tombstone: false }),
      )
      .mockResolvedValueOnce(
        apiResponse({
          status: "insufficient-context",
          reason: "no-eligible-evidence",
          contextPack: { packHash: "sha256:old-2", citations: [] },
        }),
      );
    const deps = configured(fetch);
    const asOf = "1787961600000";

    const result = await runCli(
      ["eval", "run", "--split", "holdout", "--as-of", asOf, "--json"],
      deps,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      asOf: Number(asOf),
      maturity: "insufficient-sample",
      counts: { listed: 2, adjudicated: 2, evaluated: 2, requestFailures: 0 },
      metrics: {
        expectedStatus: { numerator: 2, denominator: 2, rate: 1 },
        correctAbstention: { numerator: 1, denominator: 1, rate: 1 },
        supportingSourceRecallAt5: { numerator: 1, denominator: 1, rate: 1 },
        citationExactIdentity: { numerator: 1, denominator: 1, rate: 1 },
        citationReopening: {
          numerator: 1,
          denominator: 1,
          rate: 1,
          availability: "reported",
        },
        citationEntailment: {
          numerator: 0,
          denominator: 0,
          rate: null,
          assessment: "not-assessed",
        },
        packDrift: { unchanged: 1, changed: 1, denominator: 2 },
      },
    });
    expect(requestBody(fetch, 0).input).toEqual({
      split: "holdout",
      adjudicationState: "adjudicated",
      includeHoldoutGold: true,
      limit: 100,
    });
    expect(requestBody(fetch, 1).input).toEqual({
      question: "What is our ICP?",
      evidenceMode: "mixed",
      riskLevel: "ordinary",
      maxCitations: 5,
      asOf: Number(asOf),
    });
    expect(requestBody(fetch, 2).input).toEqual({
      sourceKey: "slack:C1:message:1",
      revisionKey: "revision-1",
    });
    expect(fetch.mock.calls[2]?.[0]).toBe(
      "https://api.example.test/api/brain.evidence.sourceGet",
    );
    expect(requestBody(fetch, 3).input).toEqual({
      question: "What is missing?",
      evidenceMode: "recent_evidence",
      riskLevel: "high",
      maxCitations: 5,
      asOf: Number(asOf),
    });
  });

  it("paginates reruns and does not mistake a different revision for gold", async () => {
    const expectedReference = {
      sourceKey: "slack:C1:message:1",
      revisionKey: "revision-expected",
      contentHash: "hash-expected",
    };
    const first = {
      evaluationExampleId: "example-1",
      exampleKey: "example-1",
      question: "What is our ICP?",
      evidenceMode: "mixed",
      riskLevel: "ordinary",
      expectedAnswerStatus: "answered",
      expectedEvidenceReferences: [expectedReference],
      evidenceReferences: [expectedReference],
      split: "holdout",
      createdAt: 1,
    };
    const second = {
      evaluationExampleId: "example-2",
      exampleKey: "example-2",
      question: "What do we not know?",
      evidenceMode: "recent_evidence",
      riskLevel: "high",
      expectedAnswerStatus: "insufficient-context",
      expectedEvidenceReferences: [],
      evidenceReferences: [],
      split: "holdout",
      createdAt: 2,
    };
    const observedReference = {
      sourceKey: expectedReference.sourceKey,
      revisionKey: "revision-different",
      contentHash: "hash-different",
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        apiResponse({
          examples: [first],
          nextCursorCreatedAt: 1,
          nextCursorExampleKey: "example-1",
        }),
      )
      .mockResolvedValueOnce(apiResponse({ examples: [second] }))
      .mockResolvedValueOnce(
        apiResponse({
          status: "answered",
          contextPack: {
            packHash: "sha256:new-1",
            citations: [observedReference],
          },
        }),
      )
      .mockResolvedValueOnce(
        apiResponse({ ...observedReference, tombstone: false }),
      )
      .mockResolvedValueOnce(
        apiResponse({
          status: "insufficient-context",
          contextPack: { packHash: "sha256:new-2", citations: [] },
        }),
      );

    const result = await runCli(
      ["eval", "run", "--as-of", "1787961600000", "--json"],
      configured(fetch),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      counts: { listed: 2, adjudicated: 2, evaluated: 2 },
      metrics: {
        supportingSourceRecallAt5: {
          numerator: 1,
          denominator: 1,
          rate: 1,
        },
        citationExactIdentity: { numerator: 0, denominator: 1, rate: 0 },
        citationReopening: { numerator: 1, denominator: 1, rate: 1 },
      },
    });
    expect(requestBody(fetch, 0).input).toEqual({
      split: "holdout",
      adjudicationState: "adjudicated",
      includeHoldoutGold: true,
      limit: 100,
    });
    expect(requestBody(fetch, 1).input).toEqual({
      split: "holdout",
      adjudicationState: "adjudicated",
      includeHoldoutGold: true,
      cursorCreatedAt: 1,
      cursorExampleKey: "example-1",
      limit: 100,
    });
  });

  it("requires explicit time and adjudication fencing for mutating or rerun commands", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const deps = configured(fetch);

    const run = await runCli(["eval", "run"], deps);
    const adjudicate = await runCli(
      [
        "eval",
        "adjudicate",
        "example-1",
        "--expected",
        "answered",
        "--risk",
        "ordinary",
      ],
      deps,
    );

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("requires --as-of");
    expect(adjudicate.exitCode).toBe(1);
    expect(adjudicate.stderr).toContain("--expected-updated-at");
    expect(fetch).not.toHaveBeenCalled();
  });
});
