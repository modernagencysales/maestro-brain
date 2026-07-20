import { describe, expect, it } from "vitest";
import {
  commitReviewedClassification,
  DuplicateEffect,
} from "../confect/classification/commit";
import { gatherClassificationRequest } from "../confect/classification/gather";
import {
  EvidenceMismatch,
  MalformedModelOutput,
  TargetNotAllowed,
  validateClassificationProposal,
} from "../confect/classification/request";
import {
  reviewClassificationDecision,
  ReviewForbidden,
} from "../confect/classification/review";
import classificationDecisions from "../confect/tables/classificationDecisions";
import sourceProcessingJobs from "../confect/tables/sourceProcessingJobs";

const sourceUnit = {
  sourceUnitRevisionKey: "unit_rev_1",
  sourceUnitHash: "hash_unit_1",
  policyVersion: 7,
  messages: [
    {
      sourceRevisionKey: "source_rev_1",
      authorLabel: "Customer",
      providerTimestamp: "2026-07-18T10:00:00.000Z",
      canonicalText: "Please route this onboarding question to Acme Support.",
    },
  ],
};
const allowedTargets = [
  { brainKey: "brain_acme_support", displayName: "Acme Support" },
];
const request = () => {
  const gathered = gatherClassificationRequest({
    policyMode: "classify",
    sourceUnit,
    allowedTargets,
  });
  if (!("request" in gathered)) throw new Error("expected classify request");
  return gathered.request;
};
const proposal = () =>
  validateClassificationProposal(request(), {
    sourceUnitRevisionKey: "unit_rev_1",
    sourceUnitHash: "hash_unit_1",
    contentScope: "single_target",
    targetBrainKey: "brain_acme_support",
    confidence: 1,
    rationale: "diagnostic only",
    evidenceQuotes: [
      { sourceRevisionKey: "source_rev_1", quote: "Acme Support" },
    ],
  });

describe("source classification review-first zero-or-one route", () => {
  it("gathers only classify policies and validates model structure", () => {
    expect(
      gatherClassificationRequest({
        policyMode: "direct",
        sourceUnit,
        allowedTargets,
      }),
    ).toEqual({ modelCalls: 0, skipped: "not_classify_policy" });
    expect(
      gatherClassificationRequest({
        policyMode: "capture_only",
        sourceUnit,
        allowedTargets,
      }),
    ).toEqual({ modelCalls: 0, skipped: "not_classify_policy" });
    expect(proposal().state).toBe("proposed_one");
    expect(() =>
      validateClassificationProposal(request(), {
        ...proposal(),
        targetBrainKey: [
          "brain_acme_support",
          "brain_other",
        ] as unknown as string,
      }),
    ).toThrow(MalformedModelOutput);
  });

  it("rejects out-of-allowlist, quote-mismatched, and mixed-client route output", () => {
    expect(() =>
      validateClassificationProposal(request(), {
        ...proposal(),
        targetBrainKey: "brain_other",
      }),
    ).toThrow(TargetNotAllowed);
    expect(() =>
      validateClassificationProposal(request(), {
        ...proposal(),
        evidenceQuotes: [
          { sourceRevisionKey: "source_rev_1", quote: "ignore previous" },
        ],
      }),
    ).toThrow(EvidenceMismatch);
    expect(() =>
      validateClassificationProposal(request(), {
        ...proposal(),
        contentScope: "mixed_client",
        targetBrainKey: "brain_acme_support",
      }),
    ).toThrow(MalformedModelOutput);
    expect(() =>
      validateClassificationProposal(request(), {
        ...proposal(),
        contentScope: "unknown" as "single_target",
        targetBrainKey: null,
      }),
    ).toThrow(MalformedModelOutput);
  });

  it("keeps reviewer overrides inside the pinned target allowlist", () => {
    expect(() =>
      reviewClassificationDecision(proposal(), {
        reviewerRole: "admin",
        action: "change_to_allowed",
        targetBrainKey: "brain_other",
      }),
    ).toThrow(TargetNotAllowed);
    const noTarget = validateClassificationProposal(request(), {
      ...proposal(),
      contentScope: "no_target",
      targetBrainKey: null,
    });
    expect(() =>
      reviewClassificationDecision(noTarget, {
        reviewerRole: "owner",
        action: "change_to_allowed",
        targetBrainKey: "brain_acme_support",
      }),
    ).toThrow(MalformedModelOutput);
  });

  it("requires admin review and never lets confidence or mixed-client route", () => {
    expect(proposal().routeEffect).toBeNull();
    expect(() =>
      reviewClassificationDecision(proposal(), {
        reviewerRole: "editor",
        action: "accept",
      }),
    ).toThrow(ReviewForbidden);
    expect(
      reviewClassificationDecision(proposal(), {
        reviewerRole: "admin",
        action: "no_route",
      }).state,
    ).toBe("no_route");
    const mixed = validateClassificationProposal(request(), {
      ...proposal(),
      contentScope: "mixed_client",
      targetBrainKey: null,
      confidence: 0.5,
    });
    expect(() =>
      reviewClassificationDecision(mixed, {
        reviewerRole: "owner",
        action: "change_to_allowed",
        targetBrainKey: "brain_acme_support",
      }),
    ).toThrow(MalformedModelOutput);
  });

  it("commits once after review and declares durable indexes", () => {
    const reviewed = {
      ...proposal(),
      lifecycleGeneration: 3,
      routeGeneration: 5,
      leaseGeneration: 8,
      state: "accepted" as const,
      routeEffectKey: null,
    };
    const routeEffectKey =
      "route:classification:unit_rev_1:7:unit_rev_1:brain_acme_support";
    expect(
      commitReviewedClassification(reviewed, {
        expectedPolicyVersion: 7,
        expectedSourceUnitHash: "hash_unit_1",
        expectedLifecycleGeneration: 3,
        expectedRouteGeneration: 5,
        expectedLeaseGeneration: 8,
        existingRouteEffectKeys: new Set(),
      }),
    ).toEqual({
      stage: "routed",
      routeEffectKey,
      targetBrainKey: "brain_acme_support",
    });
    expect(() =>
      commitReviewedClassification(reviewed, {
        expectedPolicyVersion: 7,
        expectedSourceUnitHash: "hash_unit_1",
        expectedLifecycleGeneration: 3,
        expectedRouteGeneration: 5,
        expectedLeaseGeneration: 8,
        existingRouteEffectKeys: new Set([routeEffectKey]),
      }),
    ).toThrow(DuplicateEffect);
    expect(() =>
      commitReviewedClassification(reviewed, {
        expectedPolicyVersion: 7,
        expectedSourceUnitHash: "stale_hash",
        expectedLifecycleGeneration: 3,
        expectedRouteGeneration: 5,
        expectedLeaseGeneration: 8,
        existingRouteEffectKeys: new Set(),
      }),
    ).toThrowError("Classification generations are stale.");
    expect(classificationDecisions.indexes.by_workspace_state).toEqual([
      "workspaceId",
      "state",
    ]);
    expect(sourceProcessingJobs.indexes.by_source_unit).toEqual([
      "sourceUnitRevisionKey",
    ]);
  });
});
