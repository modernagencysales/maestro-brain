import { describe, expect, it, vi } from "vitest";

import { DriveApiClientError, makeDriveApiClient } from "./client";

describe("Google Drive API client", () => {
  it("lists one Shared Drive change page with an opaque cursor", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/drive/v3/changes?");
      expect(url).toContain("pageToken=cursor+one");
      expect(url).toContain("driveId=shared_drive_1");
      expect(url).toContain("supportsAllDrives=true");
      expect(init?.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer injected-token" }),
      );
      return new Response(
        JSON.stringify({
          changes: [
            {
              fileId: "file_1",
              removed: false,
              time: "2026-08-21T12:00:00.000Z",
              file: {
                id: "file_1",
                name: "Plan",
                mimeType: "text/plain",
                version: "7",
                modifiedTime: "2026-08-21T11:59:00.000Z",
                webViewLink: "https://drive.google.com/open?id=file_1",
                trashed: false,
                parents: ["root_1"],
              },
            },
          ],
          nextPageToken: "cursor two",
          newStartPageToken: "future cursor",
        }),
        { status: 200 },
      );
    });
    const client = makeDriveApiClient({ accessToken: "injected-token", fetch });

    await expect(
      client.listChanges({
        driveId: "shared_drive_1",
        pageToken: "cursor one",
        pageSize: 50,
      }),
    ).resolves.toMatchObject({
      nextPageToken: "cursor two",
      newStartPageToken: "future cursor",
      changes: [{ fileId: "file_1", removed: false }],
    });
  });

  it("walks folder children with a bounded page and Shared Drive corpus", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toContain("/drive/v3/files?");
      expect(new URL(url).searchParams.get("q")).toContain(
        "'folder_1' in parents",
      );
      expect(url).toContain("corpora=drive");
      expect(url).toContain("driveId=shared_drive_1");
      return new Response(JSON.stringify({ files: [], nextPageToken: null }), {
        status: 200,
      });
    });
    const client = makeDriveApiClient({ accessToken: "token", fetch });

    await expect(
      client.listChildren({
        driveId: "shared_drive_1",
        folderId: "folder_1",
        pageToken: null,
        pageSize: 100,
      }),
    ).resolves.toEqual({ files: [], nextPageToken: null });
  });

  it("exports Google Docs as text without putting credentials in the URL", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/drive/v3/files/file_1/export?");
      expect(url).toContain("mimeType=text%2Fplain");
      expect(url).not.toContain("injected-token");
      expect(init?.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer injected-token" }),
      );
      return new Response("Exported body", { status: 200 });
    });
    const client = makeDriveApiClient({ accessToken: "injected-token", fetch });

    await expect(
      client.exportText({ fileId: "file_1", exportMimeType: "text/plain" }),
    ).resolves.toBe("Exported body");
  });

  it("returns a sanitized retryable error for provider throttling", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("provider body must not escape", {
          status: 429,
          headers: { "retry-after": "12" },
        }),
    );
    const client = makeDriveApiClient({ accessToken: "secret", fetch });

    await expect(
      client.listChildren({
        driveId: "shared_drive_1",
        folderId: "folder_1",
        pageToken: null,
        pageSize: 100,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DriveApiClientError>>({
        _tag: "DriveApiClientError",
        reason: "rate_limited",
        retryable: true,
        retryAfterSeconds: 12,
      }),
    );
  });
});
