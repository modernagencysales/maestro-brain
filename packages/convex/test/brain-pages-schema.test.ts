import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { BrainPageRow } from "../confect/tables/brainPages";
import {
  CurrentPageRevisionRow,
  LegacyPageRevisionRow,
} from "../confect/tables/pageRevisions";

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

  it("accepts both current editor history and the staged immutable ledger", () => {
    expect(
      Schema.decodeUnknownSync(CurrentPageRevisionRow)({
        workspaceId: "workspace_123",
        pageId: "brain_page_123",
        priorUpdatedAt: null,
        updatedAt: 2,
        title: "Proof and assets",
        markdown: "# Proof and assets",
        sourceKind: "markdown",
        causation: "create",
        parentPageId: null,
        sortKey: "proof-and-assets",
        favorite: false,
        status: "active",
        actorUserId: "user_123",
        createdAt: 2,
      }),
    ).toMatchObject({ causation: "create" });

    expect(
      Schema.decodeUnknownSync(LegacyPageRevisionRow)({
        workspaceId: "workspace_123",
        organizationId: "organization_123",
        pageKey: "pag_proof_assets",
        revisionKey: "rev_proof_assets_1",
        priorRevisionKey: null,
        blockNoteJson: "",
        markdown: "# Proof and assets",
        contentHash: "0b7fea9",
        causation: "human-edit",
        actor: { kind: "user", id: "user_123" },
        modelReceiptKey: null,
        effectKey: "brain.pages.create:pag_proof_assets:rev_proof_assets_1",
        state: "published",
        lifecycle: {
          state: "active",
          generation: 1,
          updatedAt: 2,
          purgeAfter: null,
        },
        createdAt: 2,
        schemaVersion: 1,
      }),
    ).toMatchObject({ causation: "human-edit", state: "published" });
  });
});
