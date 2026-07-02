import { describe, expect, it } from "vitest";
import { createObjectStorageService } from "./index";

describe("object storage provider seam", () => {
  it("creates signed upload URLs scoped to workspace and object key", async () => {
    const storage = createObjectStorageService({
      mode: "fake",
      baseUrl: "https://storage.example.test",
      nowMs: () => 1_000,
    });

    await expect(
      storage.createSignedUploadUrl({
        workspaceSlug: "acme-demo",
        objectKey: "sources/positioning.md",
        contentType: "text/markdown",
        expiresInMs: 60_000,
      }),
    ).resolves.toEqual({
      method: "PUT",
      url: "https://storage.example.test/acme-demo/sources%2Fpositioning.md?signature=fake&expires=61000",
      expiresAt: 61_000,
      headers: { "content-type": "text/markdown" },
    });
  });

  it("creates signed download URLs without public-write permissions", async () => {
    const storage = createObjectStorageService({
      mode: "test",
      baseUrl: "https://storage.example.test",
      nowMs: () => 2_000,
    });

    await expect(
      storage.createSignedDownloadUrl({
        workspaceSlug: "acme-demo",
        objectKey: "exports/handoff.zip",
        expiresInMs: 30_000,
      }),
    ).resolves.toEqual({
      method: "GET",
      url: "https://storage.example.test/acme-demo/exports%2Fhandoff.zip?signature=test&expires=32000",
      expiresAt: 32_000,
      headers: {},
    });
  });

  it("rejects unsafe object keys", async () => {
    const storage = createObjectStorageService({
      mode: "fake",
      baseUrl: "https://storage.example.test",
      nowMs: () => 1_000,
    });

    await expect(
      storage.createSignedDownloadUrl({
        workspaceSlug: "acme-demo",
        objectKey: "../secret",
        expiresInMs: 30_000,
      }),
    ).resolves.toMatchObject({
      _tag: "StorageKeyError",
      objectKey: "../secret",
    });
  });
});
