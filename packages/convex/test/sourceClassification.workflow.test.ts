import { describe, expect, it } from "vitest";
import { manifest as capabilityManifest } from "../confect/capabilities/classifySourceUnit.spec";
import { sourceClassificationGraph } from "../confect/workflows/sourceClassification.graph";
import { manifest as workflowManifest } from "../confect/workflowContracts/sourceClassification.spec";
import {
  runDurableGraphWorkflow,
  type RunDurableGraphStep,
} from "../confect/workflows/_kit/graphRunner";

describe("sourceClassification durable workflow", () => {
  it("start contract carries only the immutable source-unit key", () => {
    expect(workflowManifest.find(({ name }) => name === "start")).toMatchObject(
      {
        argsSchemaName: "workflows.sourceClassification.start.args",
        returnsSchemaName: "workflows.sourceClassification.start.returns",
      },
    );
  });

  it("contract exposes classification typed failures and server-gathered start", () => {
    const start = workflowManifest.find(({ name }) => name === "start");
    const approve = workflowManifest.find(({ name }) => name === "approve");

    expect(start?.typedErrors).toEqual(
      expect.arrayContaining([
        "MalformedModelOutput",
        "TargetNotAllowed",
        "EvidenceMismatch",
        "ReviewForbidden",
        "StaleGeneration",
        "DuplicateEffect",
      ]),
    );
    expect(approve?.typedErrors).toEqual(start?.typedErrors);
    expect(start?.argsSchemaName).toBe(
      "workflows.sourceClassification.start.args",
    );
  });

  it("gather and commit entries are backed by typed capability contracts", () => {
    expect(
      sourceClassificationGraph.nodes
        .filter((node) => node.kind === "capability")
        .map((node) => node.capability),
    ).toEqual([
      "classification.gather",
      "classification.model",
      "classification.currentAuthority",
      "routes.commit",
    ]);
    expect(sourceClassificationGraph.nodes[1]).toMatchObject({
      id: "gather",
      kind: "capability",
      capability: "classification.gather",
    });
    expect(
      capabilityManifest.find(({ name }) => name === "commitSourceRoute"),
    ).toMatchObject({
      namespace: "capabilities.classifySourceUnit",
      operationId: "capabilities.classifySourceUnit.commitSourceRoute",
      kind: "mutation",
      surfaces: ["workflow", "internal"],
      typedErrors: expect.arrayContaining([
        "ReviewForbidden",
        "StaleGeneration",
        "DuplicateEffect",
      ]),
    });
  });

  it("classifies, waits for review, and commits exactly once", async () => {
    const calls: string[] = [];
    const step: RunDurableGraphStep = {
      runQuery: async () => {
        calls.push("gather");
        return calls.length === 1
          ? {
              workspaceId: "workspace_123",
              organizationId: "org_123",
              sourceUnitRevisionKey: "unit_rev_1",
              sourceUnitHash: "hash_unit_1",
              messages: [
                {
                  sourceRevisionKey: "source_rev_1",
                  authorLabel: "Customer",
                  providerTimestamp: "2026-07-18T10:00:00.000Z",
                  canonicalText: "Please route this to Acme Support.",
                },
              ],
              policyVersion: 7,
              lifecycleGeneration: 3,
              routeGeneration: 5,
              leaseGeneration: 8,
              allowedTargets: [
                {
                  workspaceId: "workspace_123",
                  organizationId: "org_123",
                  brainKey: "brain_support",
                  displayName: "Acme Support",
                },
              ],
              authority: {
                workspaceId: "workspace_123",
                organizationId: "org_123",
                policyVersion: 7,
                lifecycleGeneration: 3,
                routeGeneration: 5,
                leaseGeneration: 8,
              },
            }
          : {
              workspaceId: "workspace_123",
              organizationId: "org_123",
              policyVersion: 7,
              lifecycleGeneration: 4,
              routeGeneration: 6,
              leaseGeneration: 9,
            };
      },
      runMutation: async (_ref, args) => {
        calls.push(args.review ? "commit" : "classify");
        return args.review
          ? { stage: "routed", routeEffectKey: "route_1" }
          : { contentScope: "single_target", targetBrainKey: "brain_support" };
      },
      runAction: async () => {
        throw new Error(
          "Generated source/output graph should not run actions.",
        );
      },
      sleep: async () => {},
      awaitEvent: async <Result>() =>
        ({
          action: "accept",
          reviewerPrincipalKey: "user_admin",
          reviewerAuthority: {
            workspaceId: "workspace_123",
            organizationId: "org_123",
            role: "admin",
          },
        }) as Result,
    };

    const inputs = {
      workspaceId: "workspace_123",
      idempotencyKey: "workflow-test-1",
      sourceUnitRevisionKey: "unit_rev_1",
    };
    const policySnapshot = { mode: "test" };

    const result = await runDurableGraphWorkflow(step, {
      graph: sourceClassificationGraph,
      inputs,
      policySnapshot,
      capabilityRegistry: {
        "classification.gather": {
          kind: "query",
          ref: "classification-gather" as never,
          buildArgs: ({ inputs }) => inputs as Record<string, unknown>,
        },
        "classification.model": {
          kind: "mutation",
          ref: "classification-model" as never,
          buildArgs: ({ context }) => ({ request: context.gather }),
        },
        "classification.currentAuthority": {
          kind: "query",
          ref: "classification-authority" as never,
          buildArgs: ({ inputs }) => inputs as Record<string, unknown>,
        },
        "routes.commit": {
          kind: "mutation",
          ref: "routes-commit" as never,
          buildArgs: ({ context }) => ({
            proposal: {
              ...(context.classify as object),
              ...(context.gather as { authority: object }).authority,
            },
            review: context.review,
            currentAuthority: context.currentAuthority,
          }),
        },
      },
      projectOutput: ({ context }) => ({ result: context.commit }),
    });

    expect(calls).toEqual(["gather", "classify", "gather", "commit"]);
    expect(result).toEqual({
      result: { stage: "routed", routeEffectKey: "route_1" },
    });
  });
});
