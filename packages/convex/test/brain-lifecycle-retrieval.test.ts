import { describe, expect, it } from "vitest";

import {
  buildDsarDisposition,
  buildRetentionDisposition,
  revokeLifecycle,
  assertReadableLifecycle,
} from "../confect/brain/lifecycle";
import {
  buildAuthorizedRetrievalReceipt,
  reauthorizeRetrievalReceipt,
} from "../confect/brain/retrieval";

const auth = {
  workspaceId: "ws_1",
  brainKey: "br_1",
  principalId: "user_1",
  role: "viewer" as const,
  authorizationGeneration: 4,
  routeGeneration: 7,
  lifecycleGeneration: 2,
  policyGeneration: 3,
};

const candidate = {
  pageKey: "pag_1",
  revisionKey: "rev_1",
  lifecycleGeneration: 2,
  excerpt: "Launch is in May.",
};

describe("Brain lifecycle and authorized retrieval", () => {
  it("revokes monotonically and blocks revoked or expired reads", () => {
    expect(revokeLifecycle({ state: "active", generation: 2 }, 100)).toEqual({
      state: "revoked",
      generation: 3,
      updatedAt: 100,
    });
    expect(() =>
      assertReadableLifecycle(
        { state: "revoked", generation: 3, expiresAt: null },
        100,
      ),
    ).toThrow("LifecycleRevoked");
    expect(() =>
      assertReadableLifecycle(
        { state: "active", generation: 3, expiresAt: 100 },
        100,
      ),
    ).toThrow("LifecycleExpired");
  });

  it("makes retention and DSAR decisions without performing deletion", () => {
    expect(
      buildRetentionDisposition({
        resource: "brainPages",
        purgeAfter: 100,
        now: 100,
        legalHold: false,
      }),
    ).toEqual({ action: "purge", executable: false, reason: "retention_due" });
    expect(
      buildDsarDisposition({
        kind: "delete",
        confirmationMatches: true,
        legalHold: true,
      }),
    ).toEqual({ action: "blocked", executable: false, reason: "legal_hold" });
  });

  it("records immutable authorization and generation evidence", () => {
    const receipt = buildAuthorizedRetrievalReceipt({
      ...auth,
      query: "when is launch?",
      candidates: [candidate],
      now: 200,
    });
    expect(receipt).toMatchObject({
      state: "assembled",
      workspaceId: "ws_1",
      principalId: "user_1",
      authorizationGeneration: 4,
      routeGeneration: 7,
      lifecycleGeneration: 2,
      policyGeneration: 3,
    });
    expect(JSON.stringify(receipt)).not.toContain("when is launch?");
    expect(
      reauthorizeRetrievalReceipt(receipt, {
        ...auth,
        lifecycleGeneration: 3,
        now: 200,
      }),
    ).toMatchObject({ state: "stale" });
    expect(
      reauthorizeRetrievalReceipt(receipt, {
        ...auth,
        lifecycleState: "revoked",
        now: 200,
      }),
    ).toMatchObject({ state: "revoked" });
  });

  it("rejects expired retrieval assembly and reauthorization", () => {
    expect(() =>
      buildAuthorizedRetrievalReceipt({
        ...auth,
        lifecycleState: "active",
        expiresAt: 200,
        query: "when is launch?",
        candidates: [candidate],
        now: 200,
      }),
    ).toThrow("LifecycleExpired");

    const receipt = buildAuthorizedRetrievalReceipt({
      ...auth,
      query: "when is launch?",
      candidates: [candidate],
      now: 200,
    });
    expect(
      reauthorizeRetrievalReceipt(receipt, {
        ...auth,
        lifecycleState: "active",
        expiresAt: 200,
        now: 200,
      }),
    ).toMatchObject({ state: "revoked" });
  });
});
