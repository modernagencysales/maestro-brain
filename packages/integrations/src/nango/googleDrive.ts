import {
  nangoProxyHeaders,
  nangoProxyUrl,
  nonEmptyString,
  positiveInteger,
  record,
  recordArray,
  stableHash,
  type ProviderReconciliationInventory,
  type ProviderSourceObservation,
  type ProviderSourceScope,
} from "./sourceMetadata";

type Request = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_FILE_FIELDS = [
  "id",
  "name",
  "mimeType",
  "version",
  "modifiedTime",
  "createdTime",
  "webViewLink",
  "trashed",
  "parents",
  "md5Checksum",
  "size",
].join(",");

export type GoogleDriveSourceMetadata = Readonly<{
  name: string;
  mimeType: string;
  driveId: string;
  parentFolderIds: readonly string[];
  createdAt: number | null;
  version: string | null;
  md5Checksum: string | null;
  sizeBytes: string | null;
  contentText: string | null;
  contentStatus: "text" | "metadata_only";
}>;

export type GoogleDriveSourceObservation = ProviderSourceObservation<
  "google_drive",
  GoogleDriveSourceMetadata
>;

export type GoogleDriveScope = ProviderSourceScope<"google_drive"> &
  Readonly<{ rootFolderIds: readonly string[] }>;

export type GoogleDriveInventory = Omit<
  ProviderReconciliationInventory<"google_drive", GoogleDriveSourceObservation>,
  "scope"
> &
  Readonly<{ scope: GoogleDriveScope; foldersScanned: number }>;

export type GoogleDriveLimits = Readonly<{
  maxFolders?: number;
  maxSources?: number;
  maxPages?: number;
  maxContentBytes?: number;
}>;

export class GoogleDriveAdapterError extends Error {
  readonly _tag = "GoogleDriveAdapterError";

  constructor(
    readonly reason:
      "invalid_input" | "invalid_response" | "provider_unavailable",
  ) {
    super(`Google Drive adapter failed: ${reason}`);
    this.name = "GoogleDriveAdapterError";
  }
}

export class GoogleDriveCapacityExceeded extends Error {
  readonly _tag = "GoogleDriveCapacityExceeded";

  constructor(
    readonly resource: "folders" | "sources" | "pages" | "content_bytes",
    readonly capacity: number,
  ) {
    super(`Google Drive ${resource} capacity of ${capacity} was exceeded.`);
    this.name = "GoogleDriveCapacityExceeded";
  }
}

const DEFAULT_MAX_FOLDERS = 2_000;
const DEFAULT_MAX_SOURCES = 20_000;
const DEFAULT_MAX_PAGES = 5_000;
const DEFAULT_MAX_CONTENT_BYTES = 2_000_000;
const GOOGLE_DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document";

const requireString = (value: unknown): string => {
  const parsed = nonEmptyString(value);
  if (parsed === undefined)
    throw new GoogleDriveAdapterError("invalid_response");
  return parsed;
};

const timestamp = (value: unknown): number => {
  const parsed = Date.parse(requireString(value));
  if (!Number.isFinite(parsed))
    throw new GoogleDriveAdapterError("invalid_response");
  return parsed;
};

const optionalTimestamp = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  return timestamp(value);
};

const stringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? [...new Set(value.flatMap((item) => nonEmptyString(item) ?? []))].sort()
    : [];

const quoteDriveQuery = (value: string): string =>
  value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");

const validateScopeInput = (input: {
  readonly providerConfigKey: string;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly driveId: string;
  readonly rootFolderIds: readonly string[];
  readonly allowlistGeneration: number;
  readonly observedAt: number;
}): readonly string[] => {
  const roots = [
    ...new Set(input.rootFolderIds.map((root) => root.trim())),
  ].sort();
  if (
    input.providerConfigKey.trim().length === 0 ||
    input.connectionId.trim().length === 0 ||
    !Number.isSafeInteger(input.connectionGeneration) ||
    input.connectionGeneration < 1 ||
    input.driveId.trim().length === 0 ||
    roots.length === 0 ||
    roots.some((root) => root.length === 0) ||
    !Number.isSafeInteger(input.allowlistGeneration) ||
    input.allowlistGeneration < 1 ||
    !Number.isFinite(input.observedAt) ||
    input.observedAt < 0
  ) {
    throw new GoogleDriveAdapterError("invalid_input");
  }
  return roots;
};

