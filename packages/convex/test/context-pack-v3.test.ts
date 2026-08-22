import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { ContextPackV3 } from "../confect/brain/contextPackV3";

const digest = `sha256:${"a".repeat(64)}`;

const freshButPartialPack = {
  schemaVersion: "3",
  candidateManifest: { version: "2", hash: digest },
  requestId: "ctx_contract",
  organizationKey: "organization_contract",
  brainKey: "brain_contract",
  question: "What changed?",
  asOf: 10,
  freshness: "current",
  coverageStatus: "partial",
  readiness: "blocked",
  coverage: [
    {
      corpusKey: "slack",
      sourceKind: "slack",
      connectorScopeKey: "scope_sales",
      required: true,
      status: "partial",
      freshness: "current",
      generations: {
        connection: 2,
        allowlist: 4,
        reconciliation: 7,
      },
      lastObservedAt: 9,
      lastReconciledAt: 8,
      unresolvedFailureCount: 1,
      reason: "obligations_nonterminal",
    },
  ],
  entries: [],
  structuredFacts: [],
  conflicts: [],
  structuredConflicts: [],
  omissions: [],
} as const;

describe("ContextPack v3 contract", () => {
  it("keeps current temporal freshness separate from partial blocked coverage", () => {
    expect(
      Schema.decodeUnknownSync(ContextPackV3)(freshButPartialPack),
    ).toEqual(freshButPartialPack);
  });

  it("rejects the former object freshness shape and missing readiness", () => {
    const withoutReadiness = Object.fromEntries(
      Object.entries(freshButPartialPack).filter(
        ([key]) => key !== "readiness",
      ),
    );

    expect(() =>
      Schema.decodeUnknownSync(ContextPackV3)({
        ...withoutReadiness,
        freshness: { status: "current" },
      }),
    ).toThrow();
  });
});
