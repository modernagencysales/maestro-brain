import { describe, expect, it } from "vitest";

import {
  buildDsarDisposition,
  buildRetentionDisposition,
  revokeLifecycle,
  assertReadableLifecycle,
} from "../confect/brain/lifecycle";
import {
  buildAuthorizedRetrievalReceipt,
  resolveTranscriptCitation,
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

  it("resolves only current tenant-scoped transcript segments", () => {
    const citation = {
      workspaceId: "ws_1",
      citationId: "citation_call_1",
      sourceId: "sunit_1",
      sourceKind: "call_transcript" as const,
      sourceTitle: "Acme weekly",
      quotedText: "We will launch on Friday.",
      startOffset: 0,
      endOffset: 25,
      pageKey: "pag_1",
      revisionKey: "rev_1",
      sourceUnitRevisionKey: "surev_1",
      segmentKey: "seg_1",
      startMs: 12_000,
      endMs: 15_400,
    };
    const unit = {
      organizationKey: "agency_acme",
      connectionKey: "conn_1",
      connectionGeneration: 2,
      providerKey: "fireflies",
      unitKey: "sunit_1",
      currentUnitRevisionKey: "surev_1",
      lifecycle: { state: "active", generation: 1 },
    };
    const revision = {
      organizationKey: "agency_acme",
      unitKey: "sunit_1",
      unitRevisionKey: "surev_1",
      sourceUrl: "https://app.fireflies.ai/view/call_1",
      tombstone: false,
    };
    const segment = {
      organizationKey: "agency_acme",
      unitKey: "sunit_1",
      unitRevisionKey: "surev_1",
      segmentKey: "seg_1",
      ordinal: 0,
      evidenceKind: "verbatim_transcript" as const,
      speakerLabel: "Alex",
      startMs: 12_000,
      endMs: 15_400,
      text: "We will launch on Friday.",
    };
    const connection = {
      organizationKey: "agency_acme",
      connectionKey: "conn_1",
      connectionGeneration: 2,
      status: "active",
    };
    const input = {
      workspaceId: "ws_1",
      organizationKey: "agency_acme",
      citation,
      unit,
      revision,
      segment,
      connection,
    };

    expect(resolveTranscriptCitation(input)).toMatchObject({
      citationKey: "citation_call_1",
      sourceKey: "sunit_1",
      sourceRevisionKey: "surev_1",
      locator: "timestamp:12000-15400",
      label: "Alex · 00:12",
      permalink: "https://app.fireflies.ai/view/call_1",
      quotedText: "We will launch on Friday.",
      freshness: "fresh",
      state: "resolved",
    });
    expect(
      resolveTranscriptCitation({
        ...input,
        connection: { ...connection, status: "revoked" },
      }),
    ).toBeNull();
    expect(
      resolveTranscriptCitation({
        ...input,
        unit: {
          ...unit,
          lifecycle: { state: "deleted_tombstone", generation: 2 },
        },
      }),
    ).toBeNull();
    expect(
      resolveTranscriptCitation({
        ...input,
        connection: { ...connection, connectionGeneration: 3 },
      }),
    ).toBeNull();
    expect(
      resolveTranscriptCitation({ ...input, workspaceId: "ws_foreign" }),
    ).toBeNull();
  });
});
