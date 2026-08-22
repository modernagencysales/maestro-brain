import type { DriveFileRecord } from "./canonical";

const DRIVE_API_BASE = "https://www.googleapis.com";
const FILE_FIELDS =
  "id,name,mimeType,version,modifiedTime,webViewLink,trashed,parents";

type DriveFetch = (input: string, init?: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;

export class DriveApiClientError extends Error {
  readonly _tag = "DriveApiClientError";

  constructor(
    readonly reason:
      | "invalid_request"
      | "unauthorized"
      | "not_found"
      | "rate_limited"
      | "provider_unavailable"
      | "invalid_response",
    readonly retryable: boolean,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`Google Drive request failed: ${reason}`);
  }
}

export type DriveChange = Readonly<{
  fileId: string;
  removed: boolean;
  time: string | null;
  file: DriveFileRecord | null;
}>;

const object = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const nullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : string(value);

const pageSize = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new DriveApiClientError("invalid_request", false, null, null);
  }
  return value;
};

const retryAfter = (response: Response): number | null => {
  const value = response.headers.get("retry-after");
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
};

const responseError = (response: Response): DriveApiClientError => {
  if (response.status === 401 || response.status === 403) {
    return new DriveApiClientError(
      "unauthorized",
      false,
      response.status,
      null,
    );
  }
  if (response.status === 404) {
    return new DriveApiClientError("not_found", false, response.status, null);
  }
  if (response.status === 429) {
    return new DriveApiClientError(
      "rate_limited",
      true,
      response.status,
      retryAfter(response),
    );
  }
  return new DriveApiClientError(
    "provider_unavailable",
    response.status >= 500,
    response.status,
    retryAfter(response),
  );
};

const driveFile = (value: unknown): DriveFileRecord | null => {
  const row = object(value);
  const id = string(row?.id);
  const name = string(row?.name);
  const mimeType = string(row?.mimeType);
  const modifiedTime = string(row?.modifiedTime);
  const webViewLink = string(row?.webViewLink);
  if (!row || !id || !name || !mimeType || !modifiedTime || !webViewLink) {
    return null;
  }
  const parents = Array.isArray(row.parents)
    ? row.parents.flatMap((parent) => {
        const decoded = string(parent);
        return decoded === null ? [] : [decoded];
      })
    : [];
  return {
    id,
    name,
    mimeType,
    version: nullableString(row.version),
    modifiedTime,
    webViewLink,
    trashed: row.trashed === true,
    parents,
  };
};

const quoteDriveQueryValue = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const rootFolderQuery = (rootFolderIds: readonly string[]): string => {
  const roots = [...new Set(rootFolderIds.map((root) => root.trim()))].sort();
  if (
    roots.length === 0 ||
    roots.length > 100 ||
    roots.some((root) => root.length === 0)
  )
    throw new DriveApiClientError("invalid_request", false, null, null);
  return `(${roots
    .map((root) => `'${quoteDriveQueryValue(root)}' in parents`)
    .join(" or ")}) and trashed = false`;
};

