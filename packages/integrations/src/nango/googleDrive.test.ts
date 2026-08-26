import { describe, expect, it, vi } from "vitest";

import {
  fetchGoogleDriveInventory,
  GoogleDriveCapacityExceeded,
} from "./googleDrive";

const response = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
const textResponse = (body: string) => new Response(body, { status: 200 });

const driveFile = (id: string, version: string) => ({
  id,
  name: `File ${id}`,
  mimeType: "application/vnd.google-apps.document",
  version,
  modifiedTime: "2026-08-26T01:00:00.000Z",
  createdTime: "2026-08-25T01:00:00.000Z",
  webViewLink: `https://drive.google.com/open?id=${id}`,
  trashed: false,
  parents: ["root"],
  size: "42",
});

const baseInput = {
  secretKey: "nango-secret",
  providerConfigKey: "google-drive",
  connectionId: "connection-1",
  connectionGeneration: 3,
  driveId: "shared-drive-1",
  rootFolderIds: ["root"],
  allowlistGeneration: 4,
  observedAt: 1_787_700_000_000,
} as const;

describe("Nango Google Drive source inventory", () => {
  it("fully paginates every folder and emits stable revision metadata", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          files: [
            driveFile("file-b", "2"),
            {
              id: "nested",
              name: "Nested",
              mimeType: "application/vnd.google-apps.folder",
              modifiedTime: "2026-08-26T01:00:00.000Z",
              webViewLink: "https://drive.google.com/open?id=nested",
              trashed: false,
              parents: ["root"],
            },
          ],
          nextPageToken: "root-page-2",
        }),
      )
      .mockResolvedValueOnce(textResponse("File B body\r\nSecond line"))
      .mockResolvedValueOnce(response({ files: [driveFile("file-a", "1")] }))
      .mockResolvedValueOnce(textResponse("File A body"))
      .mockResolvedValueOnce(response({ files: [driveFile("file-c", "3")] }))
      .mockResolvedValueOnce(textResponse("File C body"));

    const result = await fetchGoogleDriveInventory({ ...baseInput, request });

    expect(result).toMatchObject({
      complete: true,
      sourceCount: 3,
      pagesRead: 3,
      foldersScanned: 2,
      scope: {
        providerKey: "google_drive",
        connectionGeneration: 3,
        containerKey: "shared-drive-1",
        allowlistGeneration: 4,
        rootFolderIds: ["root"],
      },
    });
    expect(result.scope.scopeKey).toMatch(/^gds_[a-f0-9]{64}$/u);
    expect(result.observations.map(({ sourceKey }) => sourceKey)).toEqual([
      "google_drive:file:file-a",
      "google_drive:file:file-b",
      "google_drive:file:file-c",
    ]);
    expect(result.observations[0]).toMatchObject({
      providerObjectId: "file-a",
      revisionKey: "google_drive:file:file-a:file_version:1",
      observationOrder: { kind: "file_version", value: "1" },
      sourceModifiedAt: Date.parse("2026-08-26T01:00:00.000Z"),
      metadata: {
        mimeType: "application/vnd.google-apps.document",
        contentStatus: "text",
        contentText: "File A body",
      },
    });
    const secondUrl = new URL(String(request.mock.calls[2]?.[0]));
    expect(secondUrl.searchParams.get("pageToken")).toBe("root-page-2");
    const nestedUrl = new URL(String(request.mock.calls[4]?.[0]));
    expect(nestedUrl.searchParams.get("q")).toContain("'nested' in parents");
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer nango-secret",
      "Connection-Id": "connection-1",
      "Provider-Config-Key": "google-drive",
    });
  });

  it("derives the same scope key from reordered duplicate roots", async () => {
    const firstRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ files: [] }))
      .mockResolvedValueOnce(response({ files: [] }));
    const secondRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ files: [] }))
      .mockResolvedValueOnce(response({ files: [] }));

    const first = await fetchGoogleDriveInventory({
      ...baseInput,
      rootFolderIds: ["b", "a", "b"],
      request: firstRequest,
    });
    const second = await fetchGoogleDriveInventory({
      ...baseInput,
      rootFolderIds: ["a", "b"],
      request: secondRequest,
    });

    expect(first.scope.scopeKey).toBe(second.scope.scopeKey);
  });

  it("fails explicitly instead of truncating source inventory", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          files: [driveFile("file-a", "1"), driveFile("file-b", "1")],
        }),
      )
      .mockResolvedValueOnce(textResponse("File A body"));

    await expect(
      fetchGoogleDriveInventory({
        ...baseInput,
        request,
        limits: { maxSources: 1 },
      }),
    ).rejects.toMatchObject({
      _tag: "GoogleDriveCapacityExceeded",
      resource: "sources",
      capacity: 1,
    } satisfies Partial<GoogleDriveCapacityExceeded>);
  });

  it("fails explicitly when pagination exceeds its run bound", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ files: [], nextPageToken: "root-page-2" }),
      );

    await expect(
      fetchGoogleDriveInventory({
        ...baseInput,
        request,
        limits: { maxPages: 1 },
      }),
    ).rejects.toMatchObject({
      resource: "pages",
      capacity: 1,
    } satisfies Partial<GoogleDriveCapacityExceeded>);
  });
});
