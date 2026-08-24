import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { BrainPageRow } from "../confect/tables/brainPages";

describe("Brain page table contract", () => {
  it("retains the historical stable-page metadata deployed to staging", () => {
    const historicalRow = {
      workspaceId: "workspace_123",
      organizationId: "organization_123",
      slug: "proof-and-assets",
      title: "Proof and assets",
      markdown: "# Proof and assets",
      sourceKind: "markdown",
      pageKey: "pag_br_proof_assets",
      parentPageKey: null,
      siblingSlug: "proof-and-assets",
      sortKey: "0000000006",
      favorite: false,
      status: "active",
      currentRevisionKey: "rev_proof_assets_1",
      lifecycle: {
        state: "active",
        generation: 1,
        updatedAt: 2,
        purgeAfter: null,
      },
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 1,
    } as const;

    expect(Schema.decodeUnknownSync(BrainPageRow)(historicalRow)).toEqual(
      historicalRow,
    );
  });
});
