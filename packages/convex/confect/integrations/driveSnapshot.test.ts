import type { GoogleDriveSourceObservation } from "@maestro-template/integrations/nango/googleDrive";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  buildDriveEvidenceItems,
  DRIVE_SEGMENT_MAX_CHARACTERS,
} from "./driveSnapshot";

const observation = (
  contentText: string | null,
  overrides: Partial<GoogleDriveSourceObservation> = {},
): GoogleDriveSourceObservation => ({
  providerKey: "google_drive",
  sourceKey: "google_drive:file:file-1",
  providerObjectId: "file-1",
  revisionKey: "google_drive:file:file-1:file_version:7",
  observationOrder: { kind: "file_version", value: "7" },
  sourceModifiedAt: 1_787_700_000_000,
  observedAt: 1_787_700_001_000,
  sourceLocator: "https://drive.google.com/open?id=file-1",
  tombstone: false,
  metadata: {
    name: "Pilot handbook",
    mimeType: "application/vnd.google-apps.document",
    driveId: "drive-1",
    parentFolderIds: ["root"],
    createdAt: 1_787_600_000_000,
    version: "7",
    md5Checksum: null,
    sizeBytes: "42",
    contentText,
    contentStatus: contentText === null ? "metadata_only" : "text",
  },
  ...overrides,
});

const build = (observations: readonly GoogleDriveSourceObservation[]) =>
  buildDriveEvidenceItems(observations, {
    workspaceId: "workspace-1" as GenericId<"workspaces">,
    scopeKey: "gds_fake",
    runKey: "drive:3:1",
    observedAt: 1_787_700_001_000,
  });

describe("Google Drive evidence normalization", () => {
  it("keeps a small document as one exact reopenable segment", () => {
    const result = build([
      observation(
        "# Positioning\n\nApero helps fictional operators.\n\nSecond paragraph.",
      ),
    ]);
    const item = result.items[0];
    expect(item).toMatchObject({
      sourceKey: "google_drive:file:file-1:segment:0",
      title: "Drive · Pilot handbook",
      markdown:
        "# Positioning\n\nApero helps fictional operators.\n\nSecond paragraph.",
      locator: "https://drive.google.com/open?id=file-1",
    });
    expect(item?.revisionKey).toMatch(/^drive-segment-v1:[a-f0-9]{64}$/u);
    expect(JSON.parse(item?.providerMetadataJson ?? "{}")).toMatchObject({
      normalizationVersion: 1,
      fileId: "file-1",
      providerRevisionKey: "google_drive:file:file-1:file_version:7",
      segmentIndex: 0,
      segmentCount: 1,
      renderedStartOffset: 0,
      contentStatus: "text",
      headingBoundary: { text: "Positioning", startOffset: 0 },
    });
  });

  it("segments a near-2 MB input within the projector bound deterministically", () => {
    const paragraphs = Array.from(
      { length: 37_000 },
      (_, index) => `Paragraph ${index} contains a small bounded statement.`,
    ).join("\n\n");
    const inputBytes = new TextEncoder().encode(paragraphs).byteLength;
    expect(inputBytes).toBeGreaterThan(1_900_000);
    expect(inputBytes).toBeLessThan(2_000_000);

    const first = build([observation(paragraphs)]);
    const second = build([observation(paragraphs)]);
    expect(first).toEqual(second);
    expect(first.items.length).toBeGreaterThan(30);
    expect(
      first.items.every(
        ({ markdown }) => markdown.length <= DRIVE_SEGMENT_MAX_CHARACTERS,
      ),
    ).toBe(true);
    expect(first.capacityStates).toEqual([]);
  });

  it("records oversized content without publishing it as retrievable evidence", () => {
    const oversized = "x".repeat(DRIVE_SEGMENT_MAX_CHARACTERS + 1);
    const healthy = observation("A healthy second file.", {
      sourceKey: "google_drive:file:file-2",
      providerObjectId: "file-2",
      revisionKey: "google_drive:file:file-2:file_version:1",
      metadata: {
        ...observation("").metadata,
        name: "Healthy file",
        contentText: "A healthy second file.",
        contentStatus: "text",
      },
    });

    const result = build([observation(oversized), healthy]);
    expect(result.capacityStates).toEqual([
      {
        fileId: "file-1",
        fileName: "Pilot handbook",
        state: "oversized_paragraph",
      },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.markdown).toBe("A healthy second file.");
  });

  it("counts binary-only files without making their titles retrievable", () => {
    const result = build([observation(null)]);
    expect(result.metadataOnlyCount).toBe(1);
    expect(result.items).toEqual([]);
  });

  it("changes the revision but not the segment source identity after an edit", () => {
    const before = build([observation("One paragraph.")]).items[0];
    const after = build([
      observation("One edited paragraph.", {
        revisionKey: "google_drive:file:file-1:file_version:8",
        observationOrder: { kind: "file_version", value: "8" },
      }),
    ]).items[0];

    expect(after?.sourceKey).toBe(before?.sourceKey);
    expect(after?.revisionKey).not.toBe(before?.revisionKey);
  });
});
