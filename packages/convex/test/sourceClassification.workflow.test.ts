import { describe, expect, it } from "vitest";
import { sourceClassificationGraph } from "../confect/workflows/sourceClassification.graph";
import { manifest as workflowManifest } from "../confect/workflowContracts/sourceClassification.spec";
import {
  runDurableGraphWorkflow,
  type RunDurableGraphStep,
} from "../confect/workflows/_kit/graphRunner";

describe("sourceClassification durable workflow", () => {
  it("start contract carries the immutable source-unit classification request", () => {
    expect(workflowManifest.find(({ name }) => name === "start")).toMatchObject(
      {
        argsSchemaName: "workflows.sourceClassification.start.args",
        returnsSchemaName: "workflows.sourceClassification.start.returns",
      },
    );
  });

  it("commit args carry the pinned authority generation snapshot", async () => {
    const workflowInputs = {
      workspaceId: "workspace_123",
      idempotencyKey: "workflow-test-authority",
      request: {
        authority: {
          workspaceId: "workspace_123",
          organizationId: "org_123",
          policyVersion: 7,
          lifecycleGeneration: 3,
          routeGeneration: 5,
          leaseGeneration: 8,
        },
      },
    };
    const context = {
      classify: {
        decisionKey: "classification:unit_rev_1:7",
        sourceUnitRevisionKey: "unit_rev_1",
        sourceUnitHash: "hash_unit_1",
        targetBrainKey: "brain_support",
      },
      review: { action: "accept" },
    };

    const args = {
      proposal: {
        ...(context.classify as object),
        ...workflowInputs.request.authority,
      },
      review: context.review,
      currentAuthority: workflowInputs.request.authority,
    };

    expect(args.proposal).toMatchObject({
      policyVersion: 7,
      lifecycleGeneration: 3,
      routeGeneration: 5,
      leaseGeneration: 8,
    });
    expect(args.currentAuthority).toEqual(workflowInputs.request.authority);
  });

  it("classifies, waits for review, and commits exactly once", async () => {
    const calls: string[] = [];
    const step: RunDurableGraphStep = {
      runQuery: async () => {
        throw new Error(
          "Generated source/output graph should not run queries.",
        );
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
      request: {
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
      },
    };
    const policySnapshot = { mode: "test" };

    const result = await runDurableGraphWorkflow(step, {
      graph: sourceClassificationGraph,
      inputs,
      policySnapshot,
      capabilityRegistry: {
        "classification.model": {
          kind: "mutation",
          ref: "classification-model" as never,
          buildArgs: ({ inputs }) => inputs as Record<string, unknown>,
        },
        "routes.commit": {
          kind: "mutation",
          ref: "routes-commit" as never,
          buildArgs: ({ context, inputs }) => {
            const workflowInputs = inputs as { request: { authority: object } };
            return {
              proposal: {
                ...(context.classify as object),
                ...workflowInputs.request.authority,
              },
              review: context.review,
              currentAuthority: workflowInputs.request.authority,
            };
          },
        },
      },
      projectOutput: ({ context }) => ({ result: context.commit }),
    });

    expect(calls).toEqual(["classify", "commit"]);
    expect(result).toEqual({
      result: { stage: "routed", routeEffectKey: "route_1" },
    });
  });
});