const makeScope = (input: {
  readonly providerConfigKey: string;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly driveId: string;
  readonly rootFolderIds: readonly string[];
  readonly allowlistGeneration: number;
}): GoogleDriveScope => {
  const identity = {
    providerKey: "google_drive" as const,
    providerConfigKey: input.providerConfigKey,
    connectionId: input.connectionId,
    connectionGeneration: input.connectionGeneration,
    containerKey: input.driveId,
    rootFolderIds: input.rootFolderIds,
    allowlistGeneration: input.allowlistGeneration,
  };
  return { ...identity, scopeKey: `gds_${stableHash(identity)}` };
};

const projectFile = (
  file: Readonly<Record<string, unknown>>,
  input: { readonly driveId: string; readonly observedAt: number },
): GoogleDriveSourceObservation | { readonly folderId: string } => {
  const id = requireString(file.id);
  const name = requireString(file.name);
  const mimeType = requireString(file.mimeType);
  if (mimeType === DRIVE_FOLDER_MIME_TYPE) return { folderId: id };
  const modifiedAt = timestamp(file.modifiedTime);
  const locator = requireString(file.webViewLink);
  const version = nonEmptyString(file.version) ?? null;
  const checksum = nonEmptyString(file.md5Checksum) ?? null;
  const observationOrder =
    version !== null
      ? { kind: "file_version", value: version }
      : { kind: "modified_at", value: String(modifiedAt) };
  const revisionIdentity =
    version !== null
      ? `file_version:${version}`
      : `modified_at:${modifiedAt}:content:${checksum ?? "unavailable"}`;
  return {
    providerKey: "google_drive",
    sourceKey: `google_drive:file:${id}`,
    providerObjectId: id,
    revisionKey: `google_drive:file:${id}:${revisionIdentity}`,
    observationOrder,
    sourceModifiedAt: modifiedAt,
    observedAt: input.observedAt,
    sourceLocator: locator,
    tombstone: file.trashed === true,
    metadata: {
      name,
      mimeType,
      driveId: input.driveId,
      parentFolderIds: stringArray(file.parents),
      createdAt: optionalTimestamp(file.createdTime),
      version,
      md5Checksum: checksum,
      sizeBytes: nonEmptyString(file.size) ?? null,
      contentText: null,
      contentStatus: "metadata_only",
    },
  };
};

const loadTextContent = async (input: {
  readonly observation: GoogleDriveSourceObservation;
  readonly request: Request;
  readonly headers: Readonly<Record<string, string>>;
  readonly maxContentBytes: number;
}): Promise<GoogleDriveSourceObservation> => {
  const mimeType = input.observation.metadata.mimeType;
  const method =
    mimeType === GOOGLE_DOCUMENT_MIME_TYPE
      ? `drive/v3/files/${encodeURIComponent(input.observation.providerObjectId)}/export`
      : mimeType.startsWith("text/") || mimeType === "application/json"
        ? `drive/v3/files/${encodeURIComponent(input.observation.providerObjectId)}`
        : undefined;
  if (method === undefined) return input.observation;
  const response = await input.request(
    nangoProxyUrl(
      method,
      mimeType === GOOGLE_DOCUMENT_MIME_TYPE
        ? { mimeType: "text/plain" }
        : { alt: "media", supportsAllDrives: "true" },
    ),
    { headers: input.headers },
  );
  if (!response.ok) throw new GoogleDriveAdapterError("provider_unavailable");
  const content = await response.text();
  if (new TextEncoder().encode(content).byteLength > input.maxContentBytes)
    throw new GoogleDriveCapacityExceeded(
      "content_bytes",
      input.maxContentBytes,
    );
  return {
    ...input.observation,
    metadata: {
      ...input.observation.metadata,
      contentText: content.replace(/\r\n?/gu, "\n"),
      contentStatus: "text",
    },
  };
};

