export type StorageMode = "fake" | "test" | "live";

export type SignedStorageUrl = {
  readonly method: "PUT" | "GET";
  readonly url: string;
  readonly expiresAt: number;
  readonly headers: Readonly<Record<string, string>>;
};

export type StorageUrlInput = {
  readonly workspaceSlug: string;
  readonly objectKey: string;
  readonly expiresInMs: number;
};

export type SignedUploadUrlInput = StorageUrlInput & {
  readonly contentType: string;
};

export class StorageKeyError extends Error {
  readonly _tag = "StorageKeyError";

  constructor(readonly objectKey: string) {
    super("Object key must be relative and workspace-scoped.");
    this.name = "StorageKeyError";
  }
}

const safeObjectKey = (objectKey: string): true | StorageKeyError => {
  if (
    objectKey.startsWith("/") ||
    objectKey.includes("..") ||
    objectKey.trim() !== objectKey ||
    objectKey.length === 0
  ) {
    return new StorageKeyError(objectKey);
  }

  return true;
};

const signatureForMode = (mode: StorageMode): string =>
  mode === "fake" ? "fake" : mode === "test" ? "test" : "live-ready";

const signedUrl = (input: {
  readonly mode: StorageMode;
  readonly baseUrl: string;
  readonly method: "PUT" | "GET";
  readonly workspaceSlug: string;
  readonly objectKey: string;
  readonly expiresAt: number;
  readonly headers: Readonly<Record<string, string>>;
}): SignedStorageUrl => ({
  method: input.method,
  url: `${input.baseUrl}/${input.workspaceSlug}/${encodeURIComponent(input.objectKey)}?signature=${signatureForMode(input.mode)}&expires=${input.expiresAt}`,
  expiresAt: input.expiresAt,
  headers: input.headers,
});

export const createObjectStorageService = (options: {
  readonly mode: StorageMode;
  readonly baseUrl: string;
  readonly nowMs: () => number;
}) => ({
  createSignedUploadUrl: async (
    input: SignedUploadUrlInput,
  ): Promise<SignedStorageUrl | StorageKeyError> => {
    const key = safeObjectKey(input.objectKey);

    if (key !== true) {
      return key;
    }

    return signedUrl({
      mode: options.mode,
      baseUrl: options.baseUrl,
      method: "PUT",
      workspaceSlug: input.workspaceSlug,
      objectKey: input.objectKey,
      expiresAt: options.nowMs() + input.expiresInMs,
      headers: { "content-type": input.contentType },
    });
  },
  createSignedDownloadUrl: async (
    input: StorageUrlInput,
  ): Promise<SignedStorageUrl | StorageKeyError> => {
    const key = safeObjectKey(input.objectKey);

    if (key !== true) {
      return key;
    }

    return signedUrl({
      mode: options.mode,
      baseUrl: options.baseUrl,
      method: "GET",
      workspaceSlug: input.workspaceSlug,
      objectKey: input.objectKey,
      expiresAt: options.nowMs() + input.expiresInMs,
      headers: {},
    });
  },
});