export const makeDriveApiClient = (
  input: Readonly<{
    accessToken: string;
    fetch?: DriveFetch;
    baseUrl?: string;
  }>,
) => {
  if (input.accessToken.trim().length === 0) {
    throw new DriveApiClientError("invalid_request", false, null, null);
  }
  const request = input.fetch ?? fetch;
  const baseUrl = input.baseUrl ?? DRIVE_API_BASE;
  const headers = { Authorization: `Bearer ${input.accessToken}` } as const;

  const get = async (url: URL): Promise<Response> => {
    const response = await request(url.toString(), { headers });
    if (!response.ok) throw responseError(response);
    return response;
  };

  const getJson = async (url: URL): Promise<JsonObject> => {
    const response = await get(url);
    try {
      const decoded = object(await response.json());
      if (decoded === null) throw new Error("not an object");
      return decoded;
    } catch {
      throw new DriveApiClientError(
        "invalid_response",
        false,
        response.status,
        null,
      );
    }
  };

  return {
    getStartPageToken: async (driveId: string): Promise<string> => {
      const url = new URL("/drive/v3/changes/startPageToken", baseUrl);
      url.searchParams.set("driveId", driveId);
      url.searchParams.set("supportsAllDrives", "true");
      const payload = await getJson(url);
      const startPageToken = string(payload.startPageToken);
      if (startPageToken === null) {
        throw new DriveApiClientError("invalid_response", false, 200, null);
      }
      return startPageToken;
    },

    listChanges: async (
      args: Readonly<{
        driveId: string;
        pageToken: string;
        pageSize: number;
      }>,
    ): Promise<
      Readonly<{
        changes: readonly DriveChange[];
        nextPageToken: string | null;
        newStartPageToken: string | null;
      }>
    > => {
      const url = new URL("/drive/v3/changes", baseUrl);
      url.searchParams.set("pageToken", args.pageToken);
      url.searchParams.set("pageSize", String(pageSize(args.pageSize)));
      url.searchParams.set("driveId", args.driveId);
      url.searchParams.set("corpora", "drive");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set(
        "fields",
        `changes(fileId,removed,time,file(${FILE_FIELDS})),nextPageToken,newStartPageToken`,
      );
      const payload = await getJson(url);
      if (!Array.isArray(payload.changes)) {
        throw new DriveApiClientError("invalid_response", false, 200, null);
      }
      const changes = payload.changes.map((value) => {
        const row = object(value);
        const fileId = string(row?.fileId);
        if (!row || fileId === null) {
          throw new DriveApiClientError("invalid_response", false, 200, null);
        }
        const file = row.file === undefined ? null : driveFile(row.file);
        if (row.file !== undefined && file === null) {
          throw new DriveApiClientError("invalid_response", false, 200, null);
        }
        return {
          fileId,
          removed: row.removed === true,
          time: nullableString(row.time),
          file,
        };
      });
      return {
        changes,
        nextPageToken: nullableString(payload.nextPageToken),
        newStartPageToken: nullableString(payload.newStartPageToken),
      };
    },

    listChildren: async (
      args: Readonly<{
        driveId: string;
        folderId: string;
        pageToken: string | null;
        pageSize: number;
      }>,
    ): Promise<
      Readonly<{
        files: readonly DriveFileRecord[];
        nextPageToken: string | null;
      }>
    > => {
      const url = new URL("/drive/v3/files", baseUrl);
      url.searchParams.set(
        "q",
        `'${quoteDriveQueryValue(args.folderId)}' in parents and trashed = false`,
      );
      url.searchParams.set("pageSize", String(pageSize(args.pageSize)));
      url.searchParams.set("corpora", "drive");
      url.searchParams.set("driveId", args.driveId);
      url.searchParams.set("includeItemsFromAllDrives", "true");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("fields", `files(${FILE_FIELDS}),nextPageToken`);
      if (args.pageToken !== null) {
        url.searchParams.set("pageToken", args.pageToken);
      }
      const payload = await getJson(url);
      if (!Array.isArray(payload.files)) {
        throw new DriveApiClientError("invalid_response", false, 200, null);
      }
      const files = payload.files.map((value) => {
        const decoded = driveFile(value);
        if (decoded === null) {
          throw new DriveApiClientError("invalid_response", false, 200, null);
        }
        return decoded;
      });
      return { files, nextPageToken: nullableString(payload.nextPageToken) };
    },

    listInventoryPage: async (
      args: Readonly<{
        driveId: string;
        rootFolderIds: readonly string[];
        pageToken: string | null;
        pageSize: number;
      }>,
    ): Promise<
      Readonly<{
        files: readonly DriveFileRecord[];
        nextPageToken: string | null;
      }>
    > => {
      if (args.driveId.trim().length === 0) {
        throw new DriveApiClientError("invalid_request", false, null, null);
      }
      const url = new URL("/drive/v3/files", baseUrl);
      url.searchParams.set("q", rootFolderQuery(args.rootFolderIds));
      url.searchParams.set("pageSize", String(pageSize(args.pageSize)));
      url.searchParams.set("corpora", "drive");
      url.searchParams.set("driveId", args.driveId);
      url.searchParams.set("spaces", "drive");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("fields", `files(${FILE_FIELDS}),nextPageToken`);
      if (args.pageToken !== null) {
        if (args.pageToken.trim().length === 0) {
          throw new DriveApiClientError("invalid_request", false, null, null);
        }
        url.searchParams.set("pageToken", args.pageToken);
      }
      const payload = await getJson(url);
      if (!Array.isArray(payload.files)) {
        throw new DriveApiClientError("invalid_response", false, 200, null);
      }
      const files = payload.files.map((value) => {
        const decoded = driveFile(value);
        if (decoded === null) {
          throw new DriveApiClientError("invalid_response", false, 200, null);
        }
        return decoded;
      });
      return { files, nextPageToken: nullableString(payload.nextPageToken) };
    },

    exportText: async (
      args: Readonly<{
        fileId: string;
        exportMimeType: string;
      }>,
    ): Promise<string> => {
      const url = new URL(
        `/drive/v3/files/${encodeURIComponent(args.fileId)}/export`,
        baseUrl,
      );
      url.searchParams.set("mimeType", args.exportMimeType);
      const response = await get(url);
      return response.text();
    },
  } as const;
};
