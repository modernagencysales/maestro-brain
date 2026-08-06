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
  workspaceId: "workspace_123",
  organizationId: "org_123",
  sourceUnitRevisionKey: "unit_rev_1",
  sourceUnitHash: "hash_unit_1",
  policyVersion: 7,
  lifecycleGeneration: 3,
  routeGeneration: 5,
  leaseGeneration: 8,
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
  {
    workspaceId: "workspace_123",
    organizationId: "org_123",
    brainKey: "brain_acme_support",
    displayName: "Acme Support",
  },
];
const authority = {
  workspaceId: "workspace_123",
  organizationId: "org_123",
  policyVersion: 7,
  lifecycleGeneration: 3,
  routeGeneration: 5,
  leaseGeneration: 8,
};

const request = () => {
  const gathered = gatherClassificationRequest({
    policyMode: "classify",
    sourceUnit,
    allowedTargets,
    authority,
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
        authority,
      }),
    ).toEqual({ modelCalls: 0, skipped: "not_classify_policy" });
    expect(
      gatherClassificationRequest({
        policyMode: "capture_only",
        sourceUnit,
        allowedTargets,
        authority,
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
    expect(() =>
      validateClassificationProposal(
        {
          ...request(),
          allowedTargets: [
            {
              workspaceId: "workspace_123",
              organizationId: "org_other",
              brainKey: "brain_acme_support",
              displayName: "Acme Support",
            },
          ],
        },
        proposal(),
      ),
    ).toThrow(MalformedModelOutput);
  });

  it("keeps reviewer overrides inside the pinned target allowlist", () => {
    expect(() =>
      reviewClassificationDecision(proposal(), {
        reviewerAuthority: {
          workspaceId: "workspace_123",
          organizationId: "org_123",
          role: "admin",
        },
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
        reviewerAuthority: {
          workspaceId: "workspace_123",
          organizationId: "org_123",
          role: "owner",
        },
        action: "change_to_allowed",
        targetBrainKey: "brain_acme_support",
      }),
    ).toThrow(MalformedModelOutput);
  });

  it("rejects cross-tenant gathered units and review authorities", () => {
    expect(() =>
      gatherClassificationRequest({
        policyMode: "classify",
        sourceUnit: { ...sourceUnit, organizationId: "org_other" },
        allowedTargets,
        authority,
      }),
    ).toThrowError("Classification request is not tenant-bound");
    expect(() =>
      reviewClassificationDecision(proposal(), {
        reviewerAuthority: {
          workspaceId: "workspace_123",
          organizationId: "org_other",
          role: "admin",
        },
        action: "accept",
      }),
    ).toThrow(ReviewForbidden);
  });

  it("requires admin review and never lets confidence or mixed-client route", () => {
    expect(proposal().routeEffect).toBeNull();
    expect(() =>
      reviewClassificationDecision(proposal(), {
        reviewerAuthority: {
          workspaceId: "workspace_123",
          organizationId: "org_123",
          role: "editor",
        },
        action: "accept",
      }),
    ).toThrow(ReviewForbidden);
    expect(
      reviewClassificationDecision(proposal(), {
        reviewerAuthority: {
          workspaceId: "workspace_123",
          organizationId: "org_123",
          role: "admin",
        },
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
        reviewerAuthority: {
          workspaceId: "workspace_123",
          organizationId: "org_123",
          role: "owner",
        },
        action: "change_to_allowed",
        targetBrainKey: "brain_acme_support",
      }),
    ).toThrow(MalformedModelOutput);
  });

  it("commits once after review and declares durable indexes", () => {
    const reviewed = {
      ...proposal(),
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
    expect(classificationDecisions.indexes.by_unit_policy_epoch).toEqual([
      "sourceUnitRevisionKey",
      "policyVersion",
    ]);
    expect(classificationDecisions.indexes.by_status_created).toEqual([
      "state",
      "createdAt",
    ]);
    expect(classificationDecisions.indexes.by_effect_key).toEqual([
      "effectKey",
    ]);
    expect(classificationDecisions.indexes.by_target_brain).toEqual([
      "targetBrainKey",
    ]);
    expect(sourceProcessingJobs.indexes.by_org_stage_status_next_retry).toEqual(
      ["organizationKey", "stage", "executionStatus", "nextRetryAt"],
    );
    expect(sourceProcessingJobs.indexes.by_org_effect_key).toEqual([
      "organizationKey",
      "effectKey",
    ]);
    expect(sourceProcessingJobs.indexes.by_org_unit_stage).toEqual([
      "organizationKey",
      "unitKey",
      "stage",
    ]);
    expect(sourceProcessingJobs.indexes.by_org_lease_expiry).toEqual([
      "organizationKey",
      "leaseExpiresAt",
    ]);
    expect(sourceProcessingJobs.indexes.by_organization_status).toEqual([
      "organizationKey",
      "executionStatus",
    ]);
  });
});