export const fetchGoogleDriveInventory = async (input: {
  readonly secretKey: string;
  readonly providerConfigKey: string;
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly driveId: string;
  readonly rootFolderIds: readonly string[];
  readonly allowlistGeneration: number;
  readonly observedAt: number;
  readonly request?: Request;
  readonly limits?: GoogleDriveLimits;
}): Promise<GoogleDriveInventory> => {
  const rootFolderIds = validateScopeInput(input);
  const maxFolders = positiveInteger(
    input.limits?.maxFolders,
    DEFAULT_MAX_FOLDERS,
  );
  const maxSources = positiveInteger(
    input.limits?.maxSources,
    DEFAULT_MAX_SOURCES,
  );
  const maxPages = positiveInteger(input.limits?.maxPages, DEFAULT_MAX_PAGES);
  const maxContentBytes = positiveInteger(
    input.limits?.maxContentBytes,
    DEFAULT_MAX_CONTENT_BYTES,
  );
  const request = input.request ?? fetch;
  const headers = nangoProxyHeaders(input);
  const folderQueue = [...rootFolderIds];
  const queuedFolders = new Set(rootFolderIds);
  const completedFolders = new Set<string>();
  const observations = new Map<string, GoogleDriveSourceObservation>();
  let pagesRead = 0;

  while (folderQueue.length > 0) {
    if (completedFolders.size >= maxFolders)
      throw new GoogleDriveCapacityExceeded("folders", maxFolders);
    const folderId = folderQueue.shift();
    if (folderId === undefined || completedFolders.has(folderId)) continue;
    completedFolders.add(folderId);
    let pageToken: string | undefined;
    const seenPageTokens = new Set<string>();
    do {
      if (pagesRead >= maxPages)
        throw new GoogleDriveCapacityExceeded("pages", maxPages);
      const response = await request(
        nangoProxyUrl("drive/v3/files", {
          q: `'${quoteDriveQuery(folderId)}' in parents and trashed = false`,
          pageSize: "1000",
          corpora: "drive",
          driveId: input.driveId,
          spaces: "drive",
          includeItemsFromAllDrives: "true",
          supportsAllDrives: "true",
          fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
          ...(pageToken === undefined ? {} : { pageToken }),
        }),
        { headers },
      );
      if (!response.ok)
        throw new GoogleDriveAdapterError("provider_unavailable");
      let body: Readonly<Record<string, unknown>> | undefined;
      try {
        body = record(await response.json());
      } catch {
        throw new GoogleDriveAdapterError("invalid_response");
      }
      const files = recordArray(body?.files);
      if (body === undefined || files === undefined)
        throw new GoogleDriveAdapterError("invalid_response");
      pagesRead += 1;
      for (const file of files) {
        const projected = projectFile(file, input);
        if ("folderId" in projected) {
          if (!queuedFolders.has(projected.folderId)) {
            if (queuedFolders.size >= maxFolders)
              throw new GoogleDriveCapacityExceeded("folders", maxFolders);
            queuedFolders.add(projected.folderId);
            folderQueue.push(projected.folderId);
          }
          continue;
        }
        const current = observations.get(projected.sourceKey);
        if (
          current !== undefined &&
          current.revisionKey !== projected.revisionKey
        )
          throw new GoogleDriveAdapterError("invalid_response");
        if (current === undefined) {
          if (observations.size >= maxSources)
            throw new GoogleDriveCapacityExceeded("sources", maxSources);
          observations.set(
            projected.sourceKey,
            await loadTextContent({
              observation: projected,
              request,
              headers,
              maxContentBytes,
            }),
          );
        }
      }
      pageToken = nonEmptyString(body.nextPageToken);
      if (pageToken !== undefined) {
        if (seenPageTokens.has(pageToken))
          throw new GoogleDriveAdapterError("invalid_response");
        seenPageTokens.add(pageToken);
      }
    } while (pageToken !== undefined);
  }

  const sources = [...observations.values()].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
  return {
    scope: makeScope({ ...input, rootFolderIds }),
    observations: sources,
    sourceCount: sources.length,
    pagesRead,
    foldersScanned: completedFolders.size,
    completedAt: input.observedAt,
    complete: true,
  };
};
