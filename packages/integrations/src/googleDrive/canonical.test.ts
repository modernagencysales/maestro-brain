import { describe, expect, it } from "vitest";

import {
  classifyDriveObservation,
  DriveSourceDecodeError,
  driveConnectorScope,
  normalizeDriveFile,
} from "./canonical";

const scope = {
  connectionKey: "gdrive_connection",
  connectionGeneration: 3,
  driveId: "shared_drive_1",
  rootFolderIds: ["folder_b", "folder_a", "folder_a"],
  allowlistGeneration: 4,
  sharedDrive: true,
} as const;

const file = {
  id: "file_1",
  name: "Operating plan",
  mimeType: "application/vnd.google-apps.document",
  version: "42",
  modifiedTime: "2026-08-21T12:00:00.000Z",
  webViewLink: "https://drive.google.com/open?id=file_1",
  trashed: false,
  parents: ["folder_a"],
} as const;

describe("Google Drive source contract", () => {
  it("derives one stable shared-container scope from sorted unique roots", () => {
    const first = driveConnectorScope(scope);
    const second = driveConnectorScope({
      ...scope,
      rootFolderIds: ["folder_a", "folder_b"],
    });

    expect(first).toEqual(second);
    expect(first.rootFolderIds).toEqual(["folder_a", "folder_b"]);
    expect(first.connectorScopeKey).toMatch(/^gds_[a-f0-9]{64}$/);
  });

  it("rejects personal Drive scopes", () => {
    expect(() =>
      driveConnectorScope({ ...scope, sharedDrive: false }),
    ).toThrowError(
      expect.objectContaining<Partial<DriveSourceDecodeError>>({
        _tag: "DriveSourceDecodeError",
        reason: "personal_drive_not_allowed",
      }),
    );
  });

  it("normalizes Google-native exports without making connection identity the object identity", () => {
    const normalized = normalizeDriveFile({
      scope,
      file,
      exportMimeType: "text/plain",
      exportedText: "Heading\r\n\r\nBody  \r\n",
      observedAt: 1_777_777_777_000,
      permissionSnapshotHash: "a".repeat(64),
      retentionClass: "internal_company",
    });

    expect(normalized).toMatchObject({
      providerKey: "google_drive",
      providerObjectKey: "file_1",
      providerRevisionKey: "file_1:version:42",
      observationOrder: { kind: "file_version", version: "42" },
      title: "Operating plan",
      normalizedText: "Heading\n\nBody",
      exportMimeType: "text/plain",
      normalizationVersion: 1,
      tombstone: false,
    });
    expect(normalized.connectorScopeKey).toBe(
      driveConnectorScope(scope).connectorScopeKey,
    );
  });

  it("classifies duplicate, stale, newer, and equal-order conflicts independently from revision keys", () => {
    const base = normalizeDriveFile({
      scope,
      file,
      exportMimeType: "text/plain",
      exportedText: "Current body",
      observedAt: 1_777_777_777_000,
      permissionSnapshotHash: "b".repeat(64),
      retentionClass: "internal_company",
    });

    expect(classifyDriveObservation(base, base)).toBe("duplicate");
    expect(
      classifyDriveObservation(
        base,
        normalizeDriveFile({
          scope,
          file: { ...file, version: "41" },
          exportMimeType: "text/plain",
          exportedText: "Old body",
          observedAt: 1_777_777_778_000,
          permissionSnapshotHash: "b".repeat(64),
          retentionClass: "internal_company",
        }),
      ),
    ).toBe("stale");
    expect(
      classifyDriveObservation(
        base,
        normalizeDriveFile({
          scope,
          file: { ...file, version: "43" },
          exportMimeType: "text/plain",
          exportedText: "New body",
          observedAt: 1_777_777_778_000,
          permissionSnapshotHash: "b".repeat(64),
          retentionClass: "internal_company",
        }),
      ),
    ).toBe("newer");
    expect(
      classifyDriveObservation(base, { ...base, contentHash: "c".repeat(64) }),
    ).toBe("equal_order_conflict");
  });

  it("uses a closed reconciliation epoch for removal evidence and stores no copied text", () => {
    const tombstone = normalizeDriveFile({
      scope,
      file: { ...file, version: null, trashed: true },
      exportMimeType: null,
      exportedText: null,
      closedReconciliationEpoch: 9,
      observedAt: 1_777_777_779_000,
      permissionSnapshotHash: "d".repeat(64),
      retentionClass: "internal_company",
    });

    expect(tombstone.observationOrder).toEqual({
      kind: "reconciliation_epoch",
      epoch: 9,
    });
    expect(tombstone.tombstone).toBe(true);
    expect(tombstone.normalizedText).toBe("");
  });

  it("fails unsupported MIME types visibly", () => {
    expect(() =>
      normalizeDriveFile({
        scope,
        file: { ...file, mimeType: "application/zip" },
        exportMimeType: null,
        exportedText: null,
        observedAt: 1_777_777_779_000,
        permissionSnapshotHash: "e".repeat(64),
        retentionClass: "internal_company",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DriveSourceDecodeError>>({
        reason: "unsupported_mime_type",
      }),
    );
  });
});
