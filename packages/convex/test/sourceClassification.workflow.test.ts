import { describe, expect, it } from "vitest";
import { sourceClassificationGraph } from "../confect/workflows/sourceClassification.graph";
import {
  runDurableGraphWorkflow,
  type RunDurableGraphStep,
} from "../confect/workflows/_kit/graphRunner";

describe("sourceClassification durable workflow", () => {
  it("classifies, waits for review, and commits exactly once", async () => {
    const calls: string[] = [];
    const step: RunDurableGraphStep = {
      runQuery: async (ref) => {
        if (ref === ("classification.gather" as never))
          return {
            workspaceId: inputs.workspaceId,
            organizationId: "org_support",
            sourceUnitRevisionKey: inputs.request.sourceUnitRevisionKey,
            sourceUnitHash: "hash_1",
            policyVersion: 1,
            lifecycleGeneration: 1,
            routeGeneration: 1,
            leaseGeneration: 1,
            messages: [],
            allowedTargets: [],
            authority: {
              workspaceId: inputs.workspaceId,
              organizationId: "org_support",
              policyVersion: 1,
              lifecycleGeneration: 1,
              routeGeneration: 1,
              leaseGeneration: 1,
            },
          };
        if (ref === ("classification.currentAuthority" as never))
          return {
            workspaceId: inputs.workspaceId,
            organizationId: "org_support",
            policyVersion: 1,
            lifecycleGeneration: 1,
            routeGeneration: 1,
            leaseGeneration: 1,
          };
        throw new Error("Unexpected workflow query capability.");
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
          reviewerRole: "admin",
        }) as Result,
    };

    const inputs = {
      workspaceId: "workspace_123",
      idempotencyKey: "workflow-test-1",
      request: { sourceUnitRevisionKey: "unit_rev_1" },
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
        "classification.gather": {
          kind: "query",
          ref: "classification.gather" as never,
          buildArgs: ({ inputs }) => inputs as Record<string, unknown>,
        },
        "classification.currentAuthority": {
          kind: "query",
          ref: "classification.currentAuthority" as never,
          buildArgs: ({ inputs }) => inputs as Record<string, unknown>,
        },
        "routes.commit": {
          kind: "mutation",
          ref: "routes-commit" as never,
          buildArgs: ({ context }) => ({
            proposal: context.classify,
            review: context.review,
          }),
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
